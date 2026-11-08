from pathlib import Path

import pytest
from pydantic import ValidationError

from app.settings import Settings, get_settings

ENV_NAMES = (
    "SUPABASE_URL",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_JWKS_URL",
    "ALLOWED_ORIGINS",
    "USE_FAKES",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_defaults_when_nothing_is_set() -> None:
    settings = get_settings()
    assert settings.supabase_url == ""
    assert settings.supabase_jwt_secret is None
    assert settings.supabase_jwks_url is None
    assert settings.allowed_origins == ()
    assert settings.use_fakes is False


def test_jwks_url_is_derived_from_supabase_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    assert get_settings().supabase_jwks_url == (
        "https://abc.supabase.co/auth/v1/.well-known/jwks.json"
    )


def test_trailing_slash_on_supabase_url_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")
    settings = get_settings()
    assert settings.supabase_url == "https://abc.supabase.co"
    assert settings.supabase_jwks_url == "https://abc.supabase.co/auth/v1/.well-known/jwks.json"


def test_explicit_jwks_url_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setenv("SUPABASE_JWKS_URL", "https://keys.example.com/jwks.json")
    assert get_settings().supabase_jwks_url == "https://keys.example.com/jwks.json"


def test_empty_values_count_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """.env.example lists every name with an empty value."""
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setenv("SUPABASE_JWKS_URL", "")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    monkeypatch.setenv("USE_FAKES", "")
    settings = get_settings()
    assert settings.supabase_jwks_url == "https://abc.supabase.co/auth/v1/.well-known/jwks.json"
    assert settings.supabase_jwt_secret is None
    assert settings.allowed_origins == ()
    assert settings.use_fakes is False


def test_no_jwks_url_without_supabase_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "s3cret-value-for-hs256-tests-0123456789")
    settings = get_settings()
    assert settings.supabase_jwks_url is None
    assert settings.supabase_jwt_secret == "s3cret-value-for-hs256-tests-0123456789"


def test_allowed_origins_are_split_and_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "ALLOWED_ORIGINS", "http://localhost:5173, https://app.example.com ,,https://b.example.com"
    )
    assert get_settings().allowed_origins == (
        "http://localhost:5173",
        "https://app.example.com",
        "https://b.example.com",
    )


def test_a_trailing_slash_on_an_origin_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    # A pasted address often ends in "/", and the browser's Origin header never does: CORS would
    # silently not match.
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        "https://app.example.com/, http://localhost:5173/ ,https://b.example.com//,/",
    )
    assert get_settings().allowed_origins == (
        "https://app.example.com",
        "http://localhost:5173",
        "https://b.example.com",
    )


def test_env_example_names_each_variable_once() -> None:
    # A repeated name (a copied file with only the first filled in) leaves the later empty line
    # in force.
    path = Path(__file__).resolve().parents[1] / ".env.example"
    names = [
        line.split("=", 1)[0]
        for line in path.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    ]
    assert len(names) == len(set(names)), [n for n in names if names.count(n) > 1]
    assert "SUPABASE_SECRET_KEY" in names


@pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on", " True "])
def test_use_fakes_true_spellings(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.setenv("USE_FAKES", raw)
    assert get_settings().use_fakes is True


@pytest.mark.parametrize("raw", ["0", "false", "False", "no", "off"])
def test_use_fakes_false_spellings(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.setenv("USE_FAKES", raw)
    assert get_settings().use_fakes is False


def test_use_fakes_rejects_unknown_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("USE_FAKES", "maybe")
    with pytest.raises(ValueError, match="USE_FAKES"):
        get_settings()


def test_settings_are_frozen() -> None:
    settings = get_settings()
    with pytest.raises(ValidationError):
        settings.use_fakes = True  # type: ignore[misc]


def test_secret_is_not_in_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "do-not-print-this-secret-0123456789")
    assert "do-not-print-this-secret" not in repr(get_settings())
    assert "do-not-print-this-secret" not in str(get_settings())


def test_values_are_read_on_every_call(monkeypatch: pytest.MonkeyPatch) -> None:
    assert get_settings().use_fakes is False
    monkeypatch.setenv("USE_FAKES", "1")
    assert get_settings().use_fakes is True


def test_dotenv_file_is_never_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("SUPABASE_URL=https://from-dotenv.example.com\n")
    monkeypatch.chdir(tmp_path)
    assert get_settings().supabase_url == ""


def test_settings_model_defaults() -> None:
    assert Settings() == get_settings()
