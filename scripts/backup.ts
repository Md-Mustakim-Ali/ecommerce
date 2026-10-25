/**
 * Database backup and restore.
 *
 * `pnpm db:backup` writes a compressed dump. `pnpm db:restore <file>` puts one
 * back into a database you name explicitly.
 *
 * The point of this file is the restore, not the backup. An untested backup is
 * a file of unknown value — the failure mode is always the same, and always
 * found on the worst possible day. `pnpm db:verify-backup` proves the loop by
 * dumping the real database, restoring it into a scratch one, and comparing
 * row counts table by table.
 *
 * Wraps pg_dump rather than reimplementing it. A hand-rolled dump gets foreign
 * key ordering, sequences, extensions or custom types wrong eventually, and
 * "eventually" means during a restore.
 */

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const BACKUP_DIR = "backups";
/** Older dumps are pruned. Enough history to notice corruption, not a hoard. */
const KEEP = 14;

/** The compose service, used when the client tools are not installed locally. */
const CONTAINER = process.env.PG_CONTAINER ?? "ecommerce-postgres";

/**
 * Where pg_dump and psql live.
 *
 * On a machine with the Postgres client tools installed, they are on PATH. On
 * one where Postgres only exists as a container — which is the setup this
 * repository ships — they are not, and a script that assumed otherwise would
 * be decorative: it would exist, be committed, and fail the first time anyone
 * actually needed a backup.
 *
 * Detected once. Everything downstream just calls `pg("pg_dump", args)`.
 */
const local = spawnSync(process.platform === "win32" ? "where" : "which", [
  "pg_dump",
]);
const useDocker = local.status !== 0;

function pgCommand(tool: string, args: string[]): [string, string[]] {
  if (!useDocker) return [tool, args];
  // -i so stdin is forwarded, which pg_restore needs to read a dump from the
  // host. No -t: there is no terminal here and allocating one corrupts binary
  // streams.
  return ["docker", ["exec", "-i", CONTAINER, tool, ...args]];
}

/**
 * Rewrites a host-facing URL for use inside the container.
 *
 * From the host the database is localhost:5432; from inside the container it
 * is also localhost:5432, but only because Postgres is the container. Left
 * alone, a URL naming a Docker-internal host would fail from the host and vice
 * versa, so it is normalised at the one point that knows which side it is on.
 */
function forContainer(url: string): string {
  if (!useDocker) return url;
  const parsed = new URL(url);
  parsed.hostname = "localhost";
  parsed.port = "5432";
  return parsed.toString();
}

function run(
  tool: string,
  args: string[],
  options: {
    stdout?: NodeJS.WritableStream;
    stdin?: NodeJS.ReadableStream;
  } = {},
): Promise<{ code: number; stderr: string }> {
  const [command, finalArgs] = pgCommand(tool, args);

  return new Promise((resolve, reject) => {
    const child = spawn(command, finalArgs, {
      stdio: [
        options.stdin ? "pipe" : "ignore",
        options.stdout ? "pipe" : "inherit",
        "pipe",
      ],
      shell: false,
    });

    if (options.stdin) options.stdin.pipe(child.stdin!);
    if (options.stdout) child.stdout?.pipe(options.stdout);

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

function requireUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return url;
}

/** ISO-ish and sortable, so `ls` orders by age without parsing anything. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function backup(): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${stamp()}.dump`);

  // Custom format (-Fc): compressed, and restorable selectively. Plain SQL is
  // readable but cannot be restored table-by-table when only one is wrong.
  //
  // Streamed to stdout and written on this side rather than passed --file. The
  // dump has to land on the host, and --file inside a container writes it into
  // the container.
  const out = createWriteStream(file);
  // Attached before the run is awaited, not after. The stream often closes
  // while pg_dump is still being reaped, and a listener added afterwards waits
  // for an event that has already fired — which hangs the script forever on a
  // backup that in fact succeeded.
  const flushed = new Promise<void>((resolve) =>
    out.on("close", () => resolve()),
  );

  const { code, stderr } = await run(
    "pg_dump",
    [
      forContainer(requireUrl()),
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ],
    { stdout: out },
  );
  await flushed;

  if (code !== 0) {
    throw new Error(`pg_dump failed (${code}).\n${stderr}`);
  }

  const { size } = await stat(file);
  console.log(`wrote ${file} — ${(size / 1024 / 1024).toFixed(2)} MB`);

  // An empty or near-empty dump usually means pg_dump connected to the wrong
  // database and succeeded. Better to fail loudly than to keep it.
  if (size < 4096) {
    throw new Error(
      `${file} is only ${size} bytes. That is not a database — check DATABASE_URL.`,
    );
  }

  await prune();
  return file;
}

async function prune() {
  const files = (await readdir(BACKUP_DIR))
    .filter((name) => name.endsWith(".dump"))
    .sort()
    .reverse();

  for (const name of files.slice(KEEP)) {
    await unlink(join(BACKUP_DIR, name));
    console.log(`pruned ${name}`);
  }
}

async function restore(file: string, target: string) {
  // Named explicitly, never defaulted. A restore command that falls back to
  // DATABASE_URL is one typo away from overwriting production with a week-old
  // copy of itself.
  if (!target) {
    throw new Error(
      "Pass the target database URL explicitly:\n  pnpm db:restore <file> <postgres://...>",
    );
  }

  // Fed over stdin for the same reason the dump is written over stdout: the
  // file is on the host and pg_restore may not be.
  const { code, stderr } = await run(
    "pg_restore",
    [
      `--dbname=${forContainer(target)}`,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
    ],
    { stdin: createReadStream(file) },
  );

  // pg_restore exits non-zero on warnings that are routine for a --clean run
  // against an empty database ("table does not exist, skipping"). Only real
  // errors matter.
  const realErrors = stderr
    .split("\n")
    .filter(
      (line) => line.includes("error:") && !line.includes("does not exist"),
    );

  if (code !== 0 && realErrors.length > 0) {
    throw new Error(`pg_restore failed.\n${realErrors.join("\n")}`);
  }

  console.log(`restored ${file}`);
}

/**
 * Proves the backup is restorable.
 *
 * Dumps the live database, restores it into a scratch database, and compares
 * row counts for every table. This is the whole reason the file exists: a
 * backup nobody has restored is a hypothesis.
 */
async function verify() {
  const source = requireUrl();
  const scratchName = `backup_verify_${Date.now()}`;
  const admin = new URL(source);
  const originalDb = admin.pathname.replace(/^\//, "");
  admin.pathname = "/postgres";

  const scratch = new URL(source);
  scratch.pathname = `/${scratchName}`;

  const psql = (db: string, sql: string) =>
    run("psql", [
      forContainer(db),
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      sql,
    ]);

  console.log(`source: ${originalDb}\nscratch: ${scratchName}\n`);

  const file = await backup();

  try {
    const created = await psql(
      admin.toString(),
      `create database "${scratchName}"`,
    );
    if (created.code !== 0) {
      throw new Error(`could not create scratch database.\n${created.stderr}`);
    }

    await restore(file, scratch.toString());

    // Exact counts, not pg_stat_user_tables.n_live_tup.
    //
    // n_live_tup is an estimate maintained by autovacuum, and on a database
    // that has not been analysed recently it reads zero for every table. The
    // first version of this compared those estimates and reported all 38
    // tables as mismatched against a restore that was in fact perfect — a
    // verification tool that cries wolf is worse than none, because the next
    // real failure gets waved through.
    //
    // query_to_xml runs a count per table from within one statement, so this
    // stays a single round trip.
    const countQuery = `
      select relname,
             (xpath('/row/c/text()', counted))[1]::text::bigint as rows
      from (
        select relname,
               query_to_xml(
                 format('select count(*) as c from %I.%I', schemaname, relname),
                 false, true, ''
               ) as counted
        from pg_stat_user_tables
      ) t
      order by relname`;

    const before = await capture(source, countQuery);
    const after = await capture(scratch.toString(), countQuery);

    let mismatches = 0;
    const beforeMap = new Map(before);
    for (const [table, count] of after) {
      const original = beforeMap.get(table);
      const ok = original === count;
      if (!ok) mismatches++;
      console.log(
        `${ok ? "  ok  " : " FAIL "} ${table.padEnd(30)} ${original ?? "—"} → ${count}`,
      );
    }

    const missing = [...beforeMap.keys()].filter(
      (table) => !after.some(([name]) => name === table),
    );
    for (const table of missing) {
      mismatches++;
      console.log(` FAIL  ${table.padEnd(30)} missing from the restore`);
    }

    console.log(
      mismatches === 0
        ? `\nthe backup restores cleanly — ${after.length} tables matched exactly`
        : `\n${mismatches} TABLE(S) DID NOT MATCH`,
    );
    process.exitCode = mismatches === 0 ? 0 : 1;
  } finally {
    // Always, even on failure. A scratch database left behind grows into a
    // disk-full incident a month later.
    await psql(admin.toString(), `drop database if exists "${scratchName}"`);
    console.log(`dropped ${scratchName}`);
  }
}

/** Runs a query and returns [name, count] pairs. */
function capture(db: string, sql: string): Promise<[string, number][]> {
  const [command, args] = pgCommand("psql", [
    forContainer(db),
    "-t",
    "-A",
    "-F",
    "|",
    "-c",
    sql,
  ]);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", reject);
    child.on("close", () => {
      resolve(
        out
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [name, count] = line.split("|");
            return [name, Number(count)] as [string, number];
          }),
      );
    });
  });
}

const [command, ...rest] = process.argv.slice(2);

const commands: Record<string, () => Promise<void>> = {
  async backup() {
    await backup();
  },
  async restore() {
    await restore(rest[0], rest[1]);
  },
  verify,
};

const chosen = commands[command ?? "backup"];
if (!chosen) {
  console.error(
    "Usage:\n  backup.ts backup\n  backup.ts restore <file> <target-url>\n  backup.ts verify",
  );
  process.exit(1);
}

chosen().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
