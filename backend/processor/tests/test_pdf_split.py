import logging
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pymupdf
import pytest

from app.pipeline.pdf_split import (
    MAX_PAGES,
    ClaudePageHeaderReader,
    FakePageHeaderReader,
    HeaderRead,
    PageHeader,
    PageHeaderError,
    PageHeaderReader,
    PdfSplitError,
    ProposedPart,
    group_pages,
    is_full_score,
    page_runs,
    page_thumbnails,
    read_headers,
    write_part_pdf,
)
from app.pipeline.score_reader import MODEL, PRICES
from tests.split_fixtures import Page, full_score, pdf_of, three_parts, two_copies


def header(name: str | None = None, printed: int | None = None, full: bool = False) -> PageHeader:
    return PageHeader(name, printed, full)


def names_and_pages(parts: list[ProposedPart]) -> list[tuple[str, int, int]]:
    return [(p.name, p.first_page, p.last_page) for p in parts]


# ---------------------------------------------------------------- grouping the pages


def test_a_new_name_starts_a_part_and_pages_without_one_continue_it() -> None:
    headers = [header("Flute", 1), header(None, 2), header("Oboe", 1), header(None, 2)]

    assert names_and_pages(group_pages(headers)) == [("Flute", 1, 2), ("Oboe", 3, 4)]


def test_pages_before_the_first_name_are_part_one() -> None:
    headers = [header(None, 1), header(None, 2), header("Horn", 1)]

    assert names_and_pages(group_pages(headers)) == [("Part 1", 1, 2), ("Horn", 3, 3)]


def test_a_pdf_with_no_names_at_all_is_one_part() -> None:
    assert names_and_pages(group_pages([header(), header(), header()])) == [("Part 1", 1, 3)]


def test_the_same_name_again_with_page_one_is_a_second_copy() -> None:
    headers = [header("Violin", 1), header(None, 2), header("Violin", 1), header(None, 2)]

    assert names_and_pages(group_pages(headers)) == [("Violin", 1, 2), ("Violin", 3, 4)]


def test_the_same_name_with_a_lower_page_number_is_a_second_copy() -> None:
    headers = [header("Violin", 3), header("Violin", 4), header("Violin", 2)]

    assert names_and_pages(group_pages(headers)) == [("Violin", 1, 2), ("Violin", 3, 3)]


def test_the_same_name_on_the_next_page_continues_the_part() -> None:
    headers = [header("Violin", 1), header("Violin", 2), header("violin ", 3)]

    assert names_and_pages(group_pages(headers)) == [("Violin", 1, 3)]


def test_a_part_whose_first_page_says_page_one_is_not_its_own_copy() -> None:
    assert names_and_pages(group_pages([header("Violin", 1)])) == [("Violin", 1, 1)]


def test_a_name_that_is_not_part_one_is_not_confused_with_the_placeholder() -> None:
    headers = [header(None, 1), header("Part 1", 1)]

    assert names_and_pages(group_pages(headers)) == [("Part 1", 1, 1), ("Part 1", 2, 2)]


def test_no_pages_is_no_parts() -> None:
    assert group_pages([]) == []


def test_there_is_no_limit_on_the_number_of_parts() -> None:
    headers = [header(f"Part {n}", 1) for n in range(200)]

    assert len(group_pages(headers)) == 200


def test_a_full_score_is_a_pdf_where_more_than_half_the_pages_say_so() -> None:
    assert is_full_score([header(full=True), header(full=True), header()])
    assert not is_full_score([header(full=True), header()])
    assert not is_full_score([])


# ---------------------------------------------------------------- writing the part PDFs


def test_a_range_of_pages_becomes_a_pdf_of_that_many_pages() -> None:
    source = three_parts()

    sizes = [len(pymupdf.open(stream=write_part_pdf(source, a, b))) for a, b in ((1, 2), (3, 3))]

    assert sizes == [2, 1]
    assert len(pymupdf.open(stream=write_part_pdf(source, 4, 6))) == 3


def test_the_pages_are_copied_not_rendered_again() -> None:
    source = three_parts()
    original = pymupdf.open(stream=source)

    part = pymupdf.open(stream=write_part_pdf(source, 4, 6))

    assert part[0].get_text().split()[:3] == ["Clarinet", "in", "Bb"]
    assert [page.read_contents() for page in part] == [
        original[n].read_contents() for n in (3, 4, 5)
    ]
    assert all(not page.get_images() for page in part)


def sheets(pdf: bytes) -> list[str]:
    """The "sheet N" label every generated page carries (N is its place in the source PDF)."""
    return [page.get_text().split()[-1] for page in pymupdf.open(stream=pdf)]


def test_skipped_pages_are_left_out_of_the_part() -> None:
    part = write_part_pdf(three_parts(), 1, 6, skip_pages=[4, 2])

    assert sheets(part) == ["1", "3", "5", "6"]


def test_no_skipped_pages_is_the_whole_range() -> None:
    assert sheets(write_part_pdf(three_parts(), 3, 5, skip_pages=[])) == ["3", "4", "5"]


@pytest.mark.parametrize("skip", [[0], [7], [1, 7], [-1]])
def test_a_skipped_page_outside_the_part_is_refused(skip: list[int]) -> None:
    with pytest.raises(PdfSplitError, match="skipped pages"):
        write_part_pdf(three_parts(), 2, 5, skip_pages=skip)


def test_a_skipped_page_outside_the_range_but_inside_the_pdf_is_refused() -> None:
    with pytest.raises(PdfSplitError, match="skipped pages"):
        write_part_pdf(three_parts(), 2, 5, skip_pages=[1])


def test_a_part_cannot_skip_all_its_pages() -> None:
    with pytest.raises(PdfSplitError, match="at least one page"):
        write_part_pdf(three_parts(), 2, 3, skip_pages=[2, 3])


def test_a_page_skipped_twice_counts_once() -> None:
    assert sheets(write_part_pdf(three_parts(), 1, 3, skip_pages=[2, 2])) == ["1", "3"]


def test_the_pages_that_stay_are_runs() -> None:
    assert page_runs(1, 6, []) == [(1, 6)]
    assert page_runs(1, 6, [4]) == [(1, 3), (5, 6)]
    assert page_runs(1, 5, [2, 4]) == [(1, 1), (3, 3), (5, 5)]
    assert page_runs(2, 4, [2]) == [(3, 4)]


@pytest.mark.parametrize("first,last", [(0, 1), (2, 1), (1, 7), (7, 7)])
def test_a_range_outside_the_pdf_is_refused(first: int, last: int) -> None:
    with pytest.raises(PdfSplitError, match="pages"):
        write_part_pdf(three_parts(), first, last)


def test_a_pdf_of_more_than_the_most_pages_is_refused() -> None:
    with pytest.raises(PdfSplitError, match=f"more than {MAX_PAGES} pages"):
        read_headers(pdf_of(*(Page() for _ in range(MAX_PAGES + 1))), FakePageHeaderReader({}))


def test_thumbnails_are_wide_enough_for_a_320_px_preview_on_a_retina_screen() -> None:
    thumbs = page_thumbnails(three_parts())

    assert pymupdf.Pixmap(thumbs[0]).width == 640


def test_thumbnails_are_small_pngs_one_for_each_page() -> None:
    thumbs = page_thumbnails(three_parts(), width=200)

    picture = pymupdf.Pixmap(thumbs[0])
    assert len(thumbs) == 6
    assert thumbs[0].startswith(b"\x89PNG")
    assert picture.width == 200
    assert abs(picture.height - 200 * 842 / 595) <= 1


# ---------------------------------------------------------------- reading every page


def test_every_page_is_read_and_the_costs_are_added() -> None:
    reader = FakePageHeaderReader(
        {1: header("Flute", 1), 2: header(None, 2), 3: header("Oboe", 1)}, cost_usd=0.001
    )

    read = read_headers(pdf_of(Page(), Page(), Page()), reader)

    assert read.headers == [header("Flute", 1), header(None, 2), header("Oboe", 1)]
    assert read.cost_usd == pytest.approx(0.003)
    assert read.failed == 0
    assert sorted(call.page for call in reader.calls) == [1, 2, 3]


def test_the_reader_is_given_a_strip_from_the_top_third_of_the_page() -> None:
    reader = FakePageHeaderReader({})

    read_headers(pdf_of(Page("Flute", 1)), reader)

    strip = pymupdf.Pixmap(reader.calls[0].png)
    assert strip.height / strip.width == pytest.approx(842 / 595 / 3, abs=0.01)


def test_a_page_the_reader_fails_on_counts_as_no_header() -> None:
    reader = FakePageHeaderReader({1: header("Flute", 1), 2: PageHeaderError("bad")})

    read = read_headers(pdf_of(Page(), Page(), Page()), reader)

    assert read.headers == [header("Flute", 1), header(), header()]
    assert read.failed == 2  # page 3 had no answer given: the fake fails it too


def test_a_reader_that_cannot_be_used_stops_the_calls() -> None:
    reader = FakePageHeaderReader({}, unavailable=True)

    read = read_headers(pdf_of(*(Page() for _ in range(12))), reader)

    assert read.failed == 12
    assert read.headers == [header()] * 12
    assert len(reader.calls) < 12


def test_the_fake_and_the_claude_reader_are_page_header_readers() -> None:
    assert isinstance(FakePageHeaderReader({}), PageHeaderReader)
    assert isinstance(ClaudePageHeaderReader(client=object()), PageHeaderReader)


def test_the_generated_pdfs_group_as_their_pages_say() -> None:
    reader = FakePageHeaderReader(
        {
            1: header("Flute", 1),
            2: header(None, 2),
            3: header("Oboe", 1),
            4: header("Clarinet in B♭ 2", 1),
            5: header(None, 2),
            6: header(None, 3),
        }
    )

    read = read_headers(three_parts(), reader)

    assert names_and_pages(group_pages(read.headers)) == [
        ("Flute", 1, 2),
        ("Oboe", 3, 3),
        ("Clarinet in B♭ 2", 4, 6),
    ]
    assert len(pymupdf.open(stream=two_copies())) == 4
    assert len(pymupdf.open(stream=full_score())) == 3


# ---------------------------------------------------------------- the Claude reader


class FakeClient:
    """Records the arguments of messages.create and answers with a canned reply."""

    def __init__(self, text: str = "", error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.messages = self
        self._text, self._error = text, error

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return SimpleNamespace(
            usage=SimpleNamespace(input_tokens=1_000, output_tokens=40),
            content=[SimpleNamespace(type="text", text=self._text)],
        )


def ask(text: str = "", error: Exception | None = None) -> tuple[HeaderRead, FakeClient]:
    client = FakeClient(text, error)
    return ClaudePageHeaderReader(client=client).read(4, b"\x89PNG strip"), client


def test_it_asks_haiku_once_with_the_strip_and_reads_the_json() -> None:
    read, client = ask('{"part_name": "Flute", "printed_page": 2, "full_score": false}')

    assert read.header == header("Flute", 2)
    assert len(client.calls) == 1
    assert client.calls[0]["model"] == MODEL
    assert client.calls[0]["thinking"] == {"type": "disabled"}  # thinking can eat the answer
    kinds = [block["type"] for block in client.calls[0]["messages"][0]["content"]]
    assert kinds.count("image") == 1
    price_in, price_out = PRICES[MODEL]
    assert read.cost_usd == pytest.approx((1_000 * price_in + 40 * price_out) / 1e6)


def test_json_inside_a_fence_or_words_is_found() -> None:
    read, _ = ask(
        'Here it is:\n```json\n{"part_name": null, "printed_page": null, "full_score": true}\n```'
    )

    assert read.header == header(None, None, True)


def test_a_blank_name_is_no_name() -> None:
    read, _ = ask('{"part_name": "  ", "printed_page": 3, "full_score": false}')

    assert read.header == header(None, 3)


@pytest.mark.parametrize(
    "text",
    [
        "I cannot tell.",
        "{not json}",
        '{"part_name": "Flute"}',
        '{"part_name": 5, "printed_page": 1, "full_score": false}',
        '{"part_name": "Flute", "printed_page": "one", "full_score": false}',
        '{"part_name": "Flute", "printed_page": 1, "full_score": "no"}',
        "[1, 2]",
    ],
)
def test_a_reply_that_is_not_the_answer_is_a_reader_error(text: str) -> None:
    with pytest.raises(PageHeaderError, match="page 4"):
        ask(text)


def test_api_errors_are_reader_errors_and_a_refused_key_makes_the_reader_unavailable() -> None:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    refused = anthropic.AuthenticationError(
        "no", response=httpx.Response(401, request=request), body=None
    )
    down = anthropic.APIConnectionError(request=request)

    with pytest.raises(PageHeaderError) as unavailable:
        ask(error=refused)
    with pytest.raises(PageHeaderError) as unreachable:
        ask(error=down)

    assert "refused" in str(unavailable.value)
    assert getattr(unavailable.value, "unavailable", False)
    assert not getattr(unreachable.value, "unavailable", False)


def test_building_the_claude_reader_needs_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(PageHeaderError, match="no Anthropic API key") as error:
        ClaudePageHeaderReader().read(1, b"x")

    assert error.value.unavailable


@pytest.mark.real
def test_haiku_reads_the_part_name_of_a_generated_page() -> None:
    reader = ClaudePageHeaderReader()

    read = read_headers(pdf_of(Page("Flute", 3)), reader)

    assert read.failed == 0
    assert read.headers[0].part_name is not None
    assert "flute" in read.headers[0].part_name.lower()
    assert read.headers[0].full_score is False
    print(f"header read: {read.headers[0]} cost ${read.cost_usd:.6f}")


def test_a_pdf_that_cannot_be_read_is_a_split_error_in_a_sentence() -> None:
    with pytest.raises(PdfSplitError, match="could not be read as a PDF"):
        write_part_pdf(b"%PDF-1.4 broken", 1, 1)


def test_the_summed_cost_is_logged_in_one_line(caplog: pytest.LogCaptureFixture) -> None:
    reader = FakePageHeaderReader({1: header("Flute", 1), 2: header(None, 2)}, cost_usd=0.002)

    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        read_headers(pdf_of(Page(), Page()), reader)

    lines = [r.getMessage() for r in caplog.records if r.name == "uvicorn.error"]
    assert lines == ["Read the headers of 2 pages (0 failed) for $0.004000."]
