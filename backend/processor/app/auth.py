import functools
import logging
from dataclasses import dataclass
from typing import Annotated, Any, Protocol
from urllib.parse import urlparse

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.settings import get_settings

LEEWAY_SECONDS = 60
# urllib's own user agent is answered 403 by some CDN-fronted JWKS endpoints (PyJWT #1121),
# which would read as a 401.
JWKS_USER_AGENT = "lets-practice-processor"
_log = logging.getLogger("uvicorn.error")
ASYMMETRIC_ALGORITHMS = ("ES256", "RS256")


class AuthError(Exception):
    """A token failed verification; the message is a short reason that never holds the token."""


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None


class JwksSource(Protocol):
    def get_signing_key(self, kid: str) -> Any:
        """Return the public key (as PyJWT accepts it) for a key id, or raise."""
        ...


class HttpJwksSource:
    """Fetch signing keys from a JWKS URL, with PyJWKClient's key-set cache and refresh cooldown."""

    def __init__(
        self,
        url: str,
        *,
        client: jwt.PyJWKClient | None = None,
        lifespan: float = 600,
        timeout: float = 5,
    ) -> None:
        if urlparse(url).scheme.lower() not in ("http", "https"):
            raise ValueError("the JWKS URL must start with http:// or https://")
        self._client = client or jwt.PyJWKClient(
            url, lifespan=lifespan, timeout=timeout, headers={"User-Agent": JWKS_USER_AGENT}
        )

    def get_signing_key(self, kid: str) -> Any:
        try:
            return self._client.get_signing_key(kid).key
        except jwt.PyJWTError:
            raise AuthError("signing key not found") from None


class TokenVerifier:
    """Verify Supabase access tokens: HS256 against a shared secret, ES256/RS256 against JWKS."""

    def __init__(
        self,
        *,
        hs256_secret: str | None = None,
        jwks: JwksSource | None = None,
        audience: str = "authenticated",
    ) -> None:
        self._secret = hs256_secret or None
        self._jwks = jwks
        self._audience = audience
        allowed: list[str] = []
        if self._secret:
            allowed.append("HS256")
        if self._jwks is not None:
            allowed.extend(ASYMMETRIC_ALGORITHMS)
        self._allowed = frozenset(allowed)

    def verify(self, token: str) -> AuthUser:
        """Return the user a valid token belongs to, or raise AuthError."""
        if not self._allowed:
            raise AuthError("token verification is not configured")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise AuthError("malformed token") from None
        alg = header.get("alg")
        # The key is chosen by the header's algorithm, which must be on the allowed list, and
        # decode() is pinned to that one algorithm: a public key can never act as an HMAC secret.
        if not isinstance(alg, str) or alg not in self._allowed:
            raise AuthError("algorithm not allowed")
        key = self._secret if alg == "HS256" else self._lookup_key(header.get("kid"))
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=self._audience,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "sub", "aud"]},
            )
        except jwt.ExpiredSignatureError:
            raise AuthError("token expired") from None
        except jwt.InvalidAudienceError:
            raise AuthError("wrong audience") from None
        except jwt.MissingRequiredClaimError as err:
            raise AuthError(f"missing claim {err.claim}") from None
        except jwt.InvalidSignatureError:
            raise AuthError("bad signature") from None
        except Exception:
            raise AuthError("invalid token") from None
        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise AuthError("missing claim sub")
        email = claims.get("email")
        return AuthUser(id=sub, email=email if isinstance(email, str) else None)

    def _lookup_key(self, kid: object) -> Any:
        if not isinstance(kid, str) or not kid:
            raise AuthError("missing key id")
        assert self._jwks is not None  # asymmetric algorithms are only allowed with a source
        try:
            return self._jwks.get_signing_key(kid)
        except Exception:
            raise AuthError("signing key not found") from None


@functools.lru_cache(maxsize=1)
def get_token_verifier() -> TokenVerifier:
    """Build the process-wide verifier from settings; tests override this dependency."""
    settings = get_settings()
    jwks = HttpJwksSource(settings.supabase_jwks_url) if settings.supabase_jwks_url else None
    return TokenVerifier(hs256_secret=settings.supabase_jwt_secret, jwks=jwks)


def _unauthorized(reason: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=reason,
        headers={"WWW-Authenticate": "Bearer"},
    )


def current_user(
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> AuthUser:
    """FastAPI dependency: the user behind an "Authorization: Bearer <jwt>" header, else 401."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("missing bearer token")
    try:
        return verifier.verify(token.strip())
    except AuthError as err:
        # The reason is a short fixed phrase that never holds the token, a claim or the email.
        _log.warning("token refused: %s", err)
        raise _unauthorized(str(err)) from None
