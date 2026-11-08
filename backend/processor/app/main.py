import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Annotated, Any, TypeVar

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError
from starlette.requests import ClientDisconnect

from app import staging
from app.auth import AuthUser, current_user
from app.body_limit import BodyLimitMiddleware
from app.deps import Models, Services, get_models, get_services
from app.job_end import give_back_refused_piece, update_final
from app.job_runner import JobRunner
from app.jobs import INTERRUPTED, JobBusy
from app.pipeline.analysis import load_analysis
from app.pipeline.models import Job, JobKind, JobStatus
from app.pipeline.name_suggester import Suggestion
from app.pipeline.plan_limits import decide
from app.pipeline.real_stages import startup_notes
from app.pipeline.refit import check_timing_size, fill_timing
from app.pipeline.run_folder import RunFolderError, parse_timing
from app.sample_piece import SampleCopyFailed, SamplePieceService
from app.settings import Settings, get_settings
from app.splits import SplitRefused, SplitService
from app.suggest import NameService


class JobRequest(BaseModel):
    """Body of the job routes."""

    piece_id: str = Field(min_length=1)


class FillRequest(BaseModel):
    """A timing as the editor shows it; the route does not save it."""

    timing: dict[str, Any]


class CutRequest(BaseModel):
    """The kept parts of a staged split: each has an id for its row, a name and its pages."""

    piece_id: str = Field(min_length=1)
    parts: list[Any]


class SuggestRequest(BaseModel):
    """The clues of a form's piece: the recording's file name and the staged first PDF."""

    recording_name: str | None = Field(default=None, max_length=300)
    staged_id: str | None = None


class JobResponse(BaseModel):
    """The job the request created, which has not run yet."""

    job_id: str
    status: JobStatus


router = APIRouter()


_Model = TypeVar("_Model", bound=BaseModel)


async def _body_of(request: Request, model: type[_Model]) -> _Model:
    """Read and check a JSON body. A caller who is not signed in never gets here (`job_body`)."""
    try:
        raw = await request.body()
    except ClientDisconnect:
        # The client left, or the body limit turned it away (its 413 is already sent).
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="The request was cut off."
        ) from None
    try:
        return model.model_validate_json(raw)
    except ValidationError as error:
        # Answered as FastAPI answers a body it checked itself (422), without echoing what was sent.
        raise RequestValidationError(
            error.errors(include_url=False, include_context=False, include_input=False)
        ) from None


async def job_body(
    request: Request, _user: Annotated[AuthUser, Depends(current_user)]
) -> JobRequest:
    """The body of a job route, read only after the caller is known.

    FastAPI reads and parses a declared body before the dependencies run, so an anonymous caller
    would have its body parsed, whatever it held, before being told 401. Taking the request and
    reading it here, below `current_user`, makes the 401 come first.
    """
    return await _body_of(request, JobRequest)


async def fill_body(
    request: Request, _user: Annotated[AuthUser, Depends(current_user)]
) -> FillRequest:
    """The body of the fill route, read only after the caller is known."""
    return await _body_of(request, FillRequest)


async def cut_body(
    request: Request, _user: Annotated[AuthUser, Depends(current_user)]
) -> CutRequest:
    """The body of the cut route, read only after the caller is known."""
    return await _body_of(request, CutRequest)


async def suggest_body(
    request: Request, _user: Annotated[AuthUser, Depends(current_user)]
) -> SuggestRequest:
    """The body of the form's suggest-name route, read only after the caller is known."""
    return await _body_of(request, SuggestRequest)


BUSY = "This piece is still being prepared; try again when it is done."
CANNOT_START = "The server could not start this job right now. Try again in a moment."
# A queued or running row that this process does not run and nothing has touched for this long is
# left over from a process that died (or a final write that never landed): it is ended so it does
# not lock the piece. Every update counts, progress writes too.
STALE_AFTER = timedelta(minutes=10)
_log = logging.getLogger("uvicorn.error")


@lru_cache(maxsize=1)
def get_job_runner() -> JobRunner:
    """The process's one worker; tests override this dependency."""
    return JobRunner()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


UPLOAD_KINDS = {JobKind.PROCESS_PIECE, JobKind.ADD_PARTS}


def _plan_refusal(limit: str) -> HTTPException:
    """403 with the limit's key, which the browser turns into the "Not in your plan" prompt."""
    return HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "plan_limit", "limit": limit})


def _require_plan(state: dict[str, Any], action: str, **facts: Any) -> None:
    """403 plan_limit when the caller's plan does not allow `action` (see plan_limits.decide)."""
    limit = decide(state, action, **facts)
    if limit is not None:
        raise _plan_refusal(limit)


def _require_owner(services: Services, piece_id: str, user: AuthUser) -> str:
    """The piece's owner id, when `user` owns the piece; 404 for no such piece, 403 for another's.

    The processor uses the service key, which bypasses RLS, so this check (and the one for uploads)
    is its only protection: every route that acts on a piece goes through here.
    """
    owner_id = services.db.get_piece_owner(piece_id)
    if owner_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="piece not found")
    if owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="not your piece")
    return owner_id


def _end_stale_job(services: Services, runner: JobRunner, piece_id: str) -> bool:
    """True when the piece's blocking row was left over and has been ended (or has ended itself),
    so creating the job may be tried again. Never ends a job this process runs or has waiting."""
    try:
        active = services.jobs.active_job(piece_id)
        if active is None:
            return True
        if runner.knows(active.job.id):
            return False
        if datetime.now(UTC) - active.updated_at < STALE_AFTER:
            return False
        ended = update_final(
            services.jobs, active.job.id, status=JobStatus.ERROR, error=INTERRUPTED
        )
    except Exception as error:
        _log.warning("could not check the piece's blocking job (%s)", type(error).__name__)
        return False
    if ended:
        _log.warning("ended job %s, left over from a process that stopped", active.job.id)
    return True


def _create_job(kind: JobKind, piece_id: str, services: Services, runner: JobRunner) -> Job:
    try:
        return services.jobs.create(piece_id, kind)
    except JobBusy:
        if not _end_stale_job(services, runner, piece_id):
            raise HTTPException(status.HTTP_409_CONFLICT, detail=BUSY) from None
    try:  # once more, now that the left-over row is ended
        return services.jobs.create(piece_id, kind)
    except JobBusy:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=BUSY) from None


def _require_upload_allowed(
    services: Services, state: dict[str, Any], piece_id: str, kind: JobKind
) -> None:
    """The plan allows the piece's parts, and Advanced Reading for the ticked parts that this job
    will read: all of them for process-piece (it reads and renders every part again), only the
    ones without pages yet for add-parts. The job checks again, and records, when it reads."""
    db = services.db
    _require_plan(state, "add_parts", parts_after=len(db.list_score_files(piece_id)))
    to_read = (
        db.list_score_files(piece_id)
        if kind is JobKind.PROCESS_PIECE
        else db.list_unrendered_score_files(piece_id)
    )
    ticked = [row for row in to_read if row.get("box_check")]
    if ticked:
        _require_plan(state, "advanced_reading", parts=len(ticked))


def _claim_piece(services: Services, piece_id: str) -> None:
    """Count a piece again that a job-time refusal gave back, before its job is created; 403 when
    the plan has no room for it any more (the piece is then taken back like any other refused
    first processing)."""
    limit = services.db.claim_piece(piece_id)
    if limit is not None:
        give_back_refused_piece(services, piece_id)
        raise _plan_refusal(limit)


def _start_job(
    kind: JobKind, body: JobRequest, user: AuthUser, services: Services, runner: JobRunner
) -> JobResponse:
    """Check the caller, create the job, and answer while it runs in the background."""
    _require_owner(services, body.piece_id, user)
    state = services.db.plan_state(user.id, body.piece_id)
    if kind in UPLOAD_KINDS:
        try:
            _require_upload_allowed(services, state, body.piece_id, kind)
        except HTTPException:
            if (
                kind is JobKind.PROCESS_PIECE
            ):  # a refused first processing: piece deleted, slot back
                give_back_refused_piece(services, body.piece_id)
            raise
        if kind is JobKind.PROCESS_PIECE:
            _claim_piece(services, body.piece_id)
    else:
        _require_plan(state, "realign")
    job = _create_job(kind, body.piece_id, services, runner)
    try:
        runner.submit(job, services)
    except Exception as error:
        # No worker took it: end the row, or it would lock the piece until the next start.
        _log.warning("job %s could not be started (%s)", job.id, type(error).__name__)
        update_final(services.jobs, job.id, status=JobStatus.ERROR, error=CANNOT_START)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=CANNOT_START) from None
    if kind is JobKind.REALIGN:  # counted once the job is on its way
        services.db.record_usage(user.id, "realign", body.piece_id, None)
    return JobResponse(job_id=job.id, status=job.status)


@router.post("/jobs/process-piece")
def process_piece(
    body: Annotated[JobRequest, Depends(job_body)],
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    runner: Annotated[JobRunner, Depends(get_job_runner)],
) -> JobResponse:
    return _start_job(JobKind.PROCESS_PIECE, body, user, services, runner)


@router.post("/jobs/realign")
def realign(
    body: Annotated[JobRequest, Depends(job_body)],
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    runner: Annotated[JobRunner, Depends(get_job_runner)],
) -> JobResponse:
    return _start_job(JobKind.REALIGN, body, user, services, runner)


@router.post("/jobs/add-parts")
def add_parts(
    body: Annotated[JobRequest, Depends(job_body)],
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    runner: Annotated[JobRunner, Depends(get_job_runner)],
) -> JobResponse:
    return _start_job(JobKind.ADD_PARTS, body, user, services, runner)


@router.post("/pieces/{piece_id}/fill")
def fill_bars(
    piece_id: str,
    body: Annotated[FillRequest, Depends(fill_body)],
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Give the bars of the timing that have no locator a time, holding the others. Saves nothing.

    Not a job: it works from the saved analysis and answers at once.
    """
    owner_id = _require_owner(services, piece_id, user)
    try:
        timing = parse_timing(body.model_dump())
        check_timing_size(timing)
    except RunFolderError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(error)) from None
    analysis = load_analysis(services.storage, owner_id, piece_id)
    if analysis is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This recording has not been analysed."
        )
    try:
        filled = fill_timing(timing, analysis)
    except RunFolderError as error:
        raise HTTPException(422, detail=str(error)) from None
    return filled.model_dump(by_alias=True, exclude_unset=True)


def _require_staged_id(staged_id: str) -> None:
    if not staging.is_staged_id(staged_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="split not found")


def _refusal(error: SplitRefused) -> HTTPException:
    code = status.HTTP_410_GONE if error.expired else status.HTTP_400_BAD_REQUEST
    return HTTPException(code, detail=str(error))


@router.post("/splits/{staged_id}/propose")
def propose_split(
    staged_id: str,
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    models: Annotated[Models, Depends(get_models)],
) -> dict[str, Any]:
    """Read the PDF the caller staged at `{user}/staging/{staged_id}.pdf` and propose its parts."""
    _require_staged_id(staged_id)
    _require_plan(services.db.plan_state(user.id), "split_pdf")
    try:
        return SplitService(services.storage, models.reader).propose(user.id, staged_id)
    except SplitRefused as error:
        raise _refusal(error) from None


@router.post("/splits/{staged_id}/cut")
def cut_split(
    staged_id: str,
    body: Annotated[CutRequest, Depends(cut_body)],
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    models: Annotated[Models, Depends(get_models)],
) -> dict[str, Any]:
    """Write the kept parts of a staged split into the caller's piece; the browser adds the rows."""
    _require_staged_id(staged_id)
    owner_id = _require_owner(services, body.piece_id, user)
    _require_plan(services.db.plan_state(user.id), "split_pdf")
    try:
        made = SplitService(services.storage, models.reader).cut(
            owner_id, body.piece_id, staged_id, body.parts
        )
    except SplitRefused as error:
        raise _refusal(error) from None
    return {"parts": made}


def _suggestion(suggestion: Suggestion) -> dict[str, Any]:
    return {"name": suggestion.name, "source": suggestion.source, "note": suggestion.note}


@router.post("/pieces/{piece_id}/suggest-name")
def suggest_piece_name(
    piece_id: str,
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    models: Annotated[Models, Depends(get_models)],
) -> dict[str, Any]:
    """A title for a piece the caller owns, from its recording's name and first page."""
    owner_id = _require_owner(services, piece_id, user)
    _require_plan(services.db.plan_state(user.id), "suggest_name")
    service = NameService(services.db, services.storage, models.suggester)
    return _suggestion(service.for_piece(owner_id, piece_id))


@router.post("/suggest-name")
def suggest_form_name(
    body: Annotated[SuggestRequest, Depends(suggest_body)],
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
    models: Annotated[Models, Depends(get_models)],
) -> dict[str, Any]:
    """A title for a piece that is still the New piece form."""
    if body.staged_id is not None:
        _require_staged_id(body.staged_id)
    _require_plan(services.db.plan_state(user.id), "suggest_name")
    service = NameService(services.db, services.storage, models.suggester)
    return _suggestion(service.for_form(user.id, body.recording_name, body.staged_id))


@router.post("/sample-piece")
def claim_sample_piece(
    user: Annotated[AuthUser, Depends(current_user)],
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Give the caller their copy of the sample piece, once. No plan gate: the database decides
    (a master, room under the plan's limits, not given before)."""
    try:
        outcome, piece_id = SamplePieceService(services.db, services.storage).claim_piece(user.id)
    except SampleCopyFailed:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "sample_failed"}
        ) from None
    _log.info("sample piece: %s", outcome)
    return {"status": outcome, "piece_id": piece_id}


def _end_interrupted_jobs() -> None:
    """End the jobs a redeploy or crash cut off, so nobody waits on them for ever.

    The service starts even if this cannot be done (Supabase down, a malformed key): /health must
    answer, and the next start tries again. The log says what happened, never a value.
    """
    try:
        ended = get_services().jobs.fail_interrupted()
    except Exception as error:
        # the type only: a message can hold the project's address, and a bad key must not be quoted
        _log.warning(
            "Could not end interrupted jobs at startup (%s); the service starts anyway.",
            type(error).__name__,
        )
        return
    if ended:
        _log.warning("ended %d interrupted jobs", ended)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app; CORS origins come from settings (read from the environment when None)."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        for note in startup_notes(settings):
            _log.warning(note)
        get_job_runner()  # made here, once, so two first requests cannot make two workers
        if not settings.use_fakes and settings.has_supabase:
            _end_interrupted_jobs()
        yield
        # Only startup ends unfinished jobs: with overlapping deploys a stopping process must not
        # end a job the new one has taken (it sweeps itself).
        get_job_runner().shutdown()
        get_job_runner.cache_clear()  # a stopped pool takes no work; the next app gets a new one

    app = FastAPI(title="Let's Practice processor", lifespan=lifespan)
    # The last middleware added is the outermost: CORS wraps the body limit, so the browser
    # can read a 413.
    app.add_middleware(BodyLimitMiddleware)
    # Bearer tokens travel in the Authorization header, so cookies and credentials stay off.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(router)
    return app


app = create_app()
