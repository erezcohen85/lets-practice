from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol, runtime_checkable

# Supabase Storage as the processor sees it: one private bucket, object paths
# {user_id}/{piece_id}/... Phase 9 adds the real implementation behind this Protocol.


@dataclass(frozen=True)
class StoredObject:
    """A file in a folder: its name inside the folder, and when it was first written."""

    name: str
    created_at: datetime


@runtime_checkable
class Storage(Protocol):
    """Read and write files in the pieces bucket."""

    def download(self, path: str) -> bytes:
        """Return the file's bytes; a missing path raises FileNotFoundError."""
        ...

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        """Write the file, replacing any file at that path."""
        ...

    def list_objects(self, folder: str) -> list[StoredObject]:
        """The files directly inside `folder` (no trailing slash); none for an unknown folder."""
        ...

    def delete(self, paths: Sequence[str]) -> None:
        """Remove the files; a path with no file is not an error."""
        ...

    def copy(self, source: str, destination: str) -> None:
        """Copy a file inside the bucket, content type included. `destination` should be a new
        path: the real Storage refuses an existing one (the fake replaces it). A missing source
        raises FileNotFoundError in the fakes; the real Storage raises its RestError."""
        ...


class InMemoryStorage:
    """A Storage held in a dict."""

    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self._files: dict[str, tuple[bytes, str]] = {}
        self._created: dict[str, datetime] = {}
        self._clock = clock or (lambda: datetime.now(UTC))

    def download(self, path: str) -> bytes:
        try:
            return self._files[path][0]
        except KeyError:
            raise FileNotFoundError(path) from None

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        self._files[path] = (bytes(data), content_type)
        self._created.setdefault(path, self._clock())

    def list_objects(self, folder: str) -> list[StoredObject]:
        prefix = f"{folder}/"
        return [
            StoredObject(path[len(prefix) :], self._created[path])
            for path in sorted(self._files)
            if path.startswith(prefix) and "/" not in path[len(prefix) :]
        ]

    def delete(self, paths: Sequence[str]) -> None:
        for path in paths:
            self._files.pop(path, None)
            self._created.pop(path, None)

    def copy(self, source: str, destination: str) -> None:
        try:
            data, content_type = self._files[source]
        except KeyError:
            raise FileNotFoundError(source) from None
        self.upload(destination, data, content_type)

    # --- test helpers (fake only) -----------------------------------------------------------

    def content_type(self, path: str) -> str:
        """Return the content type the file was uploaded with."""
        try:
            return self._files[path][1]
        except KeyError:
            raise FileNotFoundError(path) from None

    def paths(self) -> list[str]:
        """Return every stored path, sorted."""
        return sorted(self._files)

    def age(self, path: str, by: timedelta) -> None:
        """Make the file `by` older than it is."""
        self._created[path] -= by
