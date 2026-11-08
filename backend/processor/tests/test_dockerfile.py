"""Static checks on the Railway Dockerfile and .dockerignore.

Docker is not installed on the dev machine and the image is built by Railway, so
these tests only read the two files as text. They pin the decisions that are easy to break by
accident: stage layout, pinned versions, the real tools and the model weights, no secrets in the
image, non-root user, `$PORT` handling.
"""

import re
import shlex
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from app.pipeline.beats import _CHECKPOINT

PROCESSOR_DIR = Path(__file__).resolve().parents[1]
DOCKERFILE = PROCESSOR_DIR / "Dockerfile"
DOCKERIGNORE = PROCESSOR_DIR / ".dockerignore"
PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"
UV_LOCK = PROCESSOR_DIR / "uv.lock"

# gradle.properties of the Audiveris commit in use: theMinJavaVersion = 25.
AUDIVERIS_MIN_JAVA = 25
# The commit every real test and the PoC ran on (version string 5.12.0 of Audiveris's development
# branch; no 5.12.0 release tag exists, the newest is 5.11.0).
AUDIVERIS_TESTED_COMMIT = "37589dd91750e3aa22850bf904555a64c22c63b6"


@dataclass
class Stage:
    image: str
    name: str | None
    instructions: list[tuple[str, str]] = field(default_factory=list)

    def run_commands(self) -> list[str]:
        return [args for keyword, args in self.instructions if keyword == "RUN"]

    def args_of(self, keyword: str) -> list[str]:
        return [args for kw, args in self.instructions if kw == keyword]


def _env_vars(stage: Stage) -> dict[str, str]:
    """Every NAME=value set by the ENV instructions of a stage, later ones winning."""
    found: dict[str, str] = {}
    for args in stage.args_of("ENV"):
        for token in shlex.split(args):
            name, _, value = token.partition("=")
            found[name] = value
    return found


def _logical_lines(text: str) -> list[str]:
    """Join backslash continuations and drop comment-only and blank lines (Docker semantics)."""
    lines: list[str] = []
    buffer = ""
    for raw in text.splitlines():
        stripped = raw.strip()
        if not buffer and (not stripped or stripped.startswith("#")):
            continue
        if buffer and stripped.startswith("#"):
            continue  # comment lines inside a continued instruction are removed by Docker
        if stripped.endswith("\\"):
            buffer += stripped[:-1].rstrip() + " "
            continue
        lines.append((buffer + stripped).strip())
        buffer = ""
    if buffer:
        lines.append(buffer.strip())
    return lines


def _parse_stages(text: str) -> list[Stage]:
    stages: list[Stage] = []
    for line in _logical_lines(text):
        keyword, _, args = line.partition(" ")
        keyword = keyword.upper()
        args = args.strip()
        if keyword == "FROM":
            parts = [p for p in args.split() if not p.startswith("--")]
            name = parts[2] if len(parts) >= 3 and parts[1].lower() == "as" else None
            stages.append(Stage(image=parts[0], name=name))
            continue
        if not stages:
            continue  # global ARGs before the first FROM
        stages[-1].instructions.append((keyword, args))
    return stages


@pytest.fixture(scope="module")
def dockerfile_text() -> str:
    assert DOCKERFILE.is_file(), f"missing {DOCKERFILE}"
    return DOCKERFILE.read_text()


@pytest.fixture(scope="module")
def stages(dockerfile_text: str) -> list[Stage]:
    return _parse_stages(dockerfile_text)


@pytest.fixture(scope="module")
def build_stage(stages: list[Stage]) -> Stage:
    matches = [s for s in stages if s.name == "audiveris-build"]
    assert len(matches) == 1, "expected exactly one stage named audiveris-build"
    return matches[0]


@pytest.fixture(scope="module")
def final_stage(stages: list[Stage]) -> Stage:
    assert len(stages) >= 2, "expected a multi-stage Dockerfile"
    return stages[-1]


def _java_major(image: str) -> int:
    match = re.match(r"eclipse-temurin:(\d+)", image)
    assert match, f"not an eclipse-temurin image with an explicit version: {image}"
    return int(match.group(1))


def _arg_defaults(stage: Stage) -> dict[str, str]:
    return {
        k.strip(): v.strip().strip("\"'")
        for k, _, v in (a.partition("=") for a in stage.args_of("ARG"))
    }


def _audiveris_commit(build_stage: Stage) -> str:
    """The commit the `git fetch --depth 1 origin ${ARG}` names, resolved to its ARG default."""
    fetches = [c for c in build_stage.run_commands() if "git" in c and " fetch " in c]
    assert len(fetches) == 1, "expected exactly one git fetch in the build stage"
    fetch = fetches[0]
    assert "github.com/Audiveris/audiveris" in fetch
    assert "--depth 1" in fetch
    match = re.search(r"fetch --depth 1 origin\s+\"?\$\{?(\w+)\}?\"?", fetch)
    assert match, "git fetch --depth 1 origin <ARG commit>"
    defaults = _arg_defaults(build_stage)
    assert match.group(1) in defaults, f"ARG {match.group(1)} needs a default value"
    return defaults[match.group(1)]


def _locked_torch_version() -> str:
    """The newest torch in uv.lock: the Linux resolution (the macOS x86_64 one is older)."""
    versions = re.findall(
        r'\[\[package\]\]\nname = "torch"\nversion = "([\d.]+)"', UV_LOCK.read_text()
    )
    assert versions, "no torch in uv.lock"
    return max(versions, key=lambda v: tuple(int(n) for n in v.split(".")))


# --- stages and base images -------------------------------------------------------------------


def test_build_stage_is_a_temurin_jdk_with_explicit_version(build_stage: Stage) -> None:
    image = build_stage.image
    assert re.fullmatch(r"eclipse-temurin:\d[\w.]*-jdk[\w.-]*", image), image
    assert _java_major(build_stage.image) >= AUDIVERIS_MIN_JAVA


def test_final_stage_is_python_311_slim_bookworm(final_stage: Stage, build_stage: Stage) -> None:
    assert final_stage.image == "python:3.11-slim-bookworm"
    assert final_stage is not build_stage


def test_every_from_is_pinned(stages: list[Stage]) -> None:
    for stage in stages:
        image = stage.image
        assert ":" in image or "@sha256:" in image, f"no tag or digest: {image}"
        assert not image.endswith(":latest"), f"latest is not a pin: {image}"
    assert "latest" not in " ".join(s.image for s in stages)


def test_copy_from_images_are_pinned(dockerfile_text: str) -> None:
    """`COPY --from=<registry image>` (the uv binary) must carry an explicit version too."""
    external = re.findall(r"--from=([^\s]+)", dockerfile_text)
    stage_names = {s.name for s in _parse_stages(dockerfile_text) if s.name is not None}
    for source in external:
        if source in stage_names:
            continue
        assert re.search(r":\d[\w.]*$", source) or "@sha256:" in source, f"unpinned: {source}"


# --- Audiveris --------------------------------------------------------------------------------


def test_audiveris_is_the_commit_that_was_tested(build_stage: Stage) -> None:
    commit = _audiveris_commit(build_stage)
    assert re.fullmatch(r"[0-9a-f]{40}", commit), f"not a full commit hash: {commit}"
    assert commit == AUDIVERIS_TESTED_COMMIT
    assert "--branch" not in " ".join(build_stage.run_commands()), "a branch or tag is not a pin"


def test_the_audiveris_pin_is_explained_in_the_dockerfile(dockerfile_text: str) -> None:
    """No 5.12.0 tag exists, so the file has to say why a commit is pinned instead of a tag."""
    assert "5.12.0" in dockerfile_text
    assert "no 5.12.0 release tag" in dockerfile_text.lower()


def test_audiveris_is_built_with_the_gradle_wrapper(build_stage: Stage) -> None:
    builds = [c for c in build_stage.run_commands() if "gradlew" in c]
    assert builds, "no ./gradlew call in the build stage"
    assert any("installDist" in c for c in builds)
    # The wrapper needs git for the generateProgramId task, so the clone keeps its .git folder.
    assert not any("rm -rf .git" in c for c in build_stage.run_commands())


def test_audiveris_install_is_copied_from_the_build_stage(final_stage: Stage) -> None:
    copies = [c for c in final_stage.args_of("COPY") if "--from=audiveris-build" in c]
    assert copies, "final stage must COPY --from=audiveris-build"
    assert any("/opt/audiveris" in c for c in copies)


def test_audiveris_bin_is_on_the_path(final_stage: Stage) -> None:
    env = " ".join(final_stage.args_of("ENV"))
    assert re.search(r"PATH=[^ ]*/opt/audiveris/bin", env), "put /opt/audiveris/bin on PATH"


def test_audiveris_home_is_where_the_install_is_copied(final_stage: Stage) -> None:
    """The processor reads $AUDIVERIS_HOME (the folder with bin/Audiveris), else looks in repos/."""
    destinations = [
        c.split()[-1] for c in final_stage.args_of("COPY") if "--from=audiveris-build" in c
    ]
    assert destinations == ["/opt/audiveris"]
    assert _env_vars(final_stage).get("AUDIVERIS_HOME") == destinations[0]


# --- runtime tools ----------------------------------------------------------------------------


def test_ffmpeg_is_installed_without_recommends(final_stage: Stage) -> None:
    installs = [c for c in final_stage.run_commands() if "apt-get install" in c]
    assert any("--no-install-recommends" in c and re.search(r"\bffmpeg\b", c) for c in installs), (
        "apt-get install --no-install-recommends ... ffmpeg"
    )


def test_apt_lists_are_cleaned_in_the_same_layer(final_stage: Stage) -> None:
    installs = [c for c in final_stage.run_commands() if "apt-get install" in c]
    assert installs
    assert all("rm -rf /var/lib/apt/lists" in c for c in installs)


def test_final_stage_has_a_jre_of_the_audiveris_java_major(
    stages: list[Stage], build_stage: Stage, final_stage: Stage
) -> None:
    major = _java_major(build_stage.image)
    jre_stages = {
        s.name: s for s in stages if s.name and re.search(r"eclipse-temurin:\d[\w.]*-jre", s.image)
    }
    copied = [
        name
        for name in jre_stages
        if any(f"--from={name}" in c for c in final_stage.args_of("COPY"))
    ]
    apt_jre = [
        c
        for c in final_stage.run_commands()
        if re.search(rf"openjdk-{major}-jre-headless", c) and "--no-install-recommends" in c
    ]
    assert copied or apt_jre, "no JRE in the final stage"
    for name in copied:
        assert _java_major(jre_stages[name].image) == major
    if copied:
        env = " ".join(final_stage.args_of("ENV"))
        assert "JAVA_HOME=" in env, "set JAVA_HOME when the JRE is copied from the Temurin image"


def test_no_download_tools_are_installed_and_no_global_pip(final_stage: Stage) -> None:
    """Links are no longer fetched (Decision 2026-11-06): no yt-dlp, ejs or Deno in the image."""
    text = DOCKERFILE.read_text().lower()
    for gone in ("yt-dlp", "yt_dlp", "deno"):
        assert gone not in text, gone
    global_pip = [c for c in final_stage.run_commands() if re.search(r"(?<!uv )pip install", c)]
    assert not global_pip, "a global pip install is never imported by the app's venv"


# --- app dependencies -------------------------------------------------------------------------


def test_uv_binary_is_copied_from_a_pinned_image(final_stage: Stage) -> None:
    copies = [c for c in final_stage.args_of("COPY") if "ghcr.io/astral-sh/uv:" in c]
    assert copies, "copy uv from ghcr.io/astral-sh/uv:<version>"
    assert re.search(r"--from=ghcr\.io/astral-sh/uv:\d+\.\d+\.\d+\s", copies[0] + " ")


def _export_commands(final_stage: Stage) -> list[str]:
    return [c for c in final_stage.run_commands() if "uv export" in c]


def test_the_environment_is_the_locked_one_without_dev_and_with_the_beat_extra(
    final_stage: Stage,
) -> None:
    exports = _export_commands(final_stage)
    assert len(exports) == 1, "expected one uv export of the lock"
    export = exports[0]
    assert "--frozen" in export
    assert "--no-dev" in export
    assert "--extra beat" in export
    assert "--all-extras" not in export
    installs = [c for c in final_stage.run_commands() if "uv pip install" in c]
    assert installs and all("--no-deps" in c for c in installs), (
        "the export is the whole closed set; resolving again could pull the CUDA torch back in"
    )


def test_the_cuda_build_of_torch_is_left_out_and_the_cpu_wheel_is_pinned_by_hash(
    final_stage: Stage,
) -> None:
    export = _export_commands(final_stage)[0]
    assert re.search(r"grep -vE '\^\(torch==\|torchaudio==\|triton==\|nvidia-\)'", export), (
        "filter torch, torchaudio, triton and nvidia-* out of the export: PyPI's Linux torchaudio "
        "links libcudart, so it cannot load in a CPU-only image"
    )
    cpu = [c for c in final_stage.run_commands() if "download.pytorch.org/whl/cpu" in c]
    assert len(cpu) == 1
    assert "--index-url https://download.pytorch.org/whl/cpu" in cpu[0]
    assert "--require-hashes" in cpu[0] and "--no-deps" in cpu[0]
    pinned = re.search(r"torch==([\d.]+)\+cpu --hash=sha256:[0-9a-f]{64}", cpu[0])
    assert pinned, "torch==<version>+cpu --hash=sha256:<hash>"
    assert pinned.group(1) == _locked_torch_version(), "keep the CPU wheel on the lock's torch"
    audio = re.search(r"torchaudio==([\d.]+)\+cpu --hash=sha256:[0-9a-f]{64}", cpu[0])
    assert audio, "torchaudio==<version>+cpu --hash=sha256:<hash>"
    assert audio.group(1) == _locked_torch_version(), "torchaudio stays on torch's version"


def test_torch_and_torchaudio_are_a_matched_pair_in_the_lock() -> None:
    """torchaudio's compiled library only loads with the torch minor it was built for."""
    audio = re.findall(
        r'\[\[package\]\]\nname = "torchaudio"\nversion = "([\d.]+)"', UV_LOCK.read_text()
    )
    newest_audio = max(audio, key=lambda version: [int(part) for part in version.split(".")])
    assert newest_audio.split(".")[:2] == _locked_torch_version().split(".")[:2]


def test_beat_this_checkpoint_is_baked_into_the_image(final_stage: Stage) -> None:
    env = _env_vars(final_stage)
    assert env.get("TORCH_HOME") == "/opt/torch"
    checkpoint = f"{env['TORCH_HOME']}/hub/checkpoints/beat_this-{_CHECKPOINT}.ckpt"
    bakes = [c for c in final_stage.run_commands() if "load_checkpoint" in c]
    assert len(bakes) == 1
    assert f"load_checkpoint('{_CHECKPOINT}')" in bakes[0]
    assert re.search(rf"[0-9a-f]{{64}}\s+{re.escape(checkpoint)}\"? \| sha256sum -c -", bakes[0])
    assert "torch.__version__" in bakes[0] and "+cpu" in bakes[0]
    assert any("install -d -o app" in c and "/opt/torch" in c for c in final_stage.run_commands())


def test_the_build_reads_a_wav_and_runs_the_model_as_a_real_job_does(final_stage: Stage) -> None:
    """torchaudio 2.11's load needs torchcodec, absent here: Beat This falls back to soundfile."""
    assert '"soundfile' in PYPROJECT.read_text()
    assert re.search(r'^name = "soundfile"$', UV_LOCK.read_text(), re.MULTILINE)
    bakes = [c for c in final_stage.run_commands() if "load_checkpoint" in c]
    assert "load_audio(" in bakes[0] and "Audio2Frames(checkpoint_path=" in bakes[0]


def test_the_startup_tool_check_runs_during_the_build(final_stage: Stage) -> None:
    checks = [c for c in final_stage.run_commands() if "missing_tool" in c]
    assert len(checks) == 1
    assert "app.pipeline.real_stages" in checks[0]
    assert "java -version" in checks[0] and "deno" not in checks[0]
    keywords = [kw for kw, _ in final_stage.instructions]
    copy_app = next(
        i for i, (kw, a) in enumerate(final_stage.instructions) if kw == "COPY" and "app ./app" in a
    )
    check = next(i for i, (kw, a) in enumerate(final_stage.instructions) if "missing_tool" in a)
    assert copy_app < check < keywords.index("CMD")


def test_the_image_runs_the_real_stages_and_holds_no_secret_settings(stages: list[Stage]) -> None:
    final = stages[-1]
    use_fakes = _env_vars(final).get("USE_FAKES", "")
    assert use_fakes.lower() in {"", "0", "false", "no", "off"}
    for stage in stages:
        names = {*_env_vars(stage), *_arg_defaults(stage)}
        for name in names:
            assert not re.search(r"KEY|SECRET|TOKEN|PASSWORD|SUPABASE|ANTHROPIC", name), name


def test_uv_uses_the_image_python_not_a_downloaded_one(final_stage: Stage) -> None:
    """.python-version says 3.12 for local work; the image is 3.11 and must not download another."""
    env = " ".join(final_stage.args_of("ENV"))
    assert "UV_PYTHON_DOWNLOADS=never" in env
    assert re.search(r"UV_PYTHON=\S*python3\.11", env)


# --- runtime user and start command -----------------------------------------------------------


def test_final_stage_runs_as_a_non_root_user(final_stage: Stage) -> None:
    users = final_stage.args_of("USER")
    assert users, "no USER instruction in the final stage"
    assert users[-1].split(":")[0] not in {"root", "0"}
    keywords = [kw for kw, _ in final_stage.instructions]
    assert "CMD" in keywords
    last_user_index = max(i for i, kw in enumerate(keywords) if kw == "USER")
    cmd_index = max(i for i, kw in enumerate(keywords) if kw == "CMD")
    assert last_user_index < cmd_index, "USER must come before CMD"


def test_port_defaults_to_8080_and_the_start_command_expands_it(final_stage: Stage) -> None:
    assert "PORT=8080" in " ".join(final_stage.args_of("ENV"))
    cmds = final_stage.args_of("CMD")
    assert len(cmds) == 1
    command = cmds[0]
    assert not command.startswith("["), "CMD must be shell form so $PORT expands"
    assert "uvicorn app.main:app" in command
    assert "--host 0.0.0.0" in command
    assert re.search(r"--port \$\{?PORT\}?", command)


def test_no_env_files_or_secrets_are_copied(stages: list[Stage]) -> None:
    for stage in stages:
        for keyword in ("COPY", "ADD"):
            for args in stage.args_of(keyword):
                for token in args.split():
                    leaf = token.rstrip("/").rsplit("/", 1)[-1]
                    assert not (leaf.startswith(".env") and leaf != ".env.example"), args
                    assert "secrets" not in token.split("/"), args


# --- .dockerignore ----------------------------------------------------------------------------


@pytest.fixture(scope="module")
def ignore_lines() -> list[str]:
    assert DOCKERIGNORE.is_file(), f"missing {DOCKERIGNORE}"
    return [
        line.strip()
        for line in DOCKERIGNORE.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


@pytest.mark.parametrize(
    "pattern",
    [
        ".env",
        ".env.*",
        "!.env.example",
        ".venv",
        "__pycache__",
        "*.pyc",
        ".pytest_cache",
        ".ruff_cache",
        "tests/",
        "spikes/",
    ],
)
def test_dockerignore_lists(ignore_lines: list[str], pattern: str) -> None:
    assert pattern in ignore_lines


def test_dockerignore_negation_comes_after_the_env_wildcard(ignore_lines: list[str]) -> None:
    """Later patterns win in .dockerignore, so the exception must follow `.env.*`."""
    assert ignore_lines.index("!.env.example") > ignore_lines.index(".env.*")


def test_dockerignore_does_not_exclude_what_the_image_needs(ignore_lines: list[str]) -> None:
    for needed in ("app", "app/", "pyproject.toml", "uv.lock", "README.md"):
        assert needed not in ignore_lines
