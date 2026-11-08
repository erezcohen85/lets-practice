import logging
import time

import pytest

from app.safe_log import scrubbed


def test_an_email_a_token_and_a_bearer_are_removed_and_the_rest_is_kept() -> None:
    text = (
        "GET https://x.supabase.co/rest/v1/jobs?id=eq.1&token=abc&apikey=k1 "
        "for Erez.Cohen+a@example.co.il, Authorization: Bearer abc.def.ghi, key sb_secret_Zz9"
    )
    clean = scrubbed(text)
    for secret in ("=abc", "k1", "Erez", "example.co.il", "abc.def.ghi", "sb_secret_Zz9"):
        assert secret not in clean
    assert "https://x.supabase.co/rest/v1/jobs?id=eq.1" in clean


def test_log_failure_names_the_type_and_the_frames_but_not_the_secret(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.safe_log import log_failure

    def inner() -> None:
        raise ValueError("bad row for a@b.com")

    try:
        inner()
    except ValueError as error:
        log_failure(logging.getLogger("uvicorn.error"), "job stopped", error)
    assert "job stopped" in caplog.text
    assert "ValueError" in caplog.text
    assert "bad row" in caplog.text
    assert "a@b.com" not in caplog.text
    assert "inner" in caplog.text


@pytest.mark.parametrize(
    "text, secret",
    [
        ("mail erez%40example.com sent", "erez%40example.com"),
        ("body {'access_token': 'opaque123', 'a': 1}", "opaque123"),
        ('body {"apikey": "legacykey123"}', "legacykey123"),
        ("GET /videoplayback?expire=1&sig=AOq0QJ8w&lsig=ABc12", "AOq0QJ8w"),
        ("GET /o?X-Amz-Signature=deadbeef01&X-Amz-Credential=AKIAXYZ", "deadbeef01"),
        ("key sk-ant-api03-AbC_dEf-123 used", "sk-ant-api03-AbC_dEf-123"),
        ("dsn postgres://user:pa55@db.example.com/x", "pa55"),
        ("headers api-key=abc123 x", "abc123"),
        ("headers x-api-key=def456 x", "def456"),
        ("headers X-Api-Key: ghi789 next", "ghi789"),
        ("config apikey: unquoted99, other", "unquoted99"),
        ("Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"),
        ("sent Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ== twice", "QWxhZGRpbjpvcGVuIHNlc2FtZQ"),
    ],
)
def test_more_shapes_of_secret_are_removed(text: str, secret: str) -> None:
    assert secret not in scrubbed(text)


def test_an_error_whose_text_cannot_be_made_is_still_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.safe_log import log_failure

    class Unprintable(Exception):
        def __str__(self) -> str:
            raise RuntimeError("no text")

    log_failure(logging.getLogger("uvicorn.error"), "job stopped", Unprintable())
    assert "Unprintable" in caplog.text


def test_ordinary_words_that_look_like_the_patterns_are_left_alone() -> None:
    text = "Basic information about the key: see the monkey=1 and token count"
    assert scrubbed(text) == text


def test_a_very_long_unbroken_text_is_cut_and_scrubbed_fast() -> None:
    start = time.monotonic()
    result = scrubbed("a" * 80_000)
    assert time.monotonic() - start < 2.0
    assert len(result) < 5_000


def _straddling(secret: str, kept: int) -> str:
    """Text whose cut at the limit falls after the first `kept` characters of `secret`."""
    start = 4_000 - kept
    return ("ab " * 2_000)[: start - 1] + " " + secret + " and more text after it"


@pytest.mark.parametrize(
    ("secret", "head", "kept"),
    [
        ("erez.cohen.long.name@gmail.com", "erez.cohen", 26),
        ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl", "eyJhbGci", 30),
        ("'access_token': 'abcdefghijklmnopqrstuvwxyz0123456789'", "abcdefg", 40),
        ("postgres://user:pa55word-is-long@db.example.com/postgres", "pa55word", 24),
        ("Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZSBub3cgcGxlYXNl", "QWxhZGRp", 29),
        ("Bearer abcdefghijklmnopqrstuvwxyz0123456789", "abcdefg", 30),
    ],
)
def test_a_secret_that_straddles_the_cut_is_not_let_out(secret: str, head: str, kept: int) -> None:
    text = _straddling(secret, kept)
    assert text.index(secret) + kept == 4_000
    assert head not in scrubbed(text)


def test_a_six_thousand_character_token_is_not_let_out() -> None:
    token = "eyJ" + "A" * 3_000 + "." + "B" * 3_000
    result = scrubbed(f"failed for {token}")
    assert "AAAA" not in result
    assert "BBBB" not in result


def test_a_long_traceback_keeps_its_tail_where_the_error_was_raised() -> None:
    from app.safe_log import FRAMES_LIMIT

    text = "".join(f'  File "f{i}.py", line {i}, in call\n' for i in range(2_000))
    text += '  File "raised.py", line 7, in boom\n'
    result = scrubbed(text, FRAMES_LIMIT, keep="tail")
    assert 'File "raised.py", line 7, in boom' in result
    assert 'File "f0.py"' not in result
    assert len(result) <= FRAMES_LIMIT + 10
