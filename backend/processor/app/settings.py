import os

from pydantic import BaseModel, ConfigDict, Field

JWKS_PATH = "/auth/v1/.well-known/jwks.json"

_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})


class Settings(BaseModel):
    """Processor configuration read from environment variables."""

    model_config = ConfigDict(frozen=True)

    supabase_url: str = ""
    supabase_jwt_secret: str | None = Field(default=None, repr=False)
    supabase_jwks_url: str | None = None
    allowed_origins: tuple[str, ...] = ()
    use_fakes: bool = False
    anthropic_api_key: str | None = Field(default=None, repr=False)
    supabase_secret_key: str | None = Field(default=None, repr=False)

    @property
    def has_supabase(self) -> bool:
        """True when any Supabase setting is present, i.e. the services are not the fakes."""
        return bool(
            self.supabase_url
            or self.supabase_jwt_secret
            or self.supabase_jwks_url
            or self.supabase_secret_key
        )

    def missing_for_real_services(self) -> list[str]:
        """Names of the variables the real services need and that are not set (never a value)."""
        needed = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SECRET_KEY": self.supabase_secret_key,
        }
        return [name for name, value in needed.items() if not value]


def _env(name: str) -> str:
    """Return the trimmed value of an environment variable; unset and empty are both ''."""
    return os.environ.get(name, "").strip()


def _env_bool(name: str) -> bool:
    raw = _env(name).lower()
    if not raw or raw in _FALSE:
        return False
    if raw in _TRUE:
        return True
    raise ValueError(f"{name} must be true or false, not {raw!r}")


def get_settings() -> Settings:
    """Read settings from os.environ on every call; never reads a .env file."""
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    jwks_url = _env("SUPABASE_JWKS_URL") or (f"{supabase_url}{JWKS_PATH}" if supabase_url else "")
    # A pasted address often ends in "/", which the browser's Origin header never does.
    origins = tuple(
        o for o in (o.strip().rstrip("/") for o in _env("ALLOWED_ORIGINS").split(",")) if o
    )
    return Settings(
        supabase_url=supabase_url,
        supabase_jwt_secret=_env("SUPABASE_JWT_SECRET") or None,
        supabase_jwks_url=jwks_url or None,
        allowed_origins=origins,
        use_fakes=_env_bool("USE_FAKES"),
        anthropic_api_key=_env("ANTHROPIC_API_KEY") or None,
        supabase_secret_key=_env("SUPABASE_SECRET_KEY") or None,
    )
