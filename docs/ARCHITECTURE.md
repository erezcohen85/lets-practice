# Architecture

## What the app is

Let's Practice is for a single musician. They map their sheet-music part (a PDF) to a recording (an audio file), bar by bar. Then they loop a range of bars while a cursor follows the score.

## The map: two layers

A **piece** is one recording plus one or more **parts**. Each part is one PDF.

- **Timing layer** (one per piece). It maps (pass, bar number) to a time in the recording. It also holds the structure: bar count, play-order rows, meters and marks. Every part shares it.
- **Page layer** (one per part). It maps a bar number to a page and a box on that page image.

A new PDF edition rebuilds only its page layer. The timing layer re-attaches by bar number.

## Play order and bar numbers

The confirmed play order is the source of truth. It is a list of rows, for example `1-9, 10-15, 10-15, 16-end`.

- Each locator is (pass index, bar).
- A bar that is played twice has chained locators. Structural edits update them together.
- The app numbers bars itself, 1..N in page order. It never relies on printed bar numbers.

**Realign rule.** Confirmed locators are fixed anchors. A locator is confirmed when the user drags it by hand or marks it "Sounds right". A realign fits only the unconfirmed ones.

## Components

```
 Browser (frontend/)                     Supabase (backend/supabase/)
 React + Vite + TypeScript        --->   Auth, Postgres (RLS), Storage
 shadcn/ui, Tailwind; Railway            bucket "pieces"
        |                                         ^
        | HTTPS + user JWT                        | writes layers, updates jobs
        v                                         |
 Processor (backend/processor/)  -----------------+
 Python FastAPI on Railway, stateless
```

- **`frontend/`**: React + Vite + TypeScript, with shadcn/ui and Tailwind. It is hosted on Railway, as one of two services in one project.
  - Pure logic lives in `src/domain/`.
  - Pages and components talk to `DataClient` and `ProcessorClient` interfaces. Both have in-memory fakes. Set `VITE_USE_FAKES=1` to use them.
  - Design tokens live in `src/design/tokens.ts`. It is the single source for the CSS variables.
- **`backend/supabase/`**: Postgres migrations. Every table has row-level security. The storage bucket is `pieces`, with files under `{user_id}/{piece_id}/`. A share link is created off, and turning it on needs the owner's rights confirmation (own music, public domain or used with permission), whose time is kept on the share row (the music rule, migration 0013). The processor does not download from links; a recording is an uploaded file.
- **`backend/processor/`**: Python FastAPI, the other Railway service. It keeps no state.

## Flow

1. The browser uploads the raw files to Supabase Storage.
2. It calls the processor with the user's JWT.
3. The processor converts the files.
   - Audio becomes Opus/AAC, plus waveform peaks.
   - PDF pages become WebP, with deskew.
4. It runs a hybrid OMR (optical music recognition) read.
   - Audiveris finds the bar geometry.
   - A Claude Haiku vision read finds structure, part names, meters, fermatas, multi-rests and tempo text.
   - The two are combined by consensus.
5. It proposes the play order. The user confirms or edits it later, in the editor; that triggers a realign.
6. It detects downbeats with Beat This.
7. It runs constrained dynamic-programming alignment. It places exactly N downbeats for the play order, with meter-aware spacing and smooth tempo.
8. It writes the layers to Postgres.
9. The browser polls the `jobs` row until the job is done.

The browser and the alignment never talk directly. Postgres sits between them. Structure edits trigger `POST /jobs/realign`.

## Processor image

`backend/processor/Dockerfile` builds the image Railway runs: Python 3.11, FFmpeg, a Java 25 runtime, Audiveris (built from commit `37589dd91`, the build every real test ran on; its version string is 5.12.0 but no release tag exists), the locked Python environment with the `beat` extra on CPU-only torch, and the Beat This checkpoint baked in so a cold start downloads nothing. It runs as a non-root user with the real stages on (`USE_FAKES=false`); the Anthropic key and the Supabase settings come from the environment at run time and are never in the image. The build runs the same tool check the server runs at startup. Railway builds it; Docker is not installed on the dev machine, so `tests/test_dockerfile.py` checks the file as text.

## Testing

Every external service sits behind an interface with an in-memory fake. The services are Supabase, Railway, Audiveris, Beat This and Anthropic. Tests never touch the network.

## Folder map

```
frontend/             React app: src/domain/ (pure logic), src/lib/ (clients and fakes), src/pages/, src/components/
backend/supabase/     migrations/ (tables and RLS), seed.sql
backend/processor/    app/ (FastAPI), app/pipeline/ (pure pipeline stages), tests/
docs/                 this file
```
