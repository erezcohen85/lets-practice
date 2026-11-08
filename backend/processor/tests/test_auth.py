import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Annotated, Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import (
    AuthError,
    AuthUser,
    HttpJwksSource,
    TokenVerifier,
    current_user,
    get_token_verifier,
)

HS_SECRET = "unit-test-shared-secret-0123456789abcdef"
SUB = "7b0e6c1e-0f55-4d6a-9d0c-5f2f6f1f7a11"

EC_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_EC_KEY = ec.generate_private_key(ec.SECP256R1())
RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJwks:
    """A JwksSource backed by a dict of kid to public key; counts lookups."""

    def __init__(self, keys: dict[str, Any]) -> None:
        self.keys = keys
        self.lookups: list[str] = []

    def get_signing_key(self, kid: str) -> Any:
        self.lookups.append(kid)
        return self.keys[kid]


def claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    base: dict[str, Any] = {
        "sub": SUB,
        "aud": "authenticated",
        "role": "authenticated",
        "iat": now,
        "exp": now + 3600,
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def hs256_token(payload: dict[str, Any] | None = None, secret: str = HS_SECRET) -> str:
    return jwt.encode(payload if payload is not None else claims(), secret, algorithm="HS256")


def es256_token(
    payload: dict[str, Any] | None = None, key: Any = EC_KEY, kid: str | None = "ec-1"
) -> str:
    headers = {"kid": kid} if kid is not None else None
    return jwt.encode(
        payload if payload is not None else claims(), key, algorithm="ES256", headers=headers
    )


def rs256_token(payload: dict[str, Any] | None = None, kid: str = "rsa-1") -> str:
    return jwt.encode(
        payload if payload is not None else claims(),
        RSA_KEY,
        algorithm="RS256",
        headers={"kid": kid},
    )


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def raw_token(header: dict[str, Any], payload: dict[str, Any], signature: bytes = b"") -> str:
    """Build a JWT by hand, bypassing PyJWT's refusal to sign with unsafe keys."""
    head = b64url(json.dumps(header).encode())
    body = b64url(json.dumps(payload).encode())
    return f"{head}.{body}.{b64url(signature)}"


def hmac_signed_with(key_bytes: bytes, header: dict[str, Any], payload: dict[str, Any]) -> str:
    signing_input = raw_token(header, payload).rsplit(".", 1)[0]
    digest = hmac.new(key_bytes, signing_input.encode(), hashlib.sha256).digest()
    return raw_token(header, payload, digest)


def jwks_verifier() -> tuple[TokenVerifier, FakeJwks]:
    source = FakeJwks({"ec-1": EC_KEY.public_key(), "rsa-1": RSA_KEY.public_key()})
    return TokenVerifier(jwks=source), source


# ---- HS256 -------------------------------------------------------------------------------


def test_valid_hs256_token_gives_user() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    assert verifier.verify(hs256_token()) == AuthUser(id=SUB, email=None)


def test_email_claim_is_carried() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    user = verifier.verify(hs256_token(claims(email="erez@example.com")))
    assert user == AuthUser(id=SUB, email="erez@example.com")


def test_auth_user_is_frozen() -> None:
    user = AuthUser(id=SUB, email=None)
    with pytest.raises(AttributeError):
        user.id = "someone-else"  # type: ignore[misc]


def test_wrong_hs256_secret_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError):
        verifier.verify(hs256_token(secret="another-secret-0123456789abcdef-0123456789"))


def test_tampered_payload_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    head, _, sig = hs256_token().split(".")
    forged = b64url(json.dumps(claims(sub="someone-else")).encode())
    with pytest.raises(AuthError):
        verifier.verify(f"{head}.{forged}.{sig}")


# ---- ES256 and RS256 via JWKS ------------------------------------------------------------


def test_valid_es256_token_gives_user() -> None:
    verifier, source = jwks_verifier()
    assert verifier.verify(es256_token()) == AuthUser(id=SUB, email=None)
    assert source.lookups == ["ec-1"]


def test_valid_rs256_token_gives_user() -> None:
    verifier, _ = jwks_verifier()
    assert verifier.verify(rs256_token()) == AuthUser(id=SUB, email=None)


def test_es256_signed_by_another_key_is_rejected() -> None:
    verifier, _ = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(es256_token(key=OTHER_EC_KEY))


def test_unknown_kid_is_rejected() -> None:
    verifier, _ = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(es256_token(kid="rotated-away"))


def test_missing_kid_is_rejected_without_a_lookup() -> None:
    verifier, source = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(es256_token(kid=None))
    assert source.lookups == []


def test_failing_jwks_source_is_an_auth_error() -> None:
    class Broken:
        def get_signing_key(self, kid: str) -> Any:
            raise OSError("jwks endpoint down")

    with pytest.raises(AuthError):
        TokenVerifier(jwks=Broken()).verify(es256_token())


# ---- claims ------------------------------------------------------------------------------


def test_expired_token_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    expired = hs256_token(claims(exp=int(time.time()) - 3600))
    with pytest.raises(AuthError, match="expired"):
        verifier.verify(expired)


def test_expiry_within_leeway_is_accepted() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    just_expired = hs256_token(claims(exp=int(time.time()) - 30))
    assert verifier.verify(just_expired).id == SUB


def test_expiry_beyond_leeway_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError, match="expired"):
        verifier.verify(hs256_token(claims(exp=int(time.time()) - 120)))


def test_wrong_audience_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError):
        verifier.verify(hs256_token(claims(aud="service")))


def test_missing_audience_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError):
        verifier.verify(hs256_token(claims(aud=None)))


def test_missing_sub_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError):
        verifier.verify(hs256_token(claims(sub=None)))


def test_empty_sub_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError):
        verifier.verify(hs256_token(claims(sub="")))


def test_missing_exp_is_rejected() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET)
    with pytest.raises(AuthError):
        verifier.verify(hs256_token(claims(exp=None)))


def test_custom_audience() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET, audience="processor")
    assert verifier.verify(hs256_token(claims(aud="processor"))).id == SUB
    with pytest.raises(AuthError):
        verifier.verify(hs256_token())


# ---- algorithm discipline ----------------------------------------------------------------


def test_alg_none_is_rejected() -> None:
    token = raw_token({"alg": "none", "typ": "JWT"}, claims())
    with pytest.raises(AuthError):
        TokenVerifier(hs256_secret=HS_SECRET).verify(token)
    verifier, _ = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(token)


def test_alg_none_with_kid_is_rejected() -> None:
    token = raw_token({"alg": "none", "kid": "ec-1"}, claims())
    verifier, source = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(token)
    assert source.lookups == []


def test_hs256_signed_with_public_key_is_rejected_in_jwks_mode() -> None:
    """Algorithm confusion: the public key is not a secret, so HS256 must not verify with it."""
    public_pem = EC_KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    forged = hmac_signed_with(public_pem, {"alg": "HS256", "typ": "JWT", "kid": "ec-1"}, claims())
    verifier, source = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(forged)
    assert source.lookups == []


def test_hs256_signed_with_public_key_is_rejected_when_a_secret_is_also_set() -> None:
    public_pem = EC_KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    forged = hmac_signed_with(public_pem, {"alg": "HS256", "typ": "JWT", "kid": "ec-1"}, claims())
    verifier = TokenVerifier(hs256_secret=HS_SECRET, jwks=FakeJwks({"ec-1": EC_KEY.public_key()}))
    with pytest.raises(AuthError):
        verifier.verify(forged)


def test_genuine_hs256_token_is_rejected_in_jwks_only_mode() -> None:
    verifier, _ = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(hs256_token())


def test_es256_token_is_rejected_in_secret_only_mode() -> None:
    with pytest.raises(AuthError):
        TokenVerifier(hs256_secret=HS_SECRET).verify(es256_token())


def test_both_modes_accept_their_own_algorithm() -> None:
    verifier = TokenVerifier(hs256_secret=HS_SECRET, jwks=FakeJwks({"ec-1": EC_KEY.public_key()}))
    assert verifier.verify(hs256_token()).id == SUB
    assert verifier.verify(es256_token()).id == SUB


def test_unsupported_algorithm_is_rejected() -> None:
    token = jwt.encode(claims(), HS_SECRET * 2, algorithm="HS512")
    with pytest.raises(AuthError):
        TokenVerifier(hs256_secret=HS_SECRET).verify(token)


def test_verifier_with_nothing_configured_rejects_everything() -> None:
    with pytest.raises(AuthError):
        TokenVerifier().verify(hs256_token())


@pytest.mark.parametrize("token", ["", "abc", "a.b.c", "not.a.jwt.at.all", "e30.e30."])
def test_malformed_tokens_are_rejected(token: str) -> None:
    verifier, _ = jwks_verifier()
    with pytest.raises(AuthError):
        verifier.verify(token)


def test_auth_error_never_contains_the_token() -> None:
    token = hs256_token(secret="another-secret-0123456789abcdef-0123456789")
    with pytest.raises(AuthError) as excinfo:
        TokenVerifier(hs256_secret=HS_SECRET).verify(token)
    assert token not in str(excinfo.value)
    assert token.split(".")[1] not in str(excinfo.value)


# ---- HttpJwksSource (no network: the client's fetch is stubbed) --------------------------


class StubJWKClient(jwt.PyJWKClient):
    """A PyJWKClient whose HTTP fetch returns a canned key set and counts calls."""

    def __init__(self, jwks: dict[str, Any] | Exception) -> None:
        super().__init__("https://example.invalid/auth/v1/.well-known/jwks.json")
        self.jwks = jwks
        self.fetches = 0

    def fetch_data(self) -> Any:
        self.fetches += 1
        if isinstance(self.jwks, Exception):
            raise self.jwks
        return self.jwks


def jwk_set(**public_keys: Any) -> dict[str, Any]:
    keys = []
    for kid, public_key in public_keys.items():
        algorithm = jwt.get_algorithm_by_name("ES256" if "ec" in kid else "RS256")
        jwk = json.loads(algorithm.to_jwk(public_key))
        jwk.update({"kid": kid, "use": "sig"})
        keys.append(jwk)
    return {"keys": keys}


def test_http_jwks_source_verifies_a_token_and_caches_the_key_set() -> None:
    client = StubJWKClient(jwk_set(**{"ec-1": EC_KEY.public_key()}))
    source = HttpJwksSource("https://example.invalid/jwks.json", client=client)
    verifier = TokenVerifier(jwks=source)
    assert verifier.verify(es256_token()).id == SUB
    assert verifier.verify(es256_token()).id == SUB
    assert client.fetches == 1


def test_http_jwks_source_unknown_kid_is_an_auth_error() -> None:
    client = StubJWKClient(jwk_set(**{"ec-1": EC_KEY.public_key()}))
    source = HttpJwksSource("https://example.invalid/jwks.json", client=client)
    with pytest.raises(AuthError):
        TokenVerifier(jwks=source).verify(es256_token(kid="rotated-away"))


def test_http_jwks_source_fetch_failure_is_an_auth_error() -> None:
    client = StubJWKClient(jwt.PyJWKClientConnectionError("endpoint down"))
    source = HttpJwksSource("https://example.invalid/jwks.json", client=client)
    with pytest.raises(AuthError):
        TokenVerifier(jwks=source).verify(es256_token())


def test_http_jwks_source_builds_a_real_client_without_touching_the_network() -> None:
    source = HttpJwksSource("https://example.invalid/auth/v1/.well-known/jwks.json")
    assert isinstance(source, HttpJwksSource)


def test_http_jwks_source_names_itself_so_a_cloudflare_front_does_not_refuse_urllib() -> None:
    # Python-urllib's default user agent is answered 403 by some CDN-fronted JWKS endpoints
    # (PyJWT #1121), which would read as a 401 on every call. Only the constructed client's
    # headers are looked at: nothing is fetched.
    source = HttpJwksSource("https://example.invalid/auth/v1/.well-known/jwks.json")
    assert source._client.headers["User-Agent"] == "lets-practice-processor"


def test_http_jwks_source_rejects_a_non_http_url() -> None:
    with pytest.raises(ValueError):
        HttpJwksSource("file:///etc/passwd")


# ---- current_user through FastAPI --------------------------------------------------------


def make_client(verifier: TokenVerifier) -> TestClient:
    app = FastAPI()

    @app.get("/me")
    def me(user: Annotated[AuthUser, Depends(current_user)]) -> dict[str, str | None]:
        return {"id": user.id, "email": user.email}

    app.dependency_overrides[get_token_verifier] = lambda: verifier
    return TestClient(app)


def assert_unauthorized(response: Any) -> None:
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_no_authorization_header_is_401() -> None:
    assert_unauthorized(make_client(TokenVerifier(hs256_secret=HS_SECRET)).get("/me"))


def test_basic_scheme_is_401() -> None:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    assert_unauthorized(client.get("/me", headers={"Authorization": "Basic xyz"}))


def test_bearer_without_a_token_is_401() -> None:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    assert_unauthorized(client.get("/me", headers={"Authorization": "Bearer"}))
    assert_unauthorized(client.get("/me", headers={"Authorization": "Bearer "}))


def test_bearer_with_a_bad_token_is_401_and_does_not_echo_it() -> None:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    bad = hs256_token(secret="another-secret-0123456789abcdef-0123456789")
    response = client.get("/me", headers={"Authorization": f"Bearer {bad}"})
    assert_unauthorized(response)
    assert bad not in response.text


def test_expired_bearer_is_401() -> None:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    expired = hs256_token(claims(exp=int(time.time()) - 3600))
    assert_unauthorized(client.get("/me", headers={"Authorization": f"Bearer {expired}"}))


def test_valid_bearer_gives_200_with_the_user_id() -> None:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    response = client.get("/me", headers={"Authorization": f"Bearer {hs256_token()}"})
    assert response.status_code == 200
    assert response.json() == {"id": SUB, "email": None}


def test_scheme_is_case_insensitive() -> None:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    response = client.get("/me", headers={"Authorization": f"bearer {hs256_token()}"})
    assert response.status_code == 200


def test_valid_es256_bearer_through_the_app() -> None:
    verifier, _ = jwks_verifier()
    response = make_client(verifier).get(
        "/me", headers={"Authorization": f"Bearer {es256_token()}"}
    )
    assert response.status_code == 200
    assert response.json()["id"] == SUB


def test_default_verifier_is_built_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    get_token_verifier.cache_clear()
    monkeypatch.setenv("SUPABASE_JWT_SECRET", HS_SECRET)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    try:
        assert get_token_verifier().verify(hs256_token()).id == SUB
    finally:
        get_token_verifier.cache_clear()


# ---- a refused token leaves a reason in the log, and never the token ------------------------


def refused_logs(caplog: pytest.LogCaptureFixture, header: str | None) -> tuple[Any, str]:
    client = make_client(TokenVerifier(hs256_secret=HS_SECRET))
    headers = {} if header is None else {"Authorization": header}
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        response = client.get("/me", headers=headers)
    return response, caplog.text


def test_a_refused_token_logs_the_reason(caplog: pytest.LogCaptureFixture) -> None:
    bad = hs256_token(secret="another-secret-0123456789abcdef-0123456789")
    response, log = refused_logs(caplog, f"Bearer {bad}")
    assert response.status_code == 401
    assert "token refused: bad signature" in log


def test_an_expired_token_logs_that_it_expired(caplog: pytest.LogCaptureFixture) -> None:
    old = hs256_token(claims(exp=int(time.time()) - 3600))
    _, log = refused_logs(caplog, f"Bearer {old}")
    assert "token refused: token expired" in log


def test_the_log_holds_neither_the_token_nor_the_email(caplog: pytest.LogCaptureFixture) -> None:
    secret_email = "someone.private@example.com"
    bad = hs256_token(
        claims(email=secret_email), secret="another-secret-0123456789abcdef-0123456789"
    )
    _, log = refused_logs(caplog, f"Bearer {bad}")
    assert "token refused" in log
    assert bad not in log
    assert bad.split(".")[1] not in log  # the payload part, which carries the email
    assert secret_email not in log
    assert SUB not in log


def test_a_malformed_token_logs_the_reason_only(caplog: pytest.LogCaptureFixture) -> None:
    _, log = refused_logs(caplog, "Bearer not-a-jwt-at-all")
    assert "token refused: malformed token" in log
    assert "not-a-jwt-at-all" not in log


def test_a_good_token_logs_nothing(caplog: pytest.LogCaptureFixture) -> None:
    response, log = refused_logs(caplog, f"Bearer {hs256_token()}")
    assert response.status_code == 200
    assert "token refused" not in log
