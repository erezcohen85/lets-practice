"""require_piece_path: a stored path a user wrote must lie inside the piece's own folder."""

import pytest

from app.pipeline.storage_paths import require_piece_path

OWNER, PIECE = "user-owner", "piece-1"


@pytest.mark.parametrize(
    "path",
    [
        f"{OWNER}/{PIECE}/score.pdf",
        f"{OWNER}/{PIECE}/parts/flute.pdf",
        f"{OWNER}/{PIECE}/recording.mp3",
        f"{OWNER}/{PIECE}/a..b.pdf",  # dots inside a name are fine
    ],
)
def test_a_path_inside_the_piece_folder_is_returned_unchanged(path: str) -> None:
    assert require_piece_path(path, OWNER, PIECE) == path


@pytest.mark.parametrize(
    "path",
    [
        "user-other/piece-9/score.pdf",  # another user's folder
        f"{OWNER}/piece-9/score.pdf",  # another piece of the same user
        f"{OWNER}/{PIECE}x/a.pdf",  # only starts with the right text
        f"{OWNER}x/{PIECE}/a.pdf",
        f"{OWNER}/{PIECE}",  # the folder itself, no file
        f"{OWNER}/{PIECE}/",  # empty file name
        f"{OWNER}/{PIECE}/parts/",  # empty file name in a sub folder
        f"{OWNER}/{PIECE}/../piece-9/a.pdf",  # climbs out
        f"{OWNER}/{PIECE}/parts/../../../user-other/x.pdf",
        f"{OWNER}/{PIECE}/./a.pdf",
        f"{OWNER}/{PIECE}//a.pdf",  # empty segment
        f"/{OWNER}/{PIECE}/a.pdf",  # leading slash
        f"{OWNER}\\{PIECE}\\a.pdf",  # backslashes
        f"{OWNER}/{PIECE}/..\\a.pdf",
        f"{OWNER}/{PIECE}/a\x00.pdf",  # control character
        f"{OWNER}/{PIECE}/%2e%2e/%2e%2e/v/q/x.pdf",  # encoded dots, decoded by a client
        f"{OWNER}/{PIECE}/x%2f..%2f..%2fy",  # an encoded slash
        f"{OWNER}/{PIECE}/x?y",  # a query
        f"{OWNER}/{PIECE}/x#y",  # a fragment
        f"{OWNER}/{PIECE}/100%.pdf",
        "",
    ],
)
def test_a_path_outside_the_piece_folder_is_refused(path: str) -> None:
    with pytest.raises(ValueError):
        require_piece_path(path, OWNER, PIECE)


def test_the_refusal_is_a_plain_sentence_that_holds_no_path() -> None:
    secret = "user-other/piece-9/secret-score.pdf"
    with pytest.raises(ValueError) as caught:
        require_piece_path(secret, OWNER, PIECE)
    message = str(caught.value)
    assert message == "The stored file is not in this piece's folder."
    assert "secret" not in message and "user-other" not in message
