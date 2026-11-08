import logging
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.safe_log import scrubbed

# Runs Audiveris (optical music recognition, a Java program) on a part's PDF and hands back the
# sheet XML of every page. The orchestrator only sees the OmrEngine Protocol; tests use the fake.


def _repo_root(module_file: Path) -> Path:
    """The repository of a checkout. The image is too shallow for it, and uses $AUDIVERIS_HOME."""
    parents = module_file.parents
    return parents[min(4, len(parents) - 1)]


REPO = _repo_root(Path(__file__).resolve())
AUDIVERIS_TAR = REPO / "repos" / "audiveris" / "app" / "build" / "distributions" / "app-5.12.0.tar"
AUDIVERIS_CACHE = Path.home() / ".cache" / "lets-practice" / "audiveris"
AUDIVERIS_TIMEOUT = 1800  # seconds

_SHEET_XML = re.compile(r"sheet#(\d+)/sheet#\1\.xml")
_MAX_DETAIL = 200  # characters of Audiveris's own words that go to the log
# What the user is told when Audiveris fails. Its own words are a third party's free text and the
# job's error is read by members of the piece (M-2), so they go to the server's log instead.
FAILED_SENTENCE = (
    "The score reader could not read this file. Check that the PDF opens normally and try again."
)
_log = logging.getLogger("uvicorn.error")


class OmrError(ValueError):
    """Reading the score failed; the message is one sentence a user may see."""


@dataclass(frozen=True)
class OmrBook:
    """What Audiveris left: the .omr file and the sheet#N.xml text of each page, in page order."""

    omr_path: Path
    sheets: list[str]
    sheet_numbers: list[int]  # Audiveris's own 1-based page number of each entry in `sheets`


@runtime_checkable
class OmrEngine(Protocol):
    """Read a part's PDF into Audiveris sheets."""

    def run(self, pdf: Path, out_dir: Path) -> OmrBook:
        """Run the OMR on the PDF, writing into `out_dir`, and return the book it made."""
        ...


def audiveris_home(
    cache: Path = AUDIVERIS_CACHE, tar: Path = AUDIVERIS_TAR, env: dict[str, str] | None = None
) -> Path:
    """The Audiveris install: $AUDIVERIS_HOME, else the tar extracted once into `cache`.

    The tar sits in repos/ (a read-only reference clone), so it is never extracted there.
    """
    env = dict(os.environ) if env is None else env
    if override := env.get("AUDIVERIS_HOME"):
        home = Path(override)
        if not (home / "bin" / "Audiveris").exists():
            raise OmrError(f"AUDIVERIS_HOME is set to {home}, which has no bin/Audiveris.")
        return home
    home = cache / tar.stem
    if (home / "bin" / "Audiveris").exists():
        return home
    if not tar.exists():
        raise OmrError(
            f"The score reader (Audiveris) is not installed: {tar.name} was not found "
            "and AUDIVERIS_HOME is not set."
        )
    cache.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=cache, prefix=".extract-"))
    try:  # extract aside, then rename: a half-extracted install is never picked up
        with tarfile.open(tar) as archive:
            archive.extractall(staging, filter="data")
        os.replace(staging / tar.stem, home)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return home


def java_installed() -> bool:
    """Audiveris's launcher uses $JAVA_HOME/bin/java if set, else java on the PATH."""
    if java_home := os.environ.get("JAVA_HOME"):
        return (Path(java_home) / "bin" / "java").exists()
    return shutil.which("java") is not None


# A log line: date, time, level, [the sheet], source file:line | message
_LOG_LINE = re.compile(r"^\S+ \S+ (WARN|ERROR)\s+\[([^\]]*)\]\s+\S+:\d+\s*\|\s*(.*)$")
_SHEET_NUMBER = re.compile(r"#(\d+)$")
# warnings that come with any run, and the ones that only report a failure already told
_LOG_NOISE = (
    "TesseractOrder",
    "no recognized header clef",
    "Error processing stub",
    "Exception occurred",
    "Exit forced",
)


def _reason_in_logs(logs: list[Path]) -> tuple[str, bool]:
    """Why the run failed, from what Audiveris logged, and whether the text is a sentence this
    module wrote (True) or Audiveris's own words (False); ("", False) when it says nothing.

    A sheet with no multi-line staff (one-line percussion staves) is ignored for "a too low
    interline value"; any other failure gives its first warning that is not noise.
    """
    first = ""
    for log in logs:
        try:
            text = log.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            found = _LOG_LINE.match(line.strip())
            if found is None:
                continue
            sheet, message = found.group(2), found.group(3)
            if "too low interline value" in message:
                number = _SHEET_NUMBER.search(sheet)
                page = number.group(1) if number else "1"
                return (
                    f"The score reader failed: page {page} has no five-line staves "
                    "(one-line percussion staves cannot be read yet).",
                    True,
                )
            message = " ".join(message.removeprefix(sheet).split())
            if not first and message and not any(noise in message for noise in _LOG_NOISE):
                first = message[:_MAX_DETAIL]
    return first, False


def _failure_line(text: str) -> str:
    """The line that says why: a Java crash ends in "... 8 more", which says nothing, so take its
    deepest cause, else its exception line, else the last line."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    causes = [line for line in lines if line.startswith("Caused by:")]
    crashes = [line for line in lines if line.startswith("Exception in thread")]
    found = causes[-1] if causes else crashes[0] if crashes else lines[-1] if lines else ""
    return found[:_MAX_DETAIL]


def _read_book(omr_path: Path) -> OmrBook:
    """Open the .omr zip and read its sheet XML in page order."""
    try:
        with zipfile.ZipFile(omr_path) as book:
            numbers = sorted(
                int(found[1]) for name in book.namelist() if (found := _SHEET_XML.fullmatch(name))
            )
            sheets = [
                book.read(f"sheet#{number}/sheet#{number}.xml").decode("utf-8")
                for number in numbers
            ]
    except (zipfile.BadZipFile, UnicodeDecodeError):
        raise OmrError("The score reader wrote a result that is unreadable.") from None
    if not sheets:
        raise OmrError("The score reader found no music in the PDF.")
    return OmrBook(omr_path=omr_path, sheets=sheets, sheet_numbers=numbers)


class AudiverisEngine:
    """Audiveris in batch mode, started as a subprocess."""

    def __init__(self, home: Path | None = None, timeout: float = AUDIVERIS_TIMEOUT) -> None:
        self._home = home  # looked up on the first run, so building the engine needs no install
        self._timeout = timeout

    def run(self, pdf: Path, out_dir: Path) -> OmrBook:
        if not java_installed():
            raise OmrError("Reading the score needs Java, which is not installed on this server.")
        home = self._home or audiveris_home()
        out_dir.mkdir(parents=True, exist_ok=True)
        # It runs inside out_dir, so the paths it is given must not be relative to anything else.
        pdf, out_dir = pdf.resolve(), out_dir.resolve()
        command = [str(home / "bin" / "Audiveris"), "-batch", "-export", "-output", str(out_dir)]
        try:
            run = subprocess.run(
                [*command, str(pdf)],
                cwd=out_dir,
                capture_output=True,
                text=True,
                timeout=self._timeout,
            )
        except subprocess.TimeoutExpired:
            raise OmrError(
                f"Reading the score took over {int(self._timeout // 60)} minutes; gave up."
            ) from None
        except OSError:  # the launcher is missing or cannot start
            raise OmrError(
                "The score reader (Audiveris) is not installed on this server."
            ) from None
        logs = sorted(out_dir.glob(f"{pdf.stem}-*.log"))  # one per run, tens of KB
        told, vetted = _reason_in_logs(logs) if run.returncode != 0 else ("", False)
        for log in logs:
            log.unlink(missing_ok=True)
        if run.returncode != 0:
            if vetted:  # the percussion sentence is ours and tells the user what to do
                raise OmrError(told)
            detail = told or _failure_line(run.stderr) or _failure_line(run.stdout)
            reason = detail or f"exit code {run.returncode}"
            _log.error(
                "Audiveris failed on %s (exit %s): %s", pdf.name, run.returncode, scrubbed(reason)
            )
            raise OmrError(FAILED_SENTENCE)
        omr_path = out_dir / f"{pdf.stem}.omr"
        if not omr_path.exists():
            raise OmrError("The score reader finished but wrote no result.")
        return _read_book(omr_path)


class FakeOmrEngine:
    """Returns the sheets it was built with, written out as a real .omr zip."""

    def __init__(self, sheets: list[str]) -> None:
        self._sheets = sheets

    def run(self, pdf: Path, out_dir: Path) -> OmrBook:
        if not pdf.exists():
            raise OmrError(f"The score file {pdf.name} was not found.")
        out_dir.mkdir(parents=True, exist_ok=True)
        omr_path = out_dir / f"{pdf.stem}.omr"
        with zipfile.ZipFile(omr_path, "w") as book:
            for number, xml in enumerate(self._sheets, start=1):
                book.writestr(f"sheet#{number}/sheet#{number}.xml", xml)
        return OmrBook(
            omr_path=omr_path,
            sheets=list(self._sheets),
            sheet_numbers=list(range(1, len(self._sheets) + 1)),
        )
