import logging
import threading
import time

import pytest

from app.db import InMemoryDatabase
from app.deps import Services
from app.job_end import FINAL_WRITE_ATTEMPTS
from app.job_runner import GENERIC_FAILURE, JobRunner
from app.jobs import InMemoryJobStore
from app.pipeline.models import Job, JobKind, JobStatus
from app.storage import InMemoryStorage
from app.supabase_rest import RestError


def services(jobs: InMemoryJobStore | None = None) -> Services:
    return Services(
        db=InMemoryDatabase(), storage=InMemoryStorage(), jobs=jobs or InMemoryJobStore()
    )


class FlakyJobs(InMemoryJobStore):
    """A job store whose status writes fail `failures` times first, as when Supabase is down."""

    def __init__(self, failures: int, error: Exception | None = None) -> None:
        super().__init__()
        self.failures = failures
        self.error = error or RestError(503, None)
        self.status_writes = 0

    def update(self, job_id: str, **changes: object) -> Job:  # type: ignore[override]
        if changes.get("status") is not None:
            self.status_writes += 1
            if self.failures > 0:
                self.failures -= 1
                raise self.error
        return super().update(job_id, **changes)  # type: ignore[arg-type]


def crash(job: Job, world: Services) -> Job:
    raise RuntimeError("https://secret.example/private")


def test_submit_returns_before_the_job_ends_and_jobs_run_one_at_a_time() -> None:
    release = threading.Event()
    running: list[str] = []
    overlap: list[bool] = []
    done = threading.Event()

    def slow(job: Job, world: Services) -> Job:
        overlap.append(len(running) > 0)
        running.append(job.id)
        release.wait(5)
        running.remove(job.id)
        if job.piece_id == "b":
            done.set()
        return job

    world = services()
    runner = JobRunner(run=slow)
    first = world.jobs.create("a", JobKind.REALIGN)
    second = world.jobs.create("b", JobKind.REALIGN)
    runner.submit(first, world)  # returns at once though the job is held
    runner.submit(second, world)
    assert not done.is_set()  # a synchronous runner would have waited out the hold and run both
    release.set()
    assert done.wait(5)
    assert overlap == [False, False]
    runner.shutdown()


def test_a_crash_outside_the_orchestrator_ends_the_job_as_failed_without_the_detail(
    caplog: pytest.LogCaptureFixture,
) -> None:
    finished = threading.Event()
    world = services()
    runner = JobRunner(run=crash, on_finished=finished.set)
    job = world.jobs.create("a", JobKind.REALIGN)
    runner.submit(job, world)
    assert finished.wait(5)
    stored = world.jobs.get(job.id)
    assert stored is not None
    assert stored.status == JobStatus.ERROR
    assert stored.error == GENERIC_FAILURE
    assert "private" in caplog.text  # the detail stays in the server's log
    runner.shutdown()


def test_the_log_of_a_crash_holds_no_token_and_no_email(caplog: pytest.LogCaptureFixture) -> None:
    def leaky(job: Job, world: Services) -> Job:
        raise RuntimeError(
            "GET /x?token=abc123&a=1 for erez@example.com with Bearer eyJhbGci.e30.sig"
        )

    world = services()
    job = world.jobs.create("a", JobKind.REALIGN)
    JobRunner(run=leaky, sleep=lambda _: None)._guarded(job, world)
    for secret in ("abc123", "erez@example.com", "eyJhbGci"):
        assert secret not in caplog.text
    assert "RuntimeError" in caplog.text


def test_a_failed_final_write_is_tried_again_after_a_pause() -> None:
    jobs = FlakyJobs(failures=2)
    world = services(jobs)
    pauses: list[float] = []
    job = jobs.create("a", JobKind.REALIGN)
    JobRunner(run=crash, sleep=pauses.append)._guarded(job, world)
    stored = jobs.get(job.id)
    assert stored is not None
    assert stored.status == JobStatus.ERROR
    assert stored.error == GENERIC_FAILURE
    assert jobs.status_writes == 3
    assert len(pauses) == 2
    assert pauses == sorted(pauses) and all(0 < pause <= 15 for pause in pauses)


def test_a_final_write_that_never_lands_is_logged_and_stops_trying(
    caplog: pytest.LogCaptureFixture,
) -> None:
    jobs = FlakyJobs(failures=10_000)
    world = services(jobs)
    finished: list[bool] = []
    job = jobs.create("a", JobKind.REALIGN)
    runner = JobRunner(run=crash, on_finished=lambda: finished.append(True), sleep=lambda _: None)
    runner._guarded(job, world)  # does not raise
    assert jobs.status_writes == FINAL_WRITE_ATTEMPTS
    assert finished == [True]
    assert "could not be saved" in caplog.text
    stored = jobs.get(job.id)
    assert stored is not None
    assert stored.status == JobStatus.QUEUED  # left for the startup sweep


def test_a_job_that_already_ended_is_not_written_again() -> None:
    # SupabaseJobStore finds no active row for a status write on an ended job and raises KeyError.
    jobs = FlakyJobs(failures=10_000, error=KeyError("job"))
    world = services(jobs)
    job = jobs.create("a", JobKind.REALIGN)
    JobRunner(run=crash, sleep=lambda _: None)._guarded(job, world)
    assert jobs.status_writes == 1


def test_a_runner_that_works_never_touches_the_status_itself(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    jobs = FlakyJobs(failures=0)
    world = services(jobs)
    job = jobs.create("a", JobKind.REALIGN)
    JobRunner(run=lambda j, w: j, sleep=lambda _: None)._guarded(job, world)
    assert jobs.status_writes == 0


def test_the_worker_is_a_daemon_thread_and_a_slow_job_does_not_hold_shutdown() -> None:
    started, release = threading.Event(), threading.Event()

    def slow(job: Job, world: Services) -> Job:
        started.set()
        release.wait(30)
        return job

    world = services()
    runner = JobRunner(run=slow)
    runner.submit(world.jobs.create("a", JobKind.REALIGN), world)
    assert started.wait(5)
    began = time.monotonic()
    runner.shutdown()  # does not join: SIGTERM must end the process at once
    assert time.monotonic() - began < 1
    workers = [t for t in threading.enumerate() if t.name.startswith("job")]
    assert workers and all(t.daemon for t in workers)  # the interpreter does not wait for them
    release.set()


def test_a_stopped_runner_refuses_new_jobs_and_forgets_the_id() -> None:
    world = services()
    runner = JobRunner(run=lambda job, w: job)
    runner.shutdown()
    job = world.jobs.create("a", JobKind.REALIGN)
    with pytest.raises(RuntimeError):
        runner.submit(job, world)
    assert not runner.knows(job.id)


def test_the_runner_knows_its_current_and_queued_jobs_until_they_end() -> None:
    started, release = threading.Event(), threading.Event()

    def slow(job: Job, world: Services) -> Job:
        started.set()
        release.wait(5)
        return job

    world = services()
    runner = JobRunner(run=slow)
    first = world.jobs.create("a", JobKind.REALIGN)
    second = world.jobs.create("b", JobKind.REALIGN)
    runner.submit(first, world)
    runner.submit(second, world)
    assert started.wait(5)
    assert runner.knows(first.id) and runner.knows(second.id)  # running and queued
    assert not runner.knows("someone-else")
    release.set()
    deadline = time.monotonic() + 5
    while (runner.knows(first.id) or runner.knows(second.id)) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not runner.knows(first.id) and not runner.knows(second.id)
    runner.shutdown()


def test_a_system_exit_in_a_job_ends_it_as_failed_and_the_worker_goes_on() -> None:
    finished = threading.Event()
    after = threading.Event()

    def run(job: Job, world: Services) -> Job:
        if job.piece_id == "a":
            raise SystemExit(3)
        after.set()
        return job

    world = services()
    runner = JobRunner(run=run, on_finished=finished.set, sleep=lambda _: None)
    job = world.jobs.create("a", JobKind.REALIGN)
    runner.submit(job, world)
    assert finished.wait(5)
    stored = world.jobs.get(job.id)
    assert stored is not None and stored.status == JobStatus.ERROR
    runner.submit(world.jobs.create("b", JobKind.REALIGN), world)
    assert after.wait(5)
    runner.shutdown()


def test_an_error_whose_text_cannot_be_made_still_ends_the_job() -> None:
    class Unprintable(Exception):
        def __str__(self) -> str:
            raise RuntimeError("no text")

    def run(job: Job, world: Services) -> Job:
        raise Unprintable()

    world = services()
    job = world.jobs.create("a", JobKind.REALIGN)
    JobRunner(run=run, sleep=lambda _: None)._guarded(job, world)
    stored = world.jobs.get(job.id)
    assert stored is not None and stored.status == JobStatus.ERROR
