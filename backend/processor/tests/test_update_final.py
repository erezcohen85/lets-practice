import pytest

from app.job_end import FINAL_WRITE_ATTEMPTS, update_final
from app.jobs import InMemoryJobStore
from app.pipeline.models import Job, JobKind, JobStatus
from app.supabase_rest import RestError


class Failing(InMemoryJobStore):
    """Fails the first `failures` writes with `error`."""

    def __init__(self, failures: int, error: Exception) -> None:
        super().__init__()
        self.failures, self.error, self.writes = failures, error, 0

    def update(self, job_id: str, **changes: object) -> Job:  # type: ignore[override]
        self.writes += 1
        if self.failures > 0:
            self.failures -= 1
            raise self.error
        return super().update(job_id, **changes)  # type: ignore[arg-type]


def make(failures: int, error: Exception) -> tuple[Failing, Job]:
    jobs = Failing(failures, error)
    return jobs, jobs.create("p", JobKind.REALIGN)


def test_the_whole_payload_lands_after_a_blip() -> None:
    jobs, job = make(2, RestError(503, None))
    pauses: list[float] = []
    landed = update_final(
        jobs,
        job.id,
        sleep=pauses.append,
        status=JobStatus.DONE,
        progress=1.0,
        warnings=["w"],
        cost_usd=0.5,
    )
    stored = jobs.get(job.id)
    assert landed and stored is not None
    assert (stored.status, stored.warnings, stored.cost_usd) == (JobStatus.DONE, ["w"], 0.5)
    assert len(pauses) == 2


def test_the_retries_cover_about_thirty_seconds() -> None:
    jobs, job = make(10_000, RestError(503, None))
    pauses: list[float] = []
    assert not update_final(jobs, job.id, sleep=pauses.append, status=JobStatus.DONE)
    assert jobs.writes == FINAL_WRITE_ATTEMPTS
    assert 25 <= sum(pauses) <= 40


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503])
def test_a_timeout_a_rate_limit_and_a_server_error_are_retried(status: int) -> None:
    jobs, job = make(1, RestError(status, None))
    assert update_final(jobs, job.id, sleep=lambda _: None, status=JobStatus.DONE)
    assert jobs.writes == 2


def test_a_network_error_is_retried() -> None:
    jobs, job = make(1, ConnectionError("down"))
    assert update_final(jobs, job.id, sleep=lambda _: None, status=JobStatus.DONE)


@pytest.mark.parametrize(
    "error",
    [
        RestError(400, None),
        RestError(401, None),
        RestError(404, None),
        ValueError("x"),
    ],
)
def test_a_refusal_that_means_the_row_is_gone_or_wrong_is_not_retried(error: Exception) -> None:
    jobs, job = make(10_000, error)
    pauses: list[float] = []
    assert not update_final(jobs, job.id, sleep=pauses.append, status=JobStatus.DONE)
    assert jobs.writes == 1
    assert pauses == []


def test_a_row_that_has_already_ended_counts_as_written_and_is_not_retried() -> None:
    # SupabaseJobStore finds no active row for a status write on an ended job and raises KeyError.
    jobs, job = make(10_000, KeyError("j"))
    pauses: list[float] = []
    assert update_final(jobs, job.id, sleep=pauses.append, status=JobStatus.DONE)
    assert jobs.writes == 1
    assert pauses == []
