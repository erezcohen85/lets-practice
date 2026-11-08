"""Which stored files a job may read.

`score_files.storage_path` and `audio_sources.url_or_path` are written by the owner (migration
0001 lets an owner write any value), and the processor downloads them with the service key, which
sees every user's files. So before a stage downloads such a path it must lie inside the piece's
own folder, `{owner_id}/{piece_id}/`.
"""

from urllib.parse import quote

NOT_IN_PIECE_FOLDER = "The stored file is not in this piece's folder."


def require_piece_path(path: str, owner_id: str, piece_id: str) -> str:
    """Return `path` when it names a file inside `{owner_id}/{piece_id}/`, else raise ValueError.

    Refused: a path that does not start with the whole folder (so `{piece_id}x/` does not pass),
    a folder with no file name, a leading `/`, a backslash, a control character, any `.`, `..` or
    empty segment, and `%`, `?` and `#`, which a storage client that decodes or re-parses the name
    could turn into `..` or a query (`%2e%2e`, `x?y`). Names the app builds never hold them.
    The message is one plain sentence and never holds the path, because it reaches the job's
    error, which the user reads.
    """
    folder = f"{owner_id}/{piece_id}/"
    if (
        not path.startswith(folder)
        or "\\" in path
        or any(char in path for char in "%?#")
        or any(ord(char) < 32 or ord(char) == 127 for char in path)
    ):
        raise ValueError(NOT_IN_PIECE_FOLDER)
    segments = path[len(folder) :].split("/")
    if any(segment in ("", ".", "..") for segment in segments):
        raise ValueError(NOT_IN_PIECE_FOLDER)
    return path


def plain_object_name(path: str) -> str:
    """The object name as it goes in a Storage URL, or ValueError before any request goes out.

    The check of `require_piece_path` is on the text; a client that decoded the name afterwards
    could still turn `%2e%2e` into `..`. So a name holding anything that decodes or re-parses is
    refused here too, and what passes is quoted so it stays one plain name.
    """
    segments = path.split("/")
    if (
        "\\" in path
        or any(char in path for char in "%?#")
        or any(ord(char) < 32 or ord(char) == 127 for char in path)
        or any(segment in ("", ".", "..") for segment in segments)
    ):
        raise ValueError(NOT_IN_PIECE_FOLDER)
    return "/".join(quote(segment, safe="") for segment in segments)


def plain_prefix(folder: str) -> str:
    """A folder as the Storage list call takes it, or ValueError (the rules of an object name)."""
    plain_object_name(folder)
    return folder
