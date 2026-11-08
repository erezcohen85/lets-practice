// @vitest-environment node
import { type PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  databaseWithMigrations,
} from "@/test/supabaseStandIn";

const ADMIN = "00000000-0000-4000-8000-0000000000a0";
const U1 = "00000000-0000-4000-8000-0000000000a1";
const FULL = "00000000-0000-4000-8000-0000000000a2";
const STRANGER = "00000000-0000-4000-8000-0000000000a3";
const MASTER = "00000000-0000-4000-8000-0000000000f0";
const PART = "00000000-0000-4000-8000-0000000000e0";
const NEW = "00000000-0000-4000-8000-0000000000f1";
const NEW2 = "00000000-0000-4000-8000-0000000000f2";
const ORDINARY = "00000000-0000-4000-8000-0000000000f3";
const MASTER2 = "00000000-0000-4000-8000-0000000000f4";
const CREDITS2 = [
  { what: "Score", who: "Y", licence: "Public domain", source: "https://y" },
];
const FULL_PIECES = [1, 2, 3].map(
  (n) => `00000000-0000-4000-8000-00000000010${n}`,
);

const CREDITS = [
  { what: "Recording", who: "X", licence: "CC BY 3.0", source: "https://x" },
];
const MASTER_PATHS = {
  pdf: `${ADMIN}/${MASTER}/score.pdf`,
  page0: `${ADMIN}/${MASTER}/${PART}/page-0.webp`,
  page1: `${ADMIN}/${MASTER}/${PART}/page-1.webp`,
  audio: `${ADMIN}/${MASTER}/recording.mp3`,
  stored: `${ADMIN}/${MASTER}/audio.m4a`,
};

let db: PGlite;

// Migration 0016, one sample piece per account (Decisions 2026-11-08). The admin's master piece is copied, rows and path
// names, into an account once, by the processor with the service role. One database with the migrations and the seed
// (an admin who owns a master with a full map, a Trial user, a Trial user who has used all three slots); each test works
// on a copy of it.
let base: PGlite;
beforeAll(async () => {
  base = await databaseWithMigrations();
  await base.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ('${ADMIN}', 'admin@example.com', now(), '{"full_name":"The Admin"}'),
      ('${U1}', 'u1@example.com', now(), '{}'),
      ('${FULL}', 'full@example.com', now(), '{}'),
      ('${STRANGER}', 's@example.com', now(), '{}');
    insert into public.admins (user_id) values ('${ADMIN}');

    insert into public.pieces (id, owner_id, title, count_in_bars, structure_set_at, created_at, practice, last_part_id)
      values ('${MASTER}', '${ADMIN}', 'Gondola Song', 2, '2026-10-20T08:00:00Z', '2026-09-01T10:00:00Z', '{"speed":0.5}', null);
    insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name, position, name_source, rests, box_flags, box_check)
      values ('${PART}', '${MASTER}', '${MASTER_PATHS.pdf}', 'abc123', 2, 'Piano', 0, 'read', '{3,4}', '[{"bar":2,"kind":"wide"}]', true);
    update public.pieces set last_part_id = '${PART}' where id = '${MASTER}';
    insert into public.score_pages (score_file_id, page_index, image_path, width, height) values
      ('${PART}', 0, '${MASTER_PATHS.page0}', 800, 1100),
      ('${PART}', 1, '${MASTER_PATHS.page1}', 810, 1110);
    insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h, time_sig) values
      ('${PART}', 0, 0, 1.5, 2.5, 30.5, 40.5, '3/4'),
      ('${PART}', 1, 0, 10, 20, 300, 400, '3/4'),
      ('${PART}', 2, 1, 11, 21, 301, 401, '6/8');
    insert into public.audio_sources (piece_id, kind, url_or_path, duration, stored_path, name)
      values ('${MASTER}', 'file', '${MASTER_PATHS.audio}', 123.5, '${MASTER_PATHS.stored}', 'Piano cafe recording');
    insert into public.play_order (piece_id, rows, meters, marks, bar_count, short_bars)
      values ('${MASTER}', '[{"from":1,"to":2}]', '[{"from_bar":1,"numerator":3,"denominator":4}]', '[{"bar":2,"kind":"fermata"}]', 3, '[{"bar":0,"units":1}]');
    insert into public.locators (piece_id, pass_index, bar_number, time_sec, confirmed, flags, checked) values
      ('${MASTER}', 0, 1, 1.25, true, '[{"kind":"tempo"}]', true),
      ('${MASTER}', 0, 2, 2.5, false, '[]', false),
      ('${MASTER}', 1, 2, 7.75, true, '[]', true);

    -- Things the copy must leave behind.
    insert into public.jobs (piece_id, kind, status) values ('${MASTER}', 'process-piece', 'done');
    insert into public.piece_shares (piece_id, token) values ('${MASTER}', 'master-token');
    insert into public.piece_members (piece_id, user_id) values ('${MASTER}', '${STRANGER}');
    insert into public.piece_practice (user_id, piece_id, practice) values ('${STRANGER}', '${MASTER}', '{"speed":0.8}');

    -- A Trial user who has made all three pieces they may. Their events are dated three days ago so that "today on Trial" starts at 0.
    insert into public.pieces (id, owner_id, title) values ${FULL_PIECES.map((id, i) => `('${id}', '${FULL}', 'Used ${i}')`).join(", ")};
    update public.usage_events set at = now() - interval '3 days';

    insert into storage.objects (bucket_id, name) values
      ${Object.values(MASTER_PATHS)
        .map((path) => `('pieces', '${path}')`)
        .join(",\n      ")};
  `);
}, 120_000);
beforeEach(async () => {
  db = (await base.clone()) as PGlite;
});
afterEach(async () => {
  await db.close();
});

const q = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) => (await db.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) => (await q<T>(sql, params))[0]!;
const setMaster = () =>
  asService(db, "select public.service_set_sample_piece($1, $2::jsonb)", [
    MASTER,
    JSON.stringify(CREDITS),
  ]);
const copy = async (user = U1, piece = NEW) =>
  (
    await asService<{ r: CopyResult }>(
      db,
      "select public.service_copy_sample_piece($1, $2) as r",
      [user, piece],
    )
  )[0]!.r;
const stateOf = async (user: string) =>
  (
    await asService<{ r: SampleState }>(
      db,
      "select public.service_sample_state($1) as r",
      [user],
    )
  )[0]!.r;
const myPlan = (user: string) =>
  asUser<{ p: { usage: Record<string, number> } }>(
    db,
    user,
    "select public.my_plan() as p",
  ).then((rows) => rows[0]!.p);

type SampleState = {
  given_at: string | null;
  has_master: boolean;
  is_master_owner: boolean;
  room: boolean;
};
type CopyResult = { piece_id: string; files: { from: string; to: string }[] };

describe("what is closed", () => {
  it("keeps sample_piece from anon and authenticated, and every service function from authenticated", async () => {
    await expect(
      asUser(db, U1, "select * from public.sample_piece"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("set role anon");
    try {
      await expect(
        db.query("select * from public.sample_piece"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
    const calls = [
      `select public.service_sample_state('${U1}')`,
      `select public.service_copy_sample_piece('${U1}', '${NEW}')`,
      `select public.service_mark_sample('${U1}', true)`,
      `select public.service_unmark_sample('${U1}')`,
      `select public.service_set_sample_piece('${MASTER}', '[]'::jsonb)`,
      "select public.service_clear_sample_piece()",
    ];
    for (const sql of calls) {
      await expect(asUser(db, U1, sql)).rejects.toThrow(/permission denied/);
    }
  });
});

describe("the state of an account", () => {
  it("has no master before one is set", async () => {
    expect(await stateOf(U1)).toMatchObject({
      has_master: false,
      given_at: null,
      is_master_owner: false,
    });
  });

  it("has a master, room for a Trial user with slots left, none for one with none, and tells the master owner", async () => {
    await setMaster();
    expect(await stateOf(U1)).toEqual({
      given_at: null,
      has_master: true,
      is_master_owner: false,
      room: true,
    });
    expect(await stateOf(FULL)).toMatchObject({
      has_master: true,
      room: false,
    });
    expect(await stateOf(ADMIN)).toMatchObject({
      is_master_owner: true,
      room: true,
    });
  });

  it("wants room on both counts, treats an empty maximum as no limit, and does not look at pause or the daily cap", async () => {
    await setMaster();
    await db.exec(
      `update public.plans set pieces_stored_max = 0 where id = 'trial'`,
    );
    expect((await stateOf(U1)).room).toBe(false);
    await db.exec(
      `update public.plans set pieces_stored_max = 3, pieces_created_max = 0 where id = 'trial'`,
    );
    expect((await stateOf(U1)).room).toBe(false);
    await db.exec(
      `update public.plans set pieces_created_max = null where id = 'trial'`,
    );
    expect((await stateOf(U1)).room).toBe(true);
    await db.exec(
      `update public.plans set new_pieces_paused = true, new_pieces_per_day = 0 where id = 'trial'`,
    );
    expect((await stateOf(U1)).room).toBe(true);
  });
});

describe("copying the master into an account", () => {
  const idsOf = async (sql: string, piece: string) =>
    (await q<{ id: string }>(sql, [piece])).map((row) => row.id);

  it("makes an ordinary piece of the user with new ids, the same data, and new paths for the same files", async () => {
    await setMaster();
    const result = await copy();
    expect(result.piece_id).toBe(NEW);

    // The piece
    expect(
      await one(
        `select owner_id, title, count_in_bars, structure_set_at::text as structure_set_at, sample_of, sample_credits, practice, last_part_id from public.pieces where id = $1`,
        [NEW],
      ),
    ).toEqual({
      owner_id: U1,
      title: "Gondola Song",
      count_in_bars: 2,
      structure_set_at: (
        await one<{ s: string }>(
          `select structure_set_at::text as s from public.pieces where id = $1`,
          [MASTER],
        )
      ).s,
      sample_of: MASTER,
      // The credits travel with the copy.
      sample_credits: CREDITS,
      // The admin's own practice memory and last part are not the user's.
      practice: {},
      last_part_id: null,
    });
    expect(
      (
        await one<{ fresh: boolean }>(
          `select created_at > now() - interval '1 day' as fresh from public.pieces where id = $1`,
          [NEW],
        )
      ).fresh,
    ).toBe(true);

    // Every row of the other tables: the same but for its ids and its paths
    const same = async (
      sql: string,
      left: string,
      right: string,
      rows: number,
    ) => {
      const a = await q<{ r: unknown }>(sql, [left]);
      const b = await q<{ r: unknown }>(sql, [right]);
      expect(a).toHaveLength(rows);
      expect(b).toEqual(a);
    };
    const newPart = (
      await one<{ id: string }>(
        "select id from public.score_files where piece_id = $1",
        [NEW],
      )
    ).id;
    expect(newPart).not.toBe(PART);
    await same(
      `select to_jsonb(f) - 'id' - 'piece_id' - 'storage_path' as r from public.score_files f where piece_id = $1 order by position`,
      MASTER,
      NEW,
      1,
    );
    await same(
      `select to_jsonb(s) - 'id' - 'score_file_id' - 'image_path' as r from public.score_pages s where score_file_id = $1 order by page_index`,
      PART,
      newPart,
      2,
    );
    await same(
      `select to_jsonb(b) - 'id' - 'score_file_id' as r from public.bars b where score_file_id = $1 order by bar_number`,
      PART,
      newPart,
      3,
    );
    await same(
      `select to_jsonb(a) - 'id' - 'piece_id' - 'url_or_path' - 'stored_path' as r from public.audio_sources a where piece_id = $1`,
      MASTER,
      NEW,
      1,
    );
    await same(
      `select to_jsonb(o) - 'id' - 'piece_id' as r from public.play_order o where piece_id = $1`,
      MASTER,
      NEW,
      1,
    );
    await same(
      `select to_jsonb(l) - 'id' - 'piece_id' as r from public.locators l where piece_id = $1 order by bar_number, pass_index`,
      MASTER,
      NEW,
      3,
    );

    // New ids everywhere
    const masterIds = [
      ...(await idsOf(
        "select id from public.score_files where piece_id = $1",
        MASTER,
      )),
      ...(await idsOf(
        "select id from public.audio_sources where piece_id = $1",
        MASTER,
      )),
      ...(await idsOf(
        "select id from public.play_order where piece_id = $1",
        MASTER,
      )),
      ...(await idsOf(
        "select id from public.locators where piece_id = $1",
        MASTER,
      )),
      ...(await idsOf(
        "select s.id from public.score_pages s where s.score_file_id = $1 and $1::uuid is not null",
        PART,
      )),
      ...(await idsOf(
        "select b.id from public.bars b where b.score_file_id = $1 and $1::uuid is not null",
        PART,
      )),
    ];
    const copyIds = [
      ...(await idsOf(
        "select id from public.score_files where piece_id = $1",
        NEW,
      )),
      ...(await idsOf(
        "select id from public.audio_sources where piece_id = $1",
        NEW,
      )),
      ...(await idsOf(
        "select id from public.play_order where piece_id = $1",
        NEW,
      )),
      ...(await idsOf(
        "select id from public.locators where piece_id = $1",
        NEW,
      )),
      ...(await idsOf(
        "select s.id from public.score_pages s where s.score_file_id = $1 and $1::uuid is not null",
        newPart,
      )),
      ...(await idsOf(
        "select b.id from public.bars b where b.score_file_id = $1 and $1::uuid is not null",
        newPart,
      )),
    ];
    expect(copyIds).toHaveLength(masterIds.length);
    expect(new Set([...masterIds, ...copyIds]).size).toBe(masterIds.length * 2);

    // The paths: the new owner and piece in place of the master's, the rest of each path as it was
    const prefix = `${U1}/${NEW}/`;
    expect(
      (
        await one<{ p: string }>(
          "select storage_path as p from public.score_files where piece_id = $1",
          [NEW],
        )
      ).p,
    ).toBe(`${prefix}score.pdf`);
    expect(
      (
        await q<{ p: string }>(
          "select image_path as p from public.score_pages where score_file_id = $1 order by page_index",
          [newPart],
        )
      ).map((r) => r.p),
    ).toEqual([`${prefix}${PART}/page-0.webp`, `${prefix}${PART}/page-1.webp`]);
    expect(
      await one(
        "select url_or_path, stored_path from public.audio_sources where piece_id = $1",
        [NEW],
      ),
    ).toEqual({
      url_or_path: `${prefix}recording.mp3`,
      stored_path: `${prefix}audio.m4a`,
    });

    // What the processor must copy inside Storage: the five files, each once
    expect(
      [...result.files].sort((a, b) => a.from.localeCompare(b.from)),
    ).toEqual(
      Object.values(MASTER_PATHS)
        .sort()
        .map((from) => ({
          from,
          to: `${prefix}${from.slice(`${ADMIN}/${MASTER}/`.length)}`,
        })),
    );

    // Left behind
    for (const table of [
      "jobs",
      "piece_members",
      "piece_shares",
      "piece_practice",
    ]) {
      expect(
        (
          await one<{ n: number }>(
            `select count(*)::int as n from public.${table} where piece_id = $1`,
            [NEW],
          )
        ).n,
      ).toBe(0);
    }
    // And the master is as it was
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from public.locators where piece_id = $1",
          [MASTER],
        )
      ).n,
    ).toBe(3);
    expect(
      await one(
        "select sample_given_at is not null as given, sample_given from public.profiles where id = $1",
        [U1],
      ),
    ).toEqual({ given: true, sample_given: true });
  });

  it("leaves a YouTube link alone: it is a URL and not a path", async () => {
    await db.exec(
      `update public.audio_sources set kind = 'youtube', url_or_path = 'https://youtu.be/abc', stored_path = null where piece_id = '${MASTER}'`,
    );
    await setMaster();
    const result = await copy();
    expect(
      (
        await one<{ u: string }>(
          "select url_or_path as u from public.audio_sources where piece_id = $1",
          [NEW],
        )
      ).u,
    ).toBe("https://youtu.be/abc");
    expect(result.files).toHaveLength(3);
  });

  it("counts as created and as stored for the user, and stays out of the daily cap of the plan", async () => {
    await setMaster();
    await copy();
    expect((await myPlan(U1)).usage).toMatchObject({
      pieces_created: 1,
      pieces_stored: 1,
      new_pieces_today_on_plan: 0,
    });
    expect(
      await q(
        "select kind, plan_id, is_sample from public.usage_events where piece_id = $1",
        [NEW],
      ),
    ).toEqual([{ kind: "piece_created", plan_id: "trial", is_sample: true }]);
    // An ordinary piece made afterwards is counted in the cap as before.
    await asUser(
      db,
      U1,
      `insert into public.pieces (id, title) values ($1, 'Mine')`,
      [ORDINARY],
    );
    expect((await myPlan(U1)).usage).toMatchObject({
      pieces_created: 2,
      pieces_stored: 2,
      new_pieces_today_on_plan: 1,
    });
  });

  it("is left out of the plan counts of the admin hub too", async () => {
    await setMaster();
    await copy();
    const overview = async () =>
      (
        await asUser<{
          o: { plans: { id: string; new_pieces_today: number }[] };
        }>(db, ADMIN, "select public.admin_overview() as o")
      )[0]!.o.plans.find((plan) => plan.id === "trial")!;
    expect((await overview()).new_pieces_today).toBe(0);
    await asUser(
      db,
      U1,
      `insert into public.pieces (id, title) values ($1, 'Mine')`,
      [ORDINARY],
    );
    expect((await overview()).new_pieces_today).toBe(1);
  });

  it("refuses a second copy for the same account, and adds nothing", async () => {
    await setMaster();
    await copy();
    await expect(copy(U1, NEW2)).rejects.toThrow(/sample:already/);
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from public.pieces where owner_id = $1",
          [U1],
        )
      ).n,
    ).toBe(1);
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from public.usage_events where user_id = $1",
          [U1],
        )
      ).n,
    ).toBe(1);
  });

  it("refuses when there is no master, and marks nothing", async () => {
    await expect(copy()).rejects.toThrow(/sample:no_master/);
    expect((await stateOf(U1)).given_at).toBeNull();
    // A row whose master was deleted is no master either.
    await setMaster();
    await db.exec(`delete from public.pieces where id = '${MASTER}'`);
    await expect(copy()).rejects.toThrow(/sample:no_master/);
  });

  it("refuses a master whose path is not under its own owner and piece, and rolls everything back", async () => {
    await setMaster();
    await db.exec(
      `update public.score_pages set image_path = '${STRANGER}/${MASTER}/x.webp' where score_file_id = '${PART}' and page_index = 1`,
    );
    await expect(copy()).rejects.toThrow(/sample:path_outside/);
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from public.pieces where owner_id = $1",
          [U1],
        )
      ).n,
    ).toBe(0);
    expect((await stateOf(U1)).given_at).toBeNull();
  });

  it("is told, in this test, every column of the tables it copies, so a new column makes someone decide whether it is copied", async () => {
    const columns = async (table: string) =>
      (
        await q<{ c: string }>(
          `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name`,
          [table],
        )
      ).map((r) => r.c);
    expect(await columns("pieces")).toEqual([
      "count_in_bars",
      "created_at",
      "id",
      "last_part_id",
      "owner_id",
      "practice",
      "sample_credits",
      "sample_of",
      "structure_set_at",
      "title",
    ]);
    expect(await columns("score_files")).toEqual([
      "box_check",
      "box_flags",
      "id",
      "name",
      "name_source",
      "page_count",
      "piece_id",
      "position",
      "rests",
      "sha256",
      "storage_path",
    ]);
    expect(await columns("score_pages")).toEqual([
      "height",
      "id",
      "image_path",
      "page_index",
      "score_file_id",
      "width",
    ]);
    expect(await columns("bars")).toEqual([
      "bar_number",
      "h",
      "id",
      "page_index",
      "score_file_id",
      "time_sig",
      "w",
      "x",
      "y",
    ]);
    expect(await columns("audio_sources")).toEqual([
      "duration",
      "id",
      "kind",
      "name",
      "piece_id",
      "stored_path",
      "url_or_path",
    ]);
    expect(await columns("play_order")).toEqual([
      "bar_count",
      "id",
      "marks",
      "meters",
      "piece_id",
      "rows",
      "short_bars",
    ]);
    expect(await columns("locators")).toEqual([
      "bar_number",
      "checked",
      "confirmed",
      "flags",
      "id",
      "pass_index",
      "piece_id",
      "time_sec",
    ]);
  });
});

describe("marking an account", () => {
  it("mark_sample(false) records that the account was skipped", async () => {
    await asService(db, "select public.service_mark_sample($1, false)", [FULL]);
    expect((await stateOf(FULL)).given_at).not.toBeNull();
    expect(
      await one("select sample_given from public.profiles where id = $1", [
        FULL,
      ]),
    ).toEqual({ sample_given: false });
  });

  it("unmark_sample clears both columns", async () => {
    await setMaster();
    await copy();
    await asService(db, "select public.service_unmark_sample($1)", [U1]);
    expect((await stateOf(U1)).given_at).toBeNull();
    expect(
      await one(
        "select sample_given_at, sample_given from public.profiles where id = $1",
        [U1],
      ),
    ).toEqual({ sample_given_at: null, sample_given: null });
  });
});

describe("what the signed-in user sees", () => {
  it("reads sample_of and sample_given_at, and cannot write sample_of, on update or on insert", async () => {
    await setMaster();
    await copy();
    expect(
      await asUser(
        db,
        U1,
        "select sample_of from public.pieces where id = $1",
        [NEW],
      ),
    ).toEqual([{ sample_of: MASTER }]);
    expect(
      await asUser(
        db,
        U1,
        "select sample_given_at is not null as given from public.profiles where id = $1",
        [U1],
      ),
    ).toEqual([{ given: true }]);
    await expect(
      asUser(
        db,
        U1,
        "update public.pieces set sample_of = null where id = $1",
        [NEW],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        db,
        U1,
        "update public.pieces set sample_credits = '[]' where id = $1",
        [NEW],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        db,
        U1,
        `insert into public.pieces (id, title, sample_credits) values ($1, 'Fake', '[]')`,
        [NEW2],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        db,
        U1,
        `insert into public.pieces (id, title, sample_of) values ($1, 'Fake', $2)`,
        [NEW2, MASTER],
      ),
    ).rejects.toThrow(/permission denied/);
    await asUser(
      db,
      U1,
      `insert into public.pieces (id, title) values ($1, 'Mine')`,
      [ORDINARY],
    );
    await expect(
      asUser(db, U1, "update public.pieces set sample_of = $2 where id = $1", [
        ORDINARY,
        MASTER,
      ]),
    ).rejects.toThrow(/permission denied/);
    // Writing the value it already has changes nothing, so it is not refused.
    await asUser(
      db,
      U1,
      "update public.pieces set sample_of = $2, title = $3 where id = $1",
      [NEW, MASTER, "Renamed"],
    );
    await expect(
      asUser(
        db,
        U1,
        "update public.profiles set sample_given_at = null where id = $1",
        [U1],
      ),
    ).rejects.toThrow(/permission denied/);
    expect(
      await asUser(
        db,
        U1,
        "select sample_of from public.pieces where id = $1",
        [NEW],
      ),
    ).toEqual([{ sample_of: MASTER }]);
  });

  it("still writes every other column of a piece, as before, and can insert a piece", async () => {
    await setMaster();
    await copy();
    const part = (
      await one<{ id: string }>(
        "select id from public.score_files where piece_id = $1",
        [NEW],
      )
    ).id;
    await asUser(
      db,
      U1,
      `update public.pieces set title = 'Mine', count_in_bars = 0, practice = '{"speed":1}', last_part_id = $2, structure_set_at = now() where id = $1`,
      [NEW, part],
    );
    expect(
      await asUser(
        db,
        U1,
        "select title, count_in_bars from public.pieces where id = $1",
        [NEW],
      ),
    ).toEqual([{ title: "Mine", count_in_bars: 0 }]);
    await asUser(
      db,
      U1,
      `insert into public.pieces (id, title, count_in_bars, practice) values ($1, 'Another', 3, '{}')`,
      [ORDINARY],
    );
  });

  it("leaves a copy standing, and unlinked, when the master is deleted", async () => {
    await setMaster();
    await copy();
    // The admin deletes it in the app: the update the foreign key makes on other people's pieces is not refused by the trigger.
    await asUser(db, ADMIN, "delete from public.pieces where id = $1", [
      MASTER,
    ]);
    expect(
      await one("select master_piece_id from public.sample_piece"),
    ).toEqual({ master_piece_id: null });
    expect(
      await one("select sample_of, title from public.pieces where id = $1", [
        NEW,
      ]),
    ).toEqual({ sample_of: null, title: "Gondola Song" });
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from public.score_files where piece_id = $1",
          [NEW],
        )
      ).n,
    ).toBe(1);
  });

  it("clear removes the master, so no copy is made after it, and the copies stay", async () => {
    await setMaster();
    await copy();
    await asService(db, "select public.service_clear_sample_piece()");
    expect((await stateOf(FULL)).has_master).toBe(false);
    await expect(copy(STRANGER, NEW2)).rejects.toThrow(/sample:no_master/);
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from public.pieces where id = $1",
          [NEW],
        )
      ).n,
    ).toBe(1);
  });

  it("setting the master again replaces the first, and takes the new credits", async () => {
    await setMaster();
    await asService(
      db,
      `select public.service_set_sample_piece($1, '[]'::jsonb)`,
      [MASTER],
    );
    expect(
      await q("select master_piece_id, credits from public.sample_piece"),
    ).toEqual([{ master_piece_id: MASTER, credits: [] }]);
    await expect(
      asService(db, `select public.service_set_sample_piece($1, '{}'::jsonb)`, [
        MASTER,
      ]),
    ).rejects.toThrow(/check/);
  });
});

describe("sample_credits", () => {
  const credits = (user: string, piece: string) =>
    asUser<{ c: unknown }>(db, user, "select public.sample_credits($1) as c", [
      piece,
    ]).then((rows) => rows[0]!.c);

  it("gives a copy's own credits to a user who can read it, nothing to a stranger, nothing for an ordinary piece", async () => {
    await setMaster();
    await copy();
    await asUser(
      db,
      U1,
      `insert into public.pieces (id, title) values ($1, 'Mine')`,
      [ORDINARY],
    );
    expect(await credits(U1, NEW)).toEqual(CREDITS);
    expect(await credits(STRANGER, NEW)).toBeNull();
    expect(await credits(U1, ORDINARY)).toBeNull();
    expect(await credits(U1, MASTER)).toBeNull();
  });

  it("still gives them after the master is deleted", async () => {
    await setMaster();
    await copy();
    await asUser(db, ADMIN, "delete from public.pieces where id = $1", [
      MASTER,
    ]);
    expect(await credits(U1, NEW)).toEqual(CREDITS);
  });

  it("still gives them after the sample is cleared", async () => {
    await setMaster();
    await copy();
    await asService(db, "select public.service_clear_sample_piece()");
    expect(await credits(U1, NEW)).toEqual(CREDITS);
  });

  it("keeps each copy's own credits when another master is set: the old copy its first, a new copy the new", async () => {
    await setMaster();
    await copy();
    await db.query(
      `insert into public.pieces (id, owner_id, title) values ($1, $2, 'Moonlight')`,
      [MASTER2, ADMIN],
    );
    await asService(
      db,
      "select public.service_set_sample_piece($1, $2::jsonb)",
      [MASTER2, JSON.stringify(CREDITS2)],
    );
    await copy(STRANGER, NEW2);
    expect(await credits(U1, NEW)).toEqual(CREDITS);
    expect(await credits(STRANGER, NEW2)).toEqual(CREDITS2);
  });

  it("is refused to anon", async () => {
    await db.exec("set role anon");
    try {
      await expect(
        db.query("select public.sample_credits($1)", [NEW]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
