from app.deps import Services
from app.jobs import run_job
from app.pipeline.models import Job


class InlineRunner:
    """Runs the job in the request, so a test can read how it ended."""

    def submit(self, job: Job, services: Services) -> None:
        run_job(job, services)

    def knows(self, job_id: str) -> bool:
        return False  # a job has ended by the time the request is answered

    def shutdown(self) -> None:
        pass
