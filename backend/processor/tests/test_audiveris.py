import stat
import subprocess
import tarfile
import zipfile
from pathlib import Path

import pymupdf
import pytest

from app.pipeline.audiveris import (
    FAILED_SENTENCE,
    AudiverisEngine,
    FakeOmrEngine,
    OmrBook,
    OmrEngine,
    OmrError,
    _failure_line,
    _repo_root,
    audiveris_home,
)
from app.pipeline.omr import parse_omr_sheet, parse_omr_systems

FIXTURE = Path(__file__).parent / "fixtures" / "omr_sheet.xml"


@pytest.fixture
def sheet_xml() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def write_omr(path: Path, sheets: dict[int, str]) -> None:
    """A .omr project file (a zip) holding sheet#N/sheet#N.xml for each page."""
    with zipfile.ZipFile(path, "w") as book:
        book.writestr("book.xml", "<book/>")
        for number, xml in sheets.items():
            book.writestr(f"sheet#{number}/sheet#{number}.xml", xml)


def stub_home(tmp_path: Path, body: str) -> Path:
    """A stand-in install whose bin/Audiveris is a shell script running `body`."""
    home = tmp_path / "stub-home"
    (home / "bin").mkdir(parents=True)
    script = home / "bin" / "Audiveris"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)
    return home


@pytest.fixture(autouse=True)
def java_installed(
    request: pytest.FixtureRequest, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every test but the Java and real ones sees a Java; the stub scripts never start it."""
    if request.node.get_closest_marker("real"):
        return
    java = tmp_path / "jdk" / "bin" / "java"
    java.parent.mkdir(parents=True)
    java.write_text("#!/bin/sh\n")
    java.chmod(0o755)
    monkeypatch.setenv("JAVA_HOME", str(java.parent.parent))


def make_pdf(tmp_path: Path, name: str = "part.pdf") -> Path:
    pdf = tmp_path / name
    pdf.write_bytes(b"%PDF-1.4 stand-in")
    return pdf


def make_tar(directory: Path) -> Path:
    """A stand-in for the Audiveris distribution: app-5.12.0/bin/Audiveris inside a tar."""
    source = directory / "src"
    source.mkdir(parents=True)
    script = source / "Audiveris"
    script.write_text("#!/bin/sh\nexit 0\n")
    script.chmod(0o755)
    tar_path = directory / "dist" / "app-5.12.0.tar"
    tar_path.parent.mkdir()
    with tarfile.open(tar_path, "w") as tar:
        tar.add(script, arcname="app-5.12.0/bin/Audiveris")
    return tar_path


# --- audiveris_home ----------------------------------------------------------------------------


def test_audiveris_is_extracted_once_into_the_cache_never_next_to_the_tar(tmp_path: Path) -> None:
    tar = make_tar(tmp_path)
    cache = tmp_path / "cache"
    home = audiveris_home(cache=cache, tar=tar, env={})
    assert home == cache / "app-5.12.0"
    assert (home / "bin" / "Audiveris").stat().st_mode & stat.S_IXUSR
    (home / "marker").write_text("x")
    assert audiveris_home(cache=cache, tar=tar, env={}) == home
    assert (home / "marker").exists()  # not extracted again
    assert [p.name for p in tar.parent.iterdir()] == ["app-5.12.0.tar"]
    assert [p.name for p in cache.iterdir()] == ["app-5.12.0"]  # no staging left behind


def test_audiveris_home_can_be_set_in_the_environment(tmp_path: Path) -> None:
    other = stub_home(tmp_path, "exit 0")
    found = audiveris_home(
        cache=tmp_path / "c", tar=tmp_path / "none.tar", env={"AUDIVERIS_HOME": str(other)}
    )
    assert found == other


def test_an_audiveris_home_without_the_launcher_is_refused(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(OmrError, match="AUDIVERIS_HOME"):
        audiveris_home(
            cache=tmp_path / "c", tar=tmp_path / "t.tar", env={"AUDIVERIS_HOME": str(empty)}
        )


def test_audiveris_home_without_a_tar_says_how_to_fix_it(tmp_path: Path) -> None:
    with pytest.raises(OmrError, match="not installed"):
        audiveris_home(cache=tmp_path / "c", tar=tmp_path / "missing.tar", env={})


# --- AudiverisEngine ---------------------------------------------------------------------------


def test_the_engine_passes_batch_export_output_and_the_pdf(tmp_path: Path) -> None:
    prebuilt = tmp_path / "prebuilt.omr"
    write_omr(prebuilt, {1: "<sheet/>"})
    out = tmp_path / "out"
    out.mkdir()
    pdf = make_pdf(tmp_path)
    home = stub_home(tmp_path, f'echo "$@" > "$4/args.txt"; cp "{prebuilt}" "$4/part.omr"')
    AudiverisEngine(home=home).run(pdf, out)
    assert (out / "args.txt").read_text().split() == [
        "-batch",
        "-export",
        "-output",
        str(out),
        str(pdf),
    ]


def test_the_book_holds_the_sheets_in_page_order(tmp_path: Path, sheet_xml: str) -> None:
    prebuilt = tmp_path / "prebuilt.omr"
    write_omr(prebuilt, {10: "<sheet n='10'/>", 2: "<sheet n='2'/>", 1: sheet_xml})
    out = tmp_path / "out"
    out.mkdir()
    home = stub_home(tmp_path, f'cp "{prebuilt}" "$4/part.omr"')
    book = AudiverisEngine(home=home).run(make_pdf(tmp_path), out)
    assert book.omr_path == out / "part.omr"
    assert book.sheet_numbers == [1, 2, 10]
    assert book.sheets == [sheet_xml, "<sheet n='2'/>", "<sheet n='10'/>"]


def test_the_output_folder_is_made_when_missing_and_may_be_relative(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    prebuilt = tmp_path / "prebuilt.omr"
    write_omr(prebuilt, {1: "<sheet/>"})
    home = stub_home(tmp_path, f'echo "$@" > "$4/args.txt"; cp "{prebuilt}" "$4/part.omr"')
    make_pdf(tmp_path)
    monkeypatch.chdir(tmp_path)
    AudiverisEngine(home=home).run(Path("part.pdf"), Path("fresh/out"))
    args = (tmp_path / "fresh" / "out" / "args.txt").read_text().split()
    assert args[3:] == [
        str((tmp_path / "fresh" / "out").resolve()),
        str(tmp_path.resolve() / "part.pdf"),
    ]


def test_the_log_files_audiveris_leaves_are_removed(tmp_path: Path) -> None:
    prebuilt = tmp_path / "prebuilt.omr"
    write_omr(prebuilt, {1: "<sheet/>"})
    out = tmp_path / "out"
    out.mkdir()
    home = stub_home(tmp_path, f'cp "{prebuilt}" "$4/part.omr"; echo x > "$4/part-20260101.log"')
    AudiverisEngine(home=home).run(make_pdf(tmp_path), out)
    assert sorted(p.name for p in out.iterdir()) == ["part.omr"]


def test_a_failed_run_logs_the_last_line_of_its_error_output(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    home = stub_home(
        tmp_path,
        "echo 'warming up' >&2; echo 'java.lang.OutOfMemoryError: heap' >&2; echo >&2; exit 3",
    )
    with pytest.raises(OmrError) as caught:
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert str(caught.value) == FAILED_SENTENCE
    assert "OutOfMemoryError: heap" in caplog.text


# What Audiveris wrote to its log on 2026-11-02, reading a part on one-line percussion staves.
INTERLINE_LOG = (
    "2026-11-02 13:46:25,410 INFO [part]   SheetStub.java:1300 | Loaded image #1 2700x3599\n"
    "2026-11-02 13:46:26,019 WARN [part]   SheetStub.java:433  | part   With a too low "
    "interline value of 6 pixels,  either this sheet contains no multi-line staves,  or the "
    "picture resolution is too low (try 300 DPI).   This interline value is NOT RELIABLE!\n"
    "2026-11-02 13:46:26,021 WARN [part]   Book.java:2063 | Error processing stub "
    "org.audiveris.omr.step.StepException: Sheet ignored\n"
    "java.util.concurrent.ExecutionException: org.audiveris.omr.step.StepException: Sheet ignored\n"
    "2026-11-02 13:46:26,598 WARN [part]   CLI.java:956  | Exception occurred "
    "java.lang.Exception: Error in export\n"
)


EXIT_FORCED = "WARN [] Main 310 | Exit forced. Failure"


def failing_with_log(tmp_path: Path, log: str, stderr: str = EXIT_FORCED) -> Path:
    """A launcher that leaves `log` as its run's log in the output folder and fails."""
    (tmp_path / "audiveris.log").write_text(log)
    return stub_home(
        tmp_path,
        f'cp "{tmp_path / "audiveris.log"}" "$4/part-20261102T1346.log"; '
        f'echo "{stderr}" >&2; exit 1',
    )


def test_a_page_without_five_line_staves_is_named_with_the_reason(tmp_path: Path) -> None:
    home = failing_with_log(tmp_path, INTERLINE_LOG)
    with pytest.raises(OmrError) as caught:
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert str(caught.value) == (
        "The score reader failed: page 1 has no five-line staves "
        "(one-line percussion staves cannot be read yet)."
    )


def test_the_page_of_a_sheet_comes_from_its_number(tmp_path: Path) -> None:
    home = failing_with_log(tmp_path, INTERLINE_LOG.replace("[part]", "[part#3]"))
    with pytest.raises(OmrError, match="page 3 has no five-line staves"):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")


def test_another_failure_gives_a_fixed_sentence_and_logs_the_first_warning(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    log = (
        "2026-11-02 22:56:00,001 WARN [part]   TesseractOrder.java:413  | TesseractOrder. "
        "Could not initialize TessBaseAPI languages: eng in legacy mode\n"
        "2026-11-02 22:55:36,829 WARN [part]   ClefBuilder.java:681  | "
        "Staff#1 no recognized header clef.\n"
        "2026-11-02 22:56:01,000 ERROR [part]  PdfLoader.java:88  | part   Cannot read the PDF: "
        "it is encrypted\n"
    )
    home = failing_with_log(tmp_path, log)
    with pytest.raises(OmrError) as caught:
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    # the tool's own words go to the log, not to the sentence members can read (M-2)
    assert str(caught.value) == FAILED_SENTENCE
    assert "encrypted" not in str(caught.value)
    assert "Cannot read the PDF: it is encrypted" in caplog.text


def test_a_log_with_nothing_telling_falls_back_to_the_error_output_in_the_log_only(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    home = failing_with_log(tmp_path, "2026-11-02 13:46:25,410 INFO [part] X.java:1 | fine\n")
    with pytest.raises(OmrError) as caught:
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert str(caught.value) == FAILED_SENTENCE
    assert "Exit forced. Failure" in caplog.text


def test_what_audiveris_prints_is_scrubbed_in_the_log(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    home = stub_home(
        tmp_path, "echo 'cannot open /x?token=abc123 for erez@example.com' >&2; exit 1"
    )
    with pytest.raises(OmrError):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert "cannot open" in caplog.text
    assert "abc123" not in caplog.text and "erez@example.com" not in caplog.text


def test_the_log_of_a_failed_run_is_removed_too(tmp_path: Path) -> None:
    home = failing_with_log(tmp_path, INTERLINE_LOG)
    out = tmp_path / "out"
    with pytest.raises(OmrError):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), out)
    assert list(out.glob("*.log")) == []


def test_a_failure_with_no_output_still_gives_a_sentence(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    home = stub_home(tmp_path, "exit 2")
    with pytest.raises(OmrError) as caught:
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert str(caught.value) == FAILED_SENTENCE
    assert "exit code 2" in caplog.text


def test_a_very_long_error_line_is_trimmed(tmp_path: Path) -> None:
    home = stub_home(tmp_path, "printf 'x%.0s' $(seq 1 2000) >&2; exit 1")
    with pytest.raises(OmrError) as caught:
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert str(caught.value) == FAILED_SENTENCE


def test_a_run_that_writes_no_book_says_so(tmp_path: Path) -> None:
    home = stub_home(tmp_path, "echo nothing written")
    with pytest.raises(OmrError, match="no result"):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")


def test_a_book_without_sheets_means_no_music_was_found(tmp_path: Path) -> None:
    prebuilt = tmp_path / "prebuilt.omr"
    write_omr(prebuilt, {})
    home = stub_home(tmp_path, f'cp "{prebuilt}" "$4/part.omr"')
    with pytest.raises(OmrError, match="no music"):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")


def test_a_book_that_is_not_a_zip_is_reported(tmp_path: Path) -> None:
    home = stub_home(tmp_path, 'echo junk > "$4/part.omr"')
    with pytest.raises(OmrError, match="unreadable"):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")


def test_a_run_that_takes_too_long_gives_up(tmp_path: Path) -> None:
    home = stub_home(tmp_path, "exec sleep 30")
    with pytest.raises(OmrError, match="took over 0 minutes; gave up"):
        AudiverisEngine(home=home, timeout=0.3).run(make_pdf(tmp_path), tmp_path / "out")


def test_the_default_timeout_is_thirty_minutes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[float] = []

    def too_slow(*args: object, timeout: float, **kwargs: object) -> None:
        seen.append(timeout)
        raise subprocess.TimeoutExpired("Audiveris", timeout)

    monkeypatch.setattr(subprocess, "run", too_slow)
    home = stub_home(tmp_path, "exit 0")
    with pytest.raises(OmrError, match="Reading the score took over 30 minutes; gave up."):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")
    assert seen == [1800]


def test_without_java_the_engine_says_so(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JAVA_HOME")
    monkeypatch.setenv("PATH", str(tmp_path))  # nothing on it
    home = stub_home(tmp_path, "exit 0")
    with pytest.raises(OmrError, match="Java"):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")


def test_a_launcher_that_cannot_start_counts_as_not_installed(tmp_path: Path) -> None:
    home = tmp_path / "broken"
    (home / "bin").mkdir(parents=True)
    script = home / "bin" / "Audiveris"
    script.write_text("#!/nonexistent/interpreter\n")
    script.chmod(0o755)
    with pytest.raises(OmrError, match="not installed"):
        AudiverisEngine(home=home).run(make_pdf(tmp_path), tmp_path / "out")


def test_the_home_is_looked_up_when_the_engine_runs_not_when_it_is_made(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("AUDIVERIS_HOME", raising=False)
    engine = AudiverisEngine()  # no home, no tar needed yet
    prebuilt = tmp_path / "prebuilt.omr"
    write_omr(prebuilt, {1: "<sheet/>"})
    monkeypatch.setenv("AUDIVERIS_HOME", str(stub_home(tmp_path, f'cp "{prebuilt}" "$4/part.omr"')))
    assert engine.run(make_pdf(tmp_path), tmp_path / "out").sheets == ["<sheet/>"]


# --- FakeOmrEngine -----------------------------------------------------------------------------


def test_the_fake_returns_its_fixture_sheets_as_a_real_book(tmp_path: Path, sheet_xml: str) -> None:
    engine = FakeOmrEngine([sheet_xml, sheet_xml])
    assert isinstance(engine, OmrEngine) and isinstance(AudiverisEngine(), OmrEngine)
    book = engine.run(make_pdf(tmp_path), tmp_path / "out")
    assert isinstance(book, OmrBook)
    assert book.sheets == [sheet_xml, sheet_xml]
    assert book.sheet_numbers == [1, 2]
    assert zipfile.is_zipfile(book.omr_path)
    pages = [parse_omr_sheet(xml, i) for i, xml in enumerate(book.sheets)]
    assert [len(page.systems) for page in pages] == [2, 2]


def test_the_fake_refuses_a_pdf_that_does_not_exist(tmp_path: Path, sheet_xml: str) -> None:
    with pytest.raises(OmrError, match="not found"):
        FakeOmrEngine([sheet_xml]).run(tmp_path / "nope.pdf", tmp_path / "out")


# --- the real Audiveris ------------------------------------------------------------------------


def staff_pdf(path: Path) -> None:
    """One page: three lines of five-line staves with bar lines and quarter notes."""
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    for top in (120, 320, 520):
        for line in range(5):
            y = top + 8 * line
            page.draw_line((50, y), (562, y), width=0.8)
        for x in (50, 178, 306, 434, 562):
            page.draw_line((x, top), (x, top + 32), width=1.0)
        for x in (90, 150, 220, 280, 350, 410, 480, 530):
            centre = pymupdf.Point(x, top + 28 - (x % 3) * 4)
            page.draw_oval(
                pymupdf.Rect(centre.x - 5, centre.y - 3.5, centre.x + 5, centre.y + 3.5),
                fill=(0, 0, 0),
            )
            page.draw_line((centre.x + 5, centre.y), (centre.x + 5, centre.y - 28), width=1.0)
    doc.save(path)


@pytest.mark.real
def test_audiveris_reads_a_generated_staff_page(tmp_path: Path) -> None:
    pdf = tmp_path / "staff.pdf"
    staff_pdf(pdf)
    book = AudiverisEngine().run(pdf, tmp_path / "out")
    assert book.omr_path.exists()
    assert len(book.sheets) == 1
    page = parse_omr_sheet(book.sheets[0], 0)
    assert len(page.systems) >= 1
    assert len(parse_omr_systems(book.sheets[0], 0).systems) == len(page.systems)


def test_the_repo_root_of_a_shallow_path_is_the_filesystem_root() -> None:
    """In the image this file is /app/app/pipeline/audiveris.py, too shallow for parents[4]."""
    assert _repo_root(Path("/app/app/pipeline/audiveris.py")) == Path("/")


def test_the_repo_root_of_a_checkout_is_four_folders_up() -> None:
    file = Path("/work/lets/backend/processor/app/pipeline/audiveris.py")
    assert _repo_root(file) == Path("/work/lets")


JAVA_CRASH = """INFO starting
Exception in thread "main" java.lang.RuntimeException: wrapped
\tat org.audiveris.omr.Main.main(Main.java:10)
Caused by: java.lang.IllegalStateException: middle
\tat org.audiveris.omr.A.b(A.java:1)
Caused by: java.lang.UnsatisfiedLinkError: no jnilept in java.library.path
\tat java.base/java.lang.ClassLoader.loadLibrary(ClassLoader.java:2)
\t... 8 more
"""


def test_a_java_crash_is_reported_by_its_deepest_cause_not_its_last_line() -> None:
    assert _failure_line(JAVA_CRASH) == (
        "Caused by: java.lang.UnsatisfiedLinkError: no jnilept in java.library.path"
    )


def test_a_crash_with_no_cause_is_reported_by_its_exception_line() -> None:
    crash = 'Exception in thread "main" java.awt.HeadlessException'
    assert _failure_line(f"noise\n{crash}\n\tat a.b(c:1)\n\t... 3 more\n") == crash


def test_plain_text_is_still_reported_by_its_last_line() -> None:
    assert _failure_line("first\nthe last words\n") == "the last words"
    assert _failure_line("") == ""
