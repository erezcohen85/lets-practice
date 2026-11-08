import copy
import json
import os
from pathlib import Path
from typing import Any

import pytest

from app.pipeline.run_folder import (
    CONFIRMED_NAME,
    KEEP,
    PREV_NAME,
    BoxEdges,
    RunFolderError,
    inside_folder,
    map_structure_set_at,
    parse_map,
    parse_timing,
    read_run,
    write_confirmed,
)
from tests.run_fixtures import BARS, locator, page_layer, run_document, timing_layer, write_run


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    return write_run(tmp_path / "run")


def the_map() -> dict[str, Any]:
    return {
        "timing": timing_layer(),
        "pages": {part: page_layer(part) for part in ("part-flute", "part-horn")},
    }


def save(folder: Path, data: dict[str, Any]) -> None:
    timing, pages = parse_map(data)
    write_confirmed(folder, timing, pages)


# --- reading -------------------------------------------------------------------------------------


def test_reads_the_run_the_pipeline_wrote(folder: Path) -> None:
    read = read_run(folder)

    assert read.run.piece.title == "Synthetic Etude"
    assert [part.name for part in read.run.parts] == ["Flute", "Horn"]
    assert read.run.pageImages["part-flute"][0].file == "pages/part-flute/page-0.webp"
    assert read.confirmed_at is None
    assert len(read.timing.locators) == BARS


def test_the_pipeline_map_is_read_back_in_the_frontend_shape(folder: Path) -> None:
    read = read_run(folder)

    assert read.timing.model_dump(by_alias=True, exclude_unset=True) == timing_layer()
    assert read.pages["part-flute"].model_dump(by_alias=True) == page_layer("part-flute")


def test_a_confirmed_map_wins_over_the_pipeline_one(folder: Path) -> None:
    edited = the_map()
    edited["timing"]["locators"][3]["timeSec"] = 7.25
    edited["timing"]["locators"][3]["confirmed"] = True
    save(folder, edited)

    read = read_run(folder)

    assert read.timing.locators[3].timeSec == 7.25
    assert read.timing.locators[3].confirmed is True
    assert read.confirmed_at is not None
    # The pipeline's own map stays in local-run.json untouched.
    assert json.loads((folder / "local-run.json").read_text())["timing"] == timing_layer()


def test_a_missing_run_file_is_one_plain_sentence(tmp_path: Path) -> None:
    with pytest.raises(RunFolderError, match=r"^There is no local-run\.json in this folder\.$"):
        read_run(tmp_path)


@pytest.mark.parametrize("text", ["", "{not json", "[]"])
def test_a_damaged_run_file_is_refused(folder: Path, text: str) -> None:
    (folder / "local-run.json").write_text(text)

    with pytest.raises(RunFolderError, match=r"local-run\.json"):
        read_run(folder)


def test_an_unknown_version_is_refused(folder: Path) -> None:
    document = run_document()
    document["version"] = 2
    (folder / "local-run.json").write_text(json.dumps(document))

    with pytest.raises(RunFolderError, match="version"):
        read_run(folder)


def test_a_run_file_with_a_bad_peak_is_refused(folder: Path) -> None:
    document = run_document()
    document["peaks"][0] = 300
    (folder / "local-run.json").write_text(json.dumps(document))

    with pytest.raises(RunFolderError, match="peaks"):
        read_run(folder)


@pytest.mark.parametrize("path", ["/etc/passwd", "../audio.m4a", "pages/../../x.webp"])
def test_a_run_file_naming_a_path_outside_the_folder_is_refused(folder: Path, path: str) -> None:
    document = run_document()
    document["audio"] = path
    (folder / "local-run.json").write_text(json.dumps(document))

    with pytest.raises(RunFolderError, match="audio"):
        read_run(folder)


def test_a_run_file_without_beats_still_reads(folder: Path) -> None:
    assert read_run(folder).run.beats is None


def test_the_beats_of_a_run_file_are_read_and_kept_in_order(folder: Path) -> None:
    data = run_document()
    data["beats"] = [{"t": 0.5, "downbeat": 0.9}, {"t": 1.0, "downbeat": 0.1}]
    (folder / "local-run.json").write_text(json.dumps(data))

    beats = read_run(folder).run.beats

    assert beats is not None and [(b.t, b.downbeat) for b in beats] == [(0.5, 0.9), (1.0, 0.1)]


@pytest.mark.parametrize("beat", [{"t": -1, "downbeat": 0.5}, {"t": 1, "downbeat": 1.5}])
def test_a_beat_outside_its_range_is_refused(beat: dict[str, Any], folder: Path) -> None:
    data = run_document()
    data["beats"] = [beat]
    (folder / "local-run.json").write_text(json.dumps(data))

    with pytest.raises(RunFolderError):
        read_run(folder)


def test_extra_keys_in_the_run_file_are_ignored(folder: Path) -> None:
    document = run_document()
    document["visionCost"] = {"usd": 0.12}
    (folder / "local-run.json").write_text(json.dumps(document))

    assert read_run(folder).run.piece.id == "piece-a"


def test_a_damaged_confirmed_map_is_refused_and_names_the_previous_one(folder: Path) -> None:
    save(folder, the_map())
    (folder / CONFIRMED_NAME).write_text("{half a file")

    with pytest.raises(RunFolderError, match=PREV_NAME.replace(".", r"\.")):
        read_run(folder)


# --- writing -------------------------------------------------------------------------------------


def test_a_save_writes_the_whole_map_with_a_version_and_a_time(folder: Path) -> None:
    save(folder, the_map())

    written = json.loads((folder / CONFIRMED_NAME).read_text())
    assert written["version"] == 1
    assert written["savedAt"].endswith("+00:00")
    assert written["timing"] == timing_layer()
    assert written["pages"]["part-horn"] == page_layer("part-horn")


def test_flags_and_checked_survive_a_save_and_a_read(folder: Path) -> None:
    flag = {
        "kind": "crowded",
        "severity": 2,
        "expected": 2.0,
        "found": 1.1,
        "factor": 0.55,
        "explainedBy": None,
        "uncertainLine": {"timeSec": 3.0, "confidence": 0.4},
    }
    edited = the_map()
    edited["timing"]["locators"][1] = locator(2, flags=[flag], checked=True)
    save(folder, edited)

    written = json.loads((folder / CONFIRMED_NAME).read_text())
    assert written["timing"]["locators"][1]["flags"] == [flag]
    assert written["timing"]["locators"][1]["checked"] is True
    # A locator that never had flags is written without them.
    assert "flags" not in written["timing"]["locators"][0]


def test_the_save_before_is_kept_as_prev(folder: Path) -> None:
    first = the_map()
    first["timing"]["locators"][0]["timeSec"] = 1.5
    save(folder, first)
    second = the_map()
    second["timing"]["locators"][0]["timeSec"] = 1.75
    save(folder, second)

    assert json.loads((folder / PREV_NAME).read_text())["timing"]["locators"][0]["timeSec"] == 1.5
    assert (
        json.loads((folder / CONFIRMED_NAME).read_text())["timing"]["locators"][0]["timeSec"]
        == 1.75
    )


def test_the_first_save_has_no_prev(folder: Path) -> None:
    save(folder, the_map())

    assert not (folder / PREV_NAME).exists()


def test_a_save_leaves_no_temp_file_behind(folder: Path) -> None:
    save(folder, the_map())
    save(folder, the_map())

    assert sorted(path.name for path in folder.iterdir() if path.is_file()) == sorted(
        ["local-run.json", "audio.m4a", CONFIRMED_NAME, PREV_NAME]
    )


def test_a_crash_before_the_swap_leaves_the_old_map_whole(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    save(folder, the_map())
    before = (folder / CONFIRMED_NAME).read_text()
    edited = the_map()
    edited["timing"]["locators"][0]["timeSec"] = 1.9

    def crash(src: object, dst: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", crash)
    with pytest.raises(RunFolderError, match="could not be saved"):
        save(folder, edited)
    monkeypatch.undo()

    assert (folder / CONFIRMED_NAME).read_text() == before
    assert sorted(path.name for path in folder.iterdir() if path.is_file()) == sorted(
        ["local-run.json", "audio.m4a", CONFIRMED_NAME]
    )


def test_a_save_for_a_part_the_run_does_not_have_is_refused_and_not_written(folder: Path) -> None:
    edited = the_map()
    edited["pages"]["part-tuba"] = page_layer("part-tuba")

    with pytest.raises(RunFolderError, match="part-tuba"):
        save(folder, edited)

    assert not (folder / CONFIRMED_NAME).exists()


# --- validation of a map -------------------------------------------------------------------------


def broken(change: Any) -> dict[str, Any]:
    data = copy.deepcopy(the_map())
    change(data)
    return data


def _locators(d: dict[str, Any]) -> list[dict[str, Any]]:
    return d["timing"]["locators"]


def _boxes(d: dict[str, Any]) -> list[dict[str, Any]]:
    return d["pages"]["part-flute"]["bars"]


UNKNOWN_FLAG = {
    "kind": "weird",
    "severity": 1,
    "expected": 1,
    "found": 1,
    "factor": None,
    "explainedBy": None,
    "uncertainLine": None,
}
BOX_ON_BAR_9 = {"bar": 9, "pageIndex": 0, "x": 0, "y": 0, "w": 1, "h": 1}
BOX_ON_BAR_0 = {**BOX_ON_BAR_9, "bar": 0}

BAD_MAPS = {
    "a locator on bar 9 of 8": lambda d: _locators(d).append(locator(9)),
    "a locator at a negative time": lambda d: _locators(d)[0].update(timeSec=-1),
    "a locator with no confirmed": lambda d: _locators(d)[0].pop("confirmed"),
    "a locator time as text": lambda d: _locators(d)[0].update(timeSec="soon"),
    "a repeated locator": lambda d: _locators(d).append(locator(1)),
    "a flag of an unknown kind": lambda d: _locators(d)[0].update(flags=[UNKNOWN_FLAG]),
    "a play order past the last bar": lambda d: d["timing"]["playOrder"].append(
        {"from": 7, "to": 9}
    ),
    "a backwards play order row": lambda d: d["timing"]["playOrder"].append({"from": 5, "to": 2}),
    "a meter on a note value that is not one": lambda d: d["timing"]["meters"][0].update(
        denominator=5
    ),
    "a rest on bar 0": lambda d: d["pages"]["part-flute"].update(rests=[0, 3]),
    "a rest after the last bar": lambda d: d["pages"]["part-flute"].update(rests=[8, 9]),
    "rests out of order": lambda d: d["pages"]["part-flute"].update(rests=[5, 3]),
    "a rest twice": lambda d: d["pages"]["part-flute"].update(rests=[3, 3]),
    "rests as text": lambda d: d["pages"]["part-flute"].update(rests=["3"]),
    "an old rest mark on bar 0": lambda d: d["timing"]["marks"].append({"bar": 0, "kind": "rest"}),
    "a mark of an unknown kind": lambda d: d["timing"]["marks"].append({"bar": 1, "kind": "coda"}),
    "a box with a missing side": lambda d: _boxes(d)[0].pop("w"),
    "a box on bar 0": lambda d: _boxes(d).append(BOX_ON_BAR_0),
    "a page layer under the wrong part": lambda d: d["pages"]["part-flute"].update(
        partId="part-horn"
    ),
    "no timing": lambda d: d.pop("timing"),
    "no pages": lambda d: d.pop("pages"),
}


@pytest.mark.parametrize("what", BAD_MAPS)
def test_a_bad_map_is_refused(what: str, folder: Path) -> None:
    with pytest.raises(RunFolderError):
        save(folder, broken(BAD_MAPS[what]))

    assert not (folder / CONFIRMED_NAME).exists(), what


def test_a_part_with_more_boxes_than_the_piece_has_bars_is_saved_and_read_back(
    folder: Path,
) -> None:
    # The editor's Add bar line renumbers one part's boxes and leaves the shared timing alone, so a
    # part may hold a box past the last bar (or fewer boxes); the Review Queue shows that.
    data = the_map()
    data["pages"]["part-horn"]["bars"].append(BOX_ON_BAR_9)
    del data["pages"]["part-flute"]["bars"][-2:]

    save(folder, data)

    read = read_run(folder)
    assert [b.bar for b in read.pages["part-horn"].bars][-1] == 9
    assert len(read.pages["part-flute"].bars) == BARS - 2


def test_a_bad_map_names_where_it_is_wrong() -> None:
    data = broken(lambda d: d["timing"]["locators"][2].update(timeSec=-1))

    with pytest.raises(RunFolderError, match=r"timing.*locators\.2\.timeSec"):
        parse_map(data)


def test_a_map_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(RunFolderError, match="object"):
        parse_map([1, 2])


def test_an_empty_map_is_allowed() -> None:
    empty = {
        "timing": {"barCount": 0, "playOrder": [], "meters": [], "marks": [], "locators": []},
        "pages": {},
    }

    timing, pages = parse_map(empty)

    assert timing.barCount == 0 and pages == {}


# --- paths ---------------------------------------------------------------------------------------


def test_a_path_inside_the_folder_is_found(folder: Path) -> None:
    assert (
        inside_folder(folder, "pages/part-flute/page-0.webp")
        == (folder / "pages" / "part-flute" / "page-0.webp").resolve()
    )


@pytest.mark.parametrize(
    "path", ["../x", "pages/../../x", "/etc/passwd", "", "a/../../b", "..", "\\x"]
)
def test_a_path_outside_the_folder_is_refused(folder: Path, path: str) -> None:
    with pytest.raises(RunFolderError):
        inside_folder(folder, path)


def test_a_symlink_out_of_the_folder_is_refused(folder: Path, tmp_path: Path) -> None:
    (tmp_path / "secret.txt").write_text("no")
    (folder / "link.txt").symlink_to(tmp_path / "secret.txt")

    with pytest.raises(RunFolderError):
        inside_folder(folder, "link.txt")


# --- a timing sent for re-align ------------------------------------------------------------------


def test_a_timing_for_realign_is_validated_like_a_save() -> None:
    timing = parse_timing({"timing": timing_layer()})

    assert timing.barCount == BARS
    with pytest.raises(RunFolderError, match=r"timing.*locators\.0\.timeSec"):
        parse_timing(
            {"timing": broken(lambda d: d["timing"]["locators"][0].update(timeSec=-1))["timing"]}
        )


@pytest.mark.parametrize("body", [[], {}, {"timing": 3}])
def test_a_body_without_a_timing_is_refused(body: object) -> None:
    with pytest.raises(RunFolderError):
        parse_timing(body)


def test_the_alignment_of_a_run_is_the_frame_rate(tmp_path: Path) -> None:
    folder = write_run(tmp_path / "run", with_alignment=True)

    alignment = read_run(folder).run.alignment

    assert alignment is not None and alignment.fps == 50.0


def test_rit_marks_and_the_reason_they_give_are_part_of_a_map() -> None:
    document = broken(lambda d: d["timing"]["marks"].append({"bar": 3, "kind": "rit"}))
    document["timing"]["locators"][2]["flags"] = [
        {
            "kind": "stretched",
            "severity": 0,
            "expected": 2.0,
            "found": 3.0,
            "factor": 1.5,
            "explainedBy": "rit",
            "uncertainLine": None,
        }
    ]

    timing, _ = parse_map(document)

    assert [(m.bar, m.kind) for m in timing.marks] == [(3, "rit")]
    flags = timing.locators[2].flags
    assert flags is not None and flags[0].explainedBy == "rit"


def test_a_pulse_flag_is_part_of_a_map() -> None:
    document = broken(lambda d: None)
    document["timing"]["locators"][0]["flags"] = [
        {
            "kind": "pulse",
            "severity": 1,
            "expected": 3,
            "found": 1.04,
            "factor": 0.35,
            "explainedBy": None,
            "uncertainLine": None,
        }
    ]

    timing, _ = parse_map(document)

    flags = timing.locators[0].flags
    assert flags is not None and (flags[0].kind, flags[0].found) == ("pulse", 1.04)


def test_an_old_run_with_rit_bars_outside_the_timing_is_refused_in_a_sentence(
    tmp_path: Path,
) -> None:
    folder = write_run(tmp_path / "run", with_alignment=True)
    document = json.loads((folder / "local-run.json").read_text())
    document["alignment"]["ritBars"] = [6, 7]
    (folder / "local-run.json").write_text(json.dumps(document))

    with pytest.raises(RunFolderError, match="rit. marks.*run_piece"):
        read_run(folder)


def test_an_old_run_with_no_rit_bars_is_still_read(tmp_path: Path) -> None:
    folder = write_run(tmp_path / "run", with_alignment=True)
    document = json.loads((folder / "local-run.json").read_text())
    document["alignment"]["ritBars"] = []
    (folder / "local-run.json").write_text(json.dumps(document))

    assert read_run(folder).run.alignment is not None


# --- pickup and short bars -----------------------------------------------------------------------


def with_pickup(data: dict[str, Any], units: int = 1) -> dict[str, Any]:
    """The map with a bar 0: a short bar of `units` beats, a locator, a box and a play-order row."""
    data = copy.deepcopy(data)
    timing = data["timing"]
    timing["shortBars"] = [{"bar": 0, "units": units}]
    timing["playOrder"] = [{"from": 0, "to": BARS}]
    timing["locators"].insert(0, locator(0, timeSec=0.5))
    data["pages"]["part-flute"]["bars"].insert(0, {**BOX_ON_BAR_0, "w": 10.0})
    return data


def test_a_map_without_short_bars_reads_as_having_none(folder: Path) -> None:
    read = read_run(folder)

    assert read.timing.shortBars is None
    assert "shortBars" not in read.timing.model_dump(by_alias=True, exclude_unset=True)


def test_a_pickup_is_bar_0_and_survives_a_save_and_a_read(folder: Path) -> None:
    save(folder, with_pickup(the_map()))

    read = read_run(folder)

    assert read.timing.shortBars is not None
    assert [(s.bar, s.units) for s in read.timing.shortBars] == [(0, 1)]
    assert read.timing.playOrder[0].from_ == 0
    assert read.timing.locators[0].bar == 0
    assert read.pages["part-flute"].bars[0].bar == 0
    saved = json.loads((folder / CONFIRMED_NAME).read_text())
    assert saved["timing"]["shortBars"] == [{"bar": 0, "units": 1}]


def test_a_short_bar_in_the_middle_keeps_its_own_number(folder: Path) -> None:
    data = the_map()
    data["timing"]["shortBars"] = [{"bar": 5, "units": 3}]

    save(folder, data)

    read = read_run(folder)
    assert read.timing.shortBars is not None
    assert [(s.bar, s.units) for s in read.timing.shortBars] == [(5, 3)]


def test_a_pickup_with_no_number_in_the_middle_is_kept_with_its_flag(folder: Path) -> None:
    """The frontend labels such a bar p7; the processor keeps the internal bar and the flag."""
    data = the_map()
    data["timing"]["shortBars"] = [
        {"bar": 5, "units": 3, "unnumbered": True},
        {"bar": 6, "units": 1},
    ]

    save(folder, data)

    read = read_run(folder)
    assert read.timing.shortBars is not None
    assert [(s.bar, s.units, s.unnumbered) for s in read.timing.shortBars] == [
        (5, 3, True),
        (6, 1, None),
    ]
    saved = json.loads((folder / CONFIRMED_NAME).read_text())
    assert saved["timing"]["shortBars"] == [
        {"bar": 5, "units": 3, "unnumbered": True},
        {"bar": 6, "units": 1},
    ]


def test_the_flag_must_be_a_true_boolean(folder: Path) -> None:
    data = the_map()
    data["timing"]["shortBars"] = [{"bar": 5, "units": 3, "unnumbered": "yes"}]

    with pytest.raises(Exception):  # noqa: B017 - the strict model refuses it
        save(folder, data)


def _bar_0_without_a_pickup(data: dict[str, Any]) -> None:
    data["timing"]["locators"].insert(0, locator(0, timeSec=0.5))


SHORT_BAR_MAPS = {
    "a locator on bar 0 with no pickup": _bar_0_without_a_pickup,
    "a play-order row from bar 0 with no pickup": lambda d: d["timing"]["playOrder"].__setitem__(
        0, {"from": 0, "to": BARS}
    ),
    "a pickup with no length": lambda d: d["timing"].update(shortBars=[{"bar": 0, "units": 0}]),
    "a short bar as long as its meter": lambda d: d["timing"].update(
        shortBars=[{"bar": 3, "units": 4}]
    ),
    "a short bar after the last bar": lambda d: d["timing"].update(
        shortBars=[{"bar": BARS + 1, "units": 1}]
    ),
    "two lengths for one bar": lambda d: d["timing"].update(
        shortBars=[{"bar": 3, "units": 1}, {"bar": 3, "units": 2}]
    ),
    "a short bar with a fractional length": lambda d: d["timing"].update(
        shortBars=[{"bar": 3, "units": 1.5}]
    ),
    "a box on bar 0 with no pickup": lambda d: _boxes(d).append(BOX_ON_BAR_0),
}


@pytest.mark.parametrize("what", SHORT_BAR_MAPS)
def test_a_map_with_bad_short_bars_is_refused(what: str, folder: Path) -> None:
    with pytest.raises(RunFolderError):
        save(folder, broken(SHORT_BAR_MAPS[what]))

    assert not (folder / CONFIRMED_NAME).exists(), what


def test_a_short_bar_is_judged_against_the_meter_in_force_at_its_bar() -> None:
    data = the_map()
    data["timing"]["meters"] = [
        {"fromBar": 1, "numerator": 4, "denominator": 4},
        {"fromBar": 5, "numerator": 6, "denominator": 8},
    ]
    data["timing"]["shortBars"] = [{"bar": 6, "units": 5}]

    parse_map(data)  # 5 eighths is shorter than 6/8

    data["timing"]["shortBars"] = [{"bar": 2, "units": 5}]
    with pytest.raises(RunFolderError, match="shorter"):
        parse_map(data)  # but not shorter than 4/4's four quarters


# --- rests belong to a part ----------------------------------------------------------------------


def with_old_rests(data: dict[str, Any], bars: list[int]) -> dict[str, Any]:
    """The map as it was written when rests were marks of the shared timing."""
    data = copy.deepcopy(data)
    data["timing"]["marks"] += [{"bar": bar, "kind": "rest"} for bar in bars]
    for layer in data["pages"].values():
        layer.pop("rests")
    return data


def test_a_part_keeps_its_own_rests_through_a_save_and_a_read(folder: Path) -> None:
    edited = the_map()
    edited["pages"]["part-flute"]["rests"] = [3, 4, 5]
    edited["pages"]["part-horn"]["rests"] = [7]

    save(folder, edited)
    read = read_run(folder)

    assert read.pages["part-flute"].rests == [3, 4, 5]
    assert read.pages["part-horn"].rests == [7]
    assert read.timing.marks == []
    saved = json.loads((folder / CONFIRMED_NAME).read_text())
    assert saved["pages"]["part-horn"]["rests"] == [7]


def test_old_rest_marks_move_to_every_part_and_leave_the_timing() -> None:
    old = with_old_rests(the_map(), [3, 4, 5])
    old["timing"]["marks"].append({"bar": 6, "kind": "fermata"})

    timing, pages = parse_map(old)

    assert [(m.bar, m.kind) for m in timing.marks] == [(6, "fermata")]
    assert pages["part-flute"].rests == [3, 4, 5]
    assert pages["part-horn"].rests == [3, 4, 5]


def test_old_rests_join_the_rests_a_part_already_has() -> None:
    old = with_old_rests(the_map(), [4, 5])
    old["pages"]["part-horn"]["rests"] = [1, 5]

    _, pages = parse_map(old)

    assert pages["part-flute"].rests == [4, 5]
    assert pages["part-horn"].rests == [1, 4, 5]


def test_a_page_layer_without_rests_reads_as_having_none() -> None:
    _, pages = parse_map(with_old_rests(the_map(), []))

    assert pages["part-flute"].rests == []


def test_an_old_confirmed_map_loads_and_the_next_save_writes_the_new_shape(folder: Path) -> None:
    (folder / CONFIRMED_NAME).write_text(json.dumps(with_old_rests(the_map(), [2, 3])))

    read = read_run(folder)
    write_confirmed(folder, read.timing, read.pages)

    saved = json.loads((folder / CONFIRMED_NAME).read_text())
    assert saved["timing"]["marks"] == []
    assert saved["pages"]["part-flute"]["rests"] == [2, 3]
    assert saved["pages"]["part-horn"]["rests"] == [2, 3]


def test_an_old_run_file_loads_with_its_rests_on_every_part(folder: Path) -> None:
    document = json.loads((folder / "local-run.json").read_text())
    old = with_old_rests({"timing": document["timing"], "pages": document["pages"]}, [6, 7])
    document.update(old)
    (folder / "local-run.json").write_text(json.dumps(document))

    read = read_run(folder)

    assert read.timing.marks == []
    assert read.pages["part-flute"].rests == [6, 7]
    assert read.run.pages["part-horn"].rests == [6, 7]


def test_a_timing_sent_for_a_realign_may_still_hold_old_rest_marks() -> None:
    document = broken(lambda d: d["timing"]["marks"].append({"bar": 2, "kind": "rest"}))

    timing = parse_timing({"timing": document["timing"]})

    assert timing.marks == []


def test_a_part_with_one_bar_more_than_the_piece_may_rest_on_it(folder: Path) -> None:
    edited = the_map()
    edited["pages"]["part-flute"]["bars"].append({**BOX_ON_BAR_9})
    edited["pages"]["part-flute"]["rests"] = [8, 9]

    save(folder, edited)

    assert read_run(folder).pages["part-flute"].rests == [8, 9]


def test_a_pickup_part_may_rest_on_bar_0(folder: Path) -> None:
    edited = with_pickup(the_map())
    edited["pages"]["part-flute"]["rests"] = [0, 1]

    save(folder, edited)

    assert read_run(folder).pages["part-flute"].rests == [0, 1]


# --- the piece structure is set (Decisions 2026-11-03) ------------------------------------------

SET_AT = "2026-11-03T15:00:00+00:00"


def saved_document(folder: Path) -> dict[str, Any]:
    return json.loads((folder / CONFIRMED_NAME).read_text(encoding="utf-8"))


def test_a_map_without_the_structure_flag_reads_as_not_set_and_is_written_without_it(
    folder: Path,
) -> None:
    save(folder, the_map())

    assert read_run(folder).structure_set_at is None
    assert "structureSetAt" not in saved_document(folder)


def test_the_structure_flag_is_written_and_read_back(folder: Path) -> None:
    timing, pages = parse_map(the_map())
    write_confirmed(folder, timing, pages, structure_set_at=SET_AT)

    assert read_run(folder).structure_set_at == SET_AT
    assert saved_document(folder)["structureSetAt"] == SET_AT


def test_a_save_that_does_not_say_keeps_the_flag_already_in_the_file(folder: Path) -> None:
    timing, pages = parse_map(the_map())
    write_confirmed(folder, timing, pages, structure_set_at=SET_AT)

    write_confirmed(folder, timing, pages)  # a realign, an added part, a deleted part

    assert read_run(folder).structure_set_at == SET_AT


def test_the_flag_the_editor_sends_is_read_from_the_map_body() -> None:
    assert map_structure_set_at({**the_map(), "structureSetAt": SET_AT}) == SET_AT
    assert map_structure_set_at(the_map()) is KEEP


def test_a_flag_that_is_not_a_string_is_refused() -> None:
    with pytest.raises(RunFolderError, match="The map is not valid"):
        parse_map({**the_map(), "structureSetAt": 5})


# --- box flags (the box check, Decisions 2026-11-03) ---------------------------------------------


def box_flag(
    bar: int = 3, verdict: str = "signature_inside", x: float | None = 20.0
) -> dict[str, Any]:
    return {"bar": bar, "verdict": verdict, "note": "a clef is inside", "suggestedX": x}


def test_a_page_layer_without_box_flags_reads_as_having_none_and_is_written_without_the_key(
    folder: Path,
) -> None:
    save(folder, the_map())

    assert read_run(folder).pages["part-flute"].boxFlags == []
    saved = json.loads((folder / CONFIRMED_NAME).read_text())
    assert "boxFlags" not in saved["pages"]["part-flute"]


def test_box_flags_survive_a_save_and_a_read(folder: Path) -> None:
    data = the_map()
    data["pages"]["part-flute"]["boxFlags"] = [box_flag(3), box_flag(5, "two_bars", None)]

    save(folder, data)

    flags = read_run(folder).pages["part-flute"].boxFlags
    assert [(f.bar, f.verdict, f.suggestedX) for f in flags] == [
        (3, "signature_inside", 20.0),
        (5, "two_bars", None),
    ]
    saved = json.loads((folder / CONFIRMED_NAME).read_text())
    assert saved["pages"]["part-flute"]["boxFlags"][1] == box_flag(5, "two_bars", None)
    assert "boxFlags" not in saved["pages"]["part-horn"]


def test_a_flag_without_a_suggested_edge_may_leave_the_key_out() -> None:
    data = the_map()
    data["pages"]["part-flute"]["boxFlags"] = [{"bar": 2, "verdict": "ends_late", "note": ""}]

    _, pages = parse_map(data)

    assert pages["part-flute"].boxFlags[0].suggestedX is None


def test_the_advanced_reading_verdicts_and_the_edges_to_put_back_survive_a_save_and_a_read(
    folder: Path,
) -> None:
    moved = {**box_flag(3, "read_moved", None), "previous": {"x": 20.5, "w": 100.0}}
    counted = box_flag(5, "read_count", None)
    data = the_map()
    data["pages"]["part-flute"]["boxFlags"] = [moved, counted]

    save(folder, data)

    flags = read_run(folder).pages["part-flute"].boxFlags
    assert [(f.bar, f.verdict) for f in flags] == [(3, "read_moved"), (5, "read_count")]
    assert flags[0].previous == BoxEdges(x=20.5, w=100.0) and flags[1].previous is None
    saved = json.loads((folder / CONFIRMED_NAME).read_text())["pages"]["part-flute"]["boxFlags"]
    assert saved == [moved, counted]  # a flag without edges to put back has no key for them


def test_a_flag_whose_edges_to_put_back_are_null_is_written_without_them(folder: Path) -> None:
    data = the_map()
    data["pages"]["part-flute"]["boxFlags"] = [{**box_flag(3), "previous": None}]

    save(folder, data)

    saved = json.loads((folder / CONFIRMED_NAME).read_text())["pages"]["part-flute"]["boxFlags"]
    assert saved == [box_flag(3)]
    assert read_run(folder).pages["part-flute"].boxFlags[0].previous is None


BAD_FLAGS = {
    "a flag on a bar with no box": box_flag(9),
    "a verdict that is no verdict": box_flag(3, "wobbly"),
    "ok is not a flag": box_flag(3, "ok"),
    "a negative suggested edge": box_flag(3, x=-1.0),
    "a suggested edge as text": {**box_flag(3), "suggestedX": "left"},
    "a flag with no note": {"bar": 3, "verdict": "two_bars"},
    "a flag with a key of its own": {**box_flag(3), "colour": "red"},
    "edges to put back with a key of their own": {
        **box_flag(3, "read_moved", None),
        "previous": {"x": 1.0, "w": 2.0, "y": 3.0},
    },
    "edges to put back with a negative width": {
        **box_flag(3, "read_moved", None),
        "previous": {"x": 1.0, "w": -2.0},
    },
    "edges to put back as text": {**box_flag(3, "read_moved", None), "previous": "left"},
    "edges to put back with no width": {**box_flag(3, "read_moved", None), "previous": {"x": 1.0}},
}


@pytest.mark.parametrize("what", BAD_FLAGS)
def test_a_bad_box_flag_is_refused(what: str, folder: Path) -> None:
    data = the_map()
    data["pages"]["part-flute"]["boxFlags"] = [BAD_FLAGS[what]]

    with pytest.raises(RunFolderError):
        save(folder, data)

    assert not (folder / CONFIRMED_NAME).exists(), what
