import threading
from dataclasses import dataclass

from app.db import Database, InMemoryDatabase
from app.jobs import InMemoryJobStore, JobStore
from app.pipeline.name_suggester import ClaudeNameSuggester, NameSuggester
from app.pipeline.pdf_split import ClaudePageHeaderReader, PageHeaderReader
from app.settings import Settings, get_settings
from app.storage import InMemoryStorage, Storage
from app.supabase_db import SupabaseDatabase, SupabaseJobStore
from app.supabase_rest import SupabaseRest, SupabaseStorage


@dataclass(frozen=True)
class Services:
    """Everything a job needs from the outside world, behind the Protocols."""

    db: Database
    storage: Storage
    jobs: JobStore


_fakes: Services | None = None
_fakes_lock = threading.Lock()


def _fake_services() -> Services:
    """Return the one process-wide set of in-memory services, built on first use."""
    global _fakes
    with _fakes_lock:
        if _fakes is None:
            _fakes = Services(
                db=InMemoryDatabase(), storage=InMemoryStorage(), jobs=InMemoryJobStore()
            )
        return _fakes


_real: Services | None = None


def _real_services(settings: Settings) -> Services:
    """The one process-wide set of real services (one HTTP connection pool), built on first use.

    A half configuration is refused by name; the message never holds a value, least of all the key.
    """
    global _real
    with _fakes_lock:
        if _real is None:
            if missing := settings.missing_for_real_services():
                raise RuntimeError(f"{' and '.join(missing)} must be set for the real services")
            rest = SupabaseRest(settings.supabase_url, settings.supabase_secret_key or "")
            _real = Services(
                db=SupabaseDatabase(rest),
                storage=SupabaseStorage(rest),
                jobs=SupabaseJobStore(rest),
            )
        return _real


def get_services() -> Services:
    """FastAPI dependency: in-memory fakes with USE_FAKES or no Supabase settings, else the real."""
    settings = get_settings()
    if settings.use_fakes or not settings.has_supabase:
        return _fake_services()
    return _real_services(settings)


@dataclass(frozen=True)
class Models:
    """The vision model's two jobs outside the pipeline: reading page headers to split a PDF, and
    suggesting a name. None without an API key (splitting then proposes one part, and a name
    falls back to the file's). Tests override `get_models` with fakes."""

    reader: PageHeaderReader | None
    suggester: NameSuggester | None


def get_models() -> Models:
    """FastAPI dependency: the Haiku-backed models when there is a key and the services are real."""
    settings = get_settings()
    if settings.use_fakes or not settings.anthropic_api_key:
        return Models(None, None)
    return Models(ClaudePageHeaderReader(), ClaudeNameSuggester())
