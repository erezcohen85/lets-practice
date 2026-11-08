import math
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from app.pipeline.models import FailedPart, Job, JobKind, JobStatus
from app.pipeline.orchestrator import add_parts, process_piece, realign_piece
from app.pipeline.stages import Stages, default_stages

if TYPE_CHECKING:
    from app.deps import Services

# The jobs table as the processor sees it; the browser polls the same rows. SupabaseJobStore
# (app/supabase_db.py) is the real implementation behind this Protocol.

TERMINAL_STATUSES = (JobStatus.DONE, JobStatus.ERROR)

INTERRUPTED = "The server restarted while this was running. Try again."


class JobBusy(Exception):
    """The piece already has a queued or running job (one at a time per piece, M-12)."""


@dataclass(frozen=True)
class ActiveJob:
    """A piece's queued or running job and when its row last changed (any update, progress too)."""

    job: Job
    updated_at: datetime


@runtime_checkable
class JobStore(Protocol):
    """Create jobs and record how far they got."""

    def create(self, piece_id: str, kind: JobKind) -> Job:
        """Add a queued job with progress 0; JobBusy when the piece has a queued or running job."""
        ...

    def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: float | None = None,
        error: str | None = None,
        warnings: list[str] | None = None,
        cost_usd: float | None = None,
        failed_parts: list[FailedPart] | None = None,
    ) -> Job:
        """Change the given fields and return the job; KeyError for an unknown id."""
        ...

    def get(self, job_id: str) -> Job | None:
        """Return the job, or None."""
        ...

    def active_job(self, piece_id: str) -> ActiveJob | None:
        """The piece's queued or running job with its last update, or None."""
        ...

    def fail_interrupted(self) -> int:
        """End every queued or running job as failed and say how many: run at startup, when no
        job of this process can be running, so one cut off by a redeploy does not spin forever."""
        ...


class InMemoryJobStore:
    """A JobStore held in a dict; jobs go in and out as copies."""

    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self._jobs: dict[str, Job] = {}
        self._touched: dict[str, datetime] = {}
        # tests set this to age a job
        self.clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))
        # Every status each job has had, oldest first, starting with queued.
        self.history: dict[str, list[JobStatus]] = {}

    def create(self, piece_id: str, kind: JobKind) -> Job:
        if any(
            held.piece_id == piece_id and held.status not in TERMINAL_STATUSES
            for held in self._jobs.values()
        ):
            raise JobBusy(piece_id)
        job = Job(
            id=str(uuid.uuid4()),
            piece_id=piece_id,
            kind=kind,
            status=JobStatus.QUEUED,
            progress=0,
        )
        self._jobs[job.id] = job
        self._touched[job.id] = self.clock()
        self.history[job.id] = [JobStatus.QUEUED]
        return job.model_copy()

    def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: float | None = None,
        error: str | None = None,
        warnings: list[str] | None = None,
        cost_usd: float | None = None,
        failed_parts: list[FailedPart] | None = None,
    ) -> Job:
        job = self._jobs[job_id]  # KeyError for an unknown id
        if progress is not None and not (math.isfinite(progress) and 0 <= progress <= 1):
            raise ValueError(f"progress must be between 0 and 1, got {progress}")
        if status is not None and status != job.status and job.status in TERMINAL_STATUSES:
            raise ValueError(f"status cannot change from {job.status.value} to {status.value}")
        changes: dict[str, object] = {}
        if status is not None:
            changes["status"] = status
        if progress is not None:
            changes["progress"] = progress
        if error is not None:
            changes["error"] = error
        if warnings is not None:
            changes["warnings"] = list(warnings)
        if cost_usd is not None:
            changes["cost_usd"] = cost_usd
        if failed_parts is not None:
            changes["failed_parts"] = list(failed_parts)
        updated = job.model_copy(update=changes)
        if updated.status != job.status:
            self.history[job_id].append(updated.status)
        self._jobs[job_id] = updated
        self._touched[job_id] = self.clock()
        return updated.model_copy()

    def get(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        return job.model_copy() if job is not None else None

    def active_job(self, piece_id: str) -> ActiveJob | None:
        for held in self._jobs.values():
            if held.piece_id == piece_id and held.status not in TERMINAL_STATUSES:
                return ActiveJob(held.model_copy(), self._touched[held.id])
        return None

    def fail_interrupted(self) -> int:
        unfinished = [j.id for j in self._jobs.values() if j.status not in TERMINAL_STATUSES]
        for job_id in unfinished:
            self.update(job_id, status=JobStatus.ERROR, error=INTERRUPTED)
        return len(unfinished)


def run_job(job: Job, services: "Services", stages: Stages | None = None) -> Job:
    """Run the job through the orchestrator (default_stages unless given); return its end state."""
    runners = {
        JobKind.PROCESS_PIECE: process_piece,
        JobKind.REALIGN: realign_piece,
        JobKind.ADD_PARTS: add_parts,
    }
    runners[job.kind](job, services, default_stages(services) if stages is None else stages)
    finished = services.jobs.get(job.id)
    if finished is None:
        raise KeyError(job.id)
    return finished
