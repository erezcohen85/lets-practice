# Let's Practice

Let's Practice links your recordings to your sheet-music PDF automatically, bar by bar, to create a high-quality practice experience. You can slow down, loop, get inspired or just play along while interacting with the sheet music itself, from your desktop, iPad or phone.

Share your pieces with students or ensemble members to let them practice along a specific reference recording.


**Try it for free:** [letspractice.site](https://letspractice.site)

## How it works

1. **Upload** a part (PDF) and a recording.
2. **Read:** the processor finds every bar on the page and proposes the play order (repeats, endings, jumps).
3. **Align:** it detects the downbeats in the recording and places each bar of the play order in time.
4. **Practice:** confirm or fix the map in the editor, then loop any bars with the cursor on the score.

The map has two layers: a **timing layer** per piece (pass, bar → time in the recording) and a **page layer** per part
(bar → page and box). Bars you fix by hand become fixed anchors; a realign only refits the rest.

## Architecture

```
 Browser (frontend/)                     Supabase (backend/supabase/)
 React + Vite + TypeScript        --->   Auth, Postgres (RLS), Storage
        |                                         ^
        | HTTPS + user JWT                        | writes the map, updates jobs
        v                                         |
 Processor (backend/processor/)  -----------------+
 Python FastAPI, stateless
```

- **Score reading:** Audiveris finds the bar geometry; a Claude vision read finds structure, meters and marks; the two
  are combined by consensus.
- **Downbeats:** [Beat This](https://github.com/CPJKU/beat_this).
- **Alignment:** constrained dynamic programming that places exactly one downbeat per bar of the play order, with
  meter-aware spacing and smooth tempo.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

| Part      | Tools                                                              |
|-----------|--------------------------------------------------------------------|
| Frontend  | React 19, TypeScript, Vite, Tailwind, shadcn/ui, Vitest            |
| Data      | Supabase: Auth (Google), Postgres with row-level security, Storage |
| Processor | Python 3.11, FastAPI, FFmpeg, PyMuPDF, Audiveris, Beat This, pytest |

## Repository

```
frontend/             the web app: src/domain/ holds the pure, unit-tested logic
backend/supabase/     migrations (every table has RLS) and seed data
backend/processor/    the FastAPI service: app/pipeline/ holds the pipeline stages
docs/                 architecture notes
```

## Run it locally

Both sides run on in-memory fakes, so no account, key or network is needed.

```bash
# frontend
cd frontend
npm install
VITE_USE_FAKES=1 VITE_FAKE_SEED=demo npm run dev

# processor
cd backend/processor
uv sync
USE_FAKES=1 uv run uvicorn app.main:app --reload
```

## Tests

Every external service (Supabase, Audiveris, Beat This, Anthropic) sits behind an interface with an in-memory fake.
Tests use only fakes and synthetic fixtures and never touch the network.

```bash
cd frontend && npm test && npm run lint && npm run typecheck
cd backend/processor && uv run pytest && uv run ruff check .
```

## License

[AGPL-3.0](LICENSE), matching Audiveris.

The demo piece is Mendelssohn's *Venetian Gondola Song*, Op. 30 No. 6. The recording is by FAE Piano cafe,
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), from
[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:FAE_Piano_cafe_-_Mendelssohn%27s_Songs_Without_Words,_Book_2,_Op._30,_No._6,_Allegretto_tranquillo_(Venetian_Boat_Song_No._2),_MWV_U_110.ogg),
converted to AAC and synced to the score. The score is the Breitkopf & Härtel edition (public domain), scanned on
[IMSLP](https://imslp.org/wiki/Special:ReverseLookup/109643).
