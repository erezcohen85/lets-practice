# Processor image for Railway (stateless, 4 GB limit set on the service, listens on $PORT).
#
# Written in Phase 3. Built by Railway. Docker is not installed on the dev machine, so
# tests/test_dockerfile.py only checks this file as text. Build context is backend/processor/
# (see .dockerignore).
#
# Stages:
#   audiveris-build  Eclipse Temurin JDK: clone a pinned Audiveris release and build it with Gradle.
#   temurin-jre      Eclipse Temurin JRE of the same Java major, copied into the runtime stage.
#   (final)          python:3.11-slim-bookworm: FFmpeg, JRE, Audiveris, the app environment with the
#                    `beat` extra (CPU-only torch, Beat This and its checkpoint).
#
# Expected size (an estimate, not measured): about 1.7 GB. Roughly: base 130 MB, FFmpeg 300 MB,
# JRE 25 200 MB, Audiveris 200 MB, torch CPU 450 MB, other Python packages 250 MB,
# Beat This checkpoint 81 MB. The stock torch wheel from PyPI would add about 3 GB of CUDA
# libraries that a CPU-only service can never use.

# ---------------------------------------------------------------------------------------------
# Stage 1: build Audiveris
# ---------------------------------------------------------------------------------------------
# Java 25 is what this Audiveris requires: theMinJavaVersion = 25 in its gradle.properties
# (also master_java_version in docs/_config.yml), and its start script refuses to run on less.
FROM eclipse-temurin:25.0.4.1_1-jdk-noble AS audiveris-build

# The exact Audiveris commit every real test and the PoC ran on. It is a build of Audiveris's
# `development` branch, whose version string is 5.12.0 (buildSrc/.../audiveris-commons.gradle);
# `git describe` there prints 5.10.1-320-g37589dd91. No 5.12.0 release tag exists upstream: the
# newest tag is 5.11.0 (checked 2026-10-30), so a tag cannot name what we tested. Move to a release
# tag once one at least this new exists, and bump the Temurin tags here and below with it if its
# theMinJavaVersion changes.
ARG AUDIVERIS_COMMIT=37589dd91750e3aa22850bf904555a64c22c63b6

# git: the Gradle task generateProgramId runs `git log`, so the source must keep its .git folder.
RUN apt-get update \
    && apt-get install --no-install-recommends -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# A shallow fetch of one commit: `git clone --branch` takes only branches and tags. GitHub serves
# any reachable commit by its full hash.
RUN git init audiveris \
    && git -C audiveris remote add origin https://github.com/Audiveris/audiveris.git \
    && git -C audiveris fetch --depth 1 origin "${AUDIVERIS_COMMIT}" \
    && git -C audiveris checkout --detach FETCH_HEAD

WORKDIR /src/audiveris
# installDist lays out app/build/install/app/{bin,lib}; bin/Audiveris is the batch-capable start
# script (`Audiveris -batch -transcribe -export -output <dir> <file>`). The Gradle wrapper downloads
# the Gradle version Audiveris pins and all Maven dependencies, including the Tesseract and
# Leptonica native libraries for linux-x86_64 and linux-arm64 (bundled inside the jars).
RUN ./gradlew --no-daemon --console=plain :app:installDist \
    && test -x app/build/install/app/bin/Audiveris

# ---------------------------------------------------------------------------------------------
# Stage 2: Java runtime source
# ---------------------------------------------------------------------------------------------
# Debian bookworm only ships openjdk-17, which is below Audiveris's minimum, so the JRE comes from
# the official Temurin image instead (same major as the build stage). Temurin binaries run on the
# older glibc of bookworm; this image is Ubuntu based only as a file source.
FROM eclipse-temurin:25.0.4.1_1-jre-noble AS temurin-jre

# ---------------------------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------------------------
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# ffmpeg: audio conversion. libfreetype6, fontconfig and fonts-dejavu-core: Audiveris renders PDF
# pages with Java2D and its docs list FreeType as a Unix requirement. Nothing else: the JRE and the
# Tesseract/Leptonica native libraries are self-contained (they only need libc, libm, libstdc++ and
# libgcc, which the base image has).
#
# No Tesseract language data (*.traineddata) is installed. Audiveris starts without any, warns, and
# skips only its TEXTS step; this product reads text from the score with a vision model instead.
# If the OMR output turns out to need Audiveris's own text pass, download eng.traineddata (tag 4.1.0,
# the theTessdataTag in Audiveris's gradle.properties) into a folder and set TESSDATA_PREFIX to it.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ffmpeg \
        fontconfig \
        fonts-dejavu-core \
        libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

# Java runtime (headless use only) and Audiveris. The start script finds `java` through JAVA_HOME.
COPY --from=temurin-jre /opt/java/openjdk /opt/java/openjdk
COPY --from=audiveris-build /src/audiveris/app/build/install/app /opt/audiveris
# AUDIVERIS_HOME is where the processor looks for the install (app/pipeline/audiveris.py): the
# folder holding bin/Audiveris. Without it the processor would look for a tar in repos/.
ENV JAVA_HOME=/opt/java/openjdk \
    AUDIVERIS_HOME=/opt/audiveris
# The heap cap leaves room for FFmpeg and the Python process inside the 4 GB limit set on the Railway
# service. Without a limit the JVM sizes its heap from a far larger ceiling. Tune it once real scores
# have been measured in Phase 9.
# sun.java2d.uiScale: on Linux, Audiveris asks GTK 3 for the monitor scale at startup (WellKnowns,
# enableHiDpiScaling) unless this is set, and the image has no GTK, so without it every run dies with
# UnsatisfiedLinkError: Unable to load library 'gtk-3'. There is no screen here, so the value changes nothing.
ENV JAVA_OPTS="-Djava.awt.headless=true -Dsun.java2d.uiScale=1 -XX:MaxRAMPercentage=50"

# uv builds the app environment. Same major.minor as the lockfile was written with (0.12.21).
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /usr/local/bin/uv
# .python-version says 3.12 for local work; this image is 3.11 and must never download another
# interpreter, so point uv at the image's Python explicitly.
ENV UV_PYTHON=/usr/local/bin/python3.11 \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

# Non-root user. Audiveris and JavaCPP write their config and native-library cache under $HOME.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app \
        --shell /usr/sbin/nologin app \
    && install -d -o app -g app /app /opt/torch

# TORCH_HOME is where torch.hub keeps the Beat This checkpoint ($TORCH_HOME/hub/checkpoints); it is
# filled at build time below, so a cold start downloads nothing.
# USE_FAKES stays off: this image always runs the real stages. Secrets (ANTHROPIC_API_KEY, the
# Supabase settings) are never set here; Railway injects them at run time as service variables.
ENV PATH="/app/.venv/bin:/opt/audiveris/bin:/opt/java/openjdk/bin:${PATH}" \
    HOME=/home/app \
    TORCH_HOME=/opt/torch \
    USE_FAKES=false
WORKDIR /app
USER app

# Dependencies first so the layer is cached until pyproject.toml or uv.lock change.
# The environment is the locked one, with the `beat` extra, but without the CUDA builds of torch
# and torchaudio: on Linux the lock resolves them to the PyPI wheels. PyPI's torch drags in about
# 3 GB of nvidia-* and triton packages, and PyPI's torchaudio links libcudart, so it cannot load
# here. So the locked set is exported, those are left out, and the CPU-only torch and torchaudio of
# the same version come from the PyTorch CPU index (Linux x86_64, CPython 3.11 wheels, pinned by hash). `--no-deps` is safe because the export is
# already the complete closed set. The export has no hashes (the filter would break its
# continuation lines); the versions are still exactly the lock's.
COPY --chown=app:app pyproject.toml uv.lock ./
RUN uv venv /app/.venv \
    && uv export --frozen --no-dev --extra beat --no-emit-project --no-hashes > /tmp/locked-all.txt \
    && grep -vE '^(torch==|torchaudio==|triton==|nvidia-)' /tmp/locked-all.txt > /tmp/locked.txt \
    && uv pip install --python /app/.venv/bin/python --no-deps -r /tmp/locked.txt
RUN printf '%s\n' \
        'torch==2.11.0+cpu --hash=sha256:8a56a8c95531ef0e454510ba8bbd9d11dc7a9000337265210b10f6bfeacdd485' \
        'torchaudio==2.11.0+cpu --hash=sha256:2ddcb49458aa9783121222c535c0eb9cd54445ec44bb8dd22c9e52cdb730dbc2' \
        > /tmp/torch-cpu.txt \
    && uv pip install --python /app/.venv/bin/python --no-deps --require-hashes \
        --index-url https://download.pytorch.org/whl/cpu -r /tmp/torch-cpu.txt

# Beat This checkpoint "final0" (the one app/pipeline/beats.py loads), baked in. beat_this fetches
# it from the authors' server on first use and keeps it in $TORCH_HOME/hub/checkpoints. The hash is
# of the file the PoC and the real tests used; a changed upstream file fails the build instead of
# changing the model silently. The build also fails here if the CPU wheel or an import is broken.
# The last check reads a WAV and runs the model the way app/pipeline/beats.py does, so a job cannot
# be the first to find that the audio loader or the model does not work on this torch.
RUN python -c "import torch; assert torch.__version__ == '2.11.0+cpu', torch.__version__" \
    && python -c "import torchaudio, beat_this.inference as i; i.load_checkpoint('final0')" \
    && echo "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331  /opt/torch/hub/checkpoints/beat_this-final0.ckpt" | sha256sum -c - \
    && python -c "import numpy as np, soundfile as sf; from beat_this.inference import Audio2Frames; from beat_this.preprocessing import load_audio; sf.write('/tmp/smoke.wav', np.zeros(22050 * 4), 22050); signal, rate = load_audio('/tmp/smoke.wav'); beat, downbeat = Audio2Frames(checkpoint_path='final0', device='cpu')(signal, rate); assert rate == 22050 and len(beat) > 0" \
    && rm /tmp/smoke.wav

COPY --chown=app:app app ./app

# The startup check the server runs when it serves real services (app.main lifespan) has to pass
# in the image, so the build runs it: ffmpeg and ffprobe on PATH, Java at $JAVA_HOME/bin/java,
# bin/Audiveris under $AUDIVERIS_HOME, and beat_this importable. The version call proves the JRE
# runs Java 25; that is not covered by that check.
RUN python -c "from app.pipeline.real_stages import missing_tool; m = missing_tool(); assert m is None, m" \
    && java -version

# Railway injects PORT; 8080 is only the default for running the image by hand. Shell form so
# ${PORT} expands, with exec so uvicorn is PID 1 and receives SIGTERM from Railway.
ENV PORT=8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
