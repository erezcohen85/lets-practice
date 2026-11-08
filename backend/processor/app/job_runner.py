import logging
import queue
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from app.job_end import GENERIC_FAILURE, update_final
from app.jobs import run_job
from app.pipeline.models import Job, JobStatus
from app.safe_log import log_failure

if TYPE_CHECKING:
    from app.deps import Services

# Jobs run after the HTTP answer, because Railway closes a request after 5 minutes with no data. One
# worker: Audiveris and Beat This take gigabytes, and two at once would pass the memory limit. Keep
# the service at one replica: startup treats every unfinished job as this process's own.
#
# The worker is a daemon thread over a plain queue, not a pool: a pool's threads are joined when the
# interpreter exits, so a stopped service would run its job to the end while the new process has
# already ended that job as interrupted. Here SIGTERM ends the process at once, and the next start's
# sweep finds the job it cut off.

_STOP = object()
_log = logging.getLogger("uvicorn.error")


class JobRunner:
    """Runs one job at a time on a background thread."""

    def __init__(
        self,
        run: Callable[[Job, "Services"], Job] = run_job,
        on_finished: Callable[[], None] | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self._run = run
        self._on_finished = on_finished
        self._sleep = sleep
        self._queue: queue.SimpleQueue[object] = queue.SimpleQueue()
        self._lock = threading.Lock()
        self._ids: set[str] = set()  # the jobs running or waiting in this process
        self._thread: threading.Thread | None = None
        self._stopped = False

    def submit(self, job: Job, services: "Services") -> None:
        """Queue the job. Raises (and keeps no trace of the job) when it cannot be taken."""
        with self._lock:
            if self._stopped:
                raise RuntimeError("the job runner is stopped")
            if self._thread is None:
                thread = threading.Thread(target=self._work, name="job-worker", daemon=True)
                thread.start()  # can raise "can't start new thread"
                self._thread = thread
            self._ids.add(job.id)
        self._queue.put((job, services))

    def knows(self, job_id: str) -> bool:
        """True while this process is running the job or has it waiting."""
        with self._lock:
            return job_id in self._ids

    def _work(self) -> None:
        while True:
            item = self._queue.get()
            if item is _STOP or self._stopped:
                return
            job, services = item  # type: ignore[misc]
            self._guarded(job, services)

    def _guarded(self, job: Job, services: "Services") -> None:
        # The orchestrator turns a stage's failure into the job's error. This is for what it cannot
        # catch: nothing may die here unnoticed, or the job would stay running until the next start.
        # BaseException, so even a SystemExit raised in a job ends it as failed; the worker goes on.
        try:
            self._run(job, services)
        except BaseException as error:
            self._mark_failed(job, services)
            log_failure(_log, f"job {job.id} stopped", error)
        finally:
            with self._lock:
                self._ids.discard(job.id)
            if self._on_finished is not None:
                self._on_finished()

    def _mark_failed(self, job: Job, services: "Services") -> None:
        """Write the job's end, trying again a few times: Supabase may be down at this very moment.

        If it never lands the job stays unfinished, and the piece answers 409 until the route's
        stale-row rule (10 minutes without an update) or the next start ends it.
        """
        update_final(
            services.jobs,
            job.id,
            sleep=self._sleep,
            status=JobStatus.ERROR,
            error=GENERIC_FAILURE,
        )

    def shutdown(self) -> None:
        """Stop taking jobs and tell the worker to stop after the job it is on. Does not wait."""
        with self._lock:
            self._stopped = True
        self._queue.put(_STOP)
