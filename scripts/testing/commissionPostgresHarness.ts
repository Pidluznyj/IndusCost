/**
 * PostgreSQL efêmero para os testes de integração de comissões (N:N, B1–B5).
 *
 * Motor: PGlite (PostgreSQL 18 compilado para WASM, em memória, no próprio processo)
 * exposto pelo protocolo do Postgres via pglite-socket numa porta de 127.0.0.1 — o
 * Prisma Client do projeto conecta como num PostgreSQL normal (constraints, enums,
 * arrays, índices parciais, triggers e transações reais). Nada é gravado em disco e
 * nada sai da máquina.
 *
 * Não é dependência do projeto: aponte COMMISSION_PG_HARNESS_MODULES para um
 * node_modules que contenha @electric-sql/pglite e @electric-sql/pglite-socket
 * (ex.: `npm i --prefix <dir> @electric-sql/pglite@0.5.11 @electric-sql/pglite-socket@0.2.14`).
 * Sem a variável, os testes de integração são pulados (e dizem por quê).
 *
 * Banco = SQL gerado do schema.prisma (`prisma migrate diff --from-empty`) + objetos
 * que só existem nas migrations (índices parciais, DROP INDEX, funções e triggers),
 * aplicados na ordem das migrations — o estado final que o deploy produz.
 *
 * Isolamento conferido antes de devolver o cliente: host loopback, motor PGlite,
 * URL diferente de DATABASE_URL do ambiente e marcador único lido pelo Prisma.
 *
 * Alternativa multi-conexão: `startCommissionPostgres17` sobe um servidor PostgreSQL 17
 * real e descartável (COMMISSION_PG17_BIN = diretório bin com initdb/pg_ctl), para
 * concorrência entre processos, locks, triggers e desempenho com pool de conexões.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type CommissionTestDatabase = {
  url: string;
  validation: {
    host: string;
    port: number;
    database: string;
    user: string;
    engine: string;
    marker: string;
    envDatabaseUrlDiffers: boolean;
  };
  /** Executa SQL direto no banco efêmero (inspeção e testes de constraint). */
  exec: (sql: string) => Promise<void>;
  query: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
  stop: () => Promise<void>;
};

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..", "..");

export function commissionPgHarnessModulesDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env.COMMISSION_PG_HARNESS_MODULES?.trim();
  if (!dir) return null;
  const base = existsSync(join(dir, "node_modules")) ? join(dir, "node_modules") : dir;
  return existsSync(join(base, "@electric-sql", "pglite")) && existsSync(join(base, "@electric-sql", "pglite-socket"))
    ? base
    : null;
}

function runAsync(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolveRun({ stdout, stderr, code }));
  });
}

/** SQL de um schema.prisma (padrão: o atual), sem banco (mesmo comando do fluxo offline do repo). */
export async function generateSchemaSql(schemaPath = join(REPO_ROOT, "prisma/schema.prisma")): Promise<string> {
  const result = await runAsync(
    process.execPath,
    [join(REPO_ROOT, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPath, "--script"],
    { ...process.env, DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline_schema_only" }
  );
  if (result.code !== 0) throw new Error(`prisma migrate diff falhou: ${result.stderr.slice(0, 500)}`);
  return result.stdout;
}

/**
 * Objetos de banco que só as migrations criam: índices parciais/expressões, DROP INDEX
 * e funções/triggers (blocos $$), na ordem das migrations.
 */
export function migrationOnlyStatements(
  migrationsDir = join(REPO_ROOT, "prisma/migrations"),
  include: (migrationName: string) => boolean = () => true
): string[] {
  const out: string[] = [];
  // DROP INDEX só é reproduzido para índice parcial criado por migration anterior
  // (os índices comuns já vêm no estado final gerado do schema.prisma).
  const partialNames = new Set<string>();
  const indexName = (stmt: string) => /INDEX\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([\w]+)"?/i.exec(stmt)?.[1] ?? null;
  for (const dir of readdirSync(migrationsDir).sort()) {
    if (!include(dir)) continue;
    const file = join(migrationsDir, dir, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
    // Blocos de função ($$ … $$ LANGUAGE …;) primeiro, preservando a ordem do arquivo.
    const pieces: string[] = [];
    let rest = sql;
    // Corpo entre $tag$ … $tag$, com LANGUAGE antes ou depois do corpo.
    const fnRe = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[\s\S]*?(\$\w*\$)[\s\S]*?\2(\s*LANGUAGE\s+\w+)?\s*;/i;
    for (;;) {
      const match = fnRe.exec(rest);
      if (!match) break;
      pieces.push(...rest.slice(0, match.index).split(";"));
      pieces.push(`__FN__${match[0]}`);
      rest = rest.slice(match.index + match[0].length);
    }
    pieces.push(...rest.split(";"));
    for (const raw of pieces) {
      if (raw.startsWith("__FN__")) {
        out.push(raw.slice(6));
        continue;
      }
      const stmt = raw.trim();
      if (!stmt) continue;
      if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt) && /\bWHERE\b/i.test(stmt)) {
        const name = indexName(stmt);
        if (name) partialNames.add(name);
        out.push(stmt.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?/i, (_m, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS `));
      } else if (/^DROP\s+INDEX/i.test(stmt)) {
        const name = indexName(stmt);
        if (name && partialNames.has(name)) out.push(`DROP INDEX IF EXISTS "${name}"`);
      } else if (/^CREATE\s+TRIGGER/i.test(stmt)) {
        out.push(stmt);
      }
    }
  }
  return out;
}

export async function startCommissionTestDatabase(modulesDir: string): Promise<CommissionTestDatabase> {
  const pglite = (await import(pathToFileURL(join(modulesDir, "@electric-sql/pglite/dist/index.js")).href)) as {
    PGlite: { create: () => Promise<{ exec: (sql: string) => Promise<unknown>; query: (sql: string) => Promise<{ rows: unknown[] }>; close: () => Promise<void> }> };
  };
  const socket = (await import(pathToFileURL(join(modulesDir, "@electric-sql/pglite-socket/dist/index.js")).href)) as {
    PGLiteSocketServer: new (options: { db: unknown; port: number; host: string }) => {
      start: () => Promise<void>;
      stop: () => Promise<void>;
      server?: { address?: () => { port: number } | string | null };
      port?: number;
    };
  };
  const db = await pglite.PGlite.create();
  await db.exec(await generateSchemaSql());
  for (const stmt of migrationOnlyStatements()) await db.exec(stmt);

  const marker = randomUUID();
  await db.exec(`CREATE TABLE "__induscost_test_marker" (token text primary key); INSERT INTO "__induscost_test_marker" VALUES ('${marker}');`);
  const server = new socket.PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await server.start();
  const address = server.server?.address?.() ?? null;
  const port = typeof address === "object" && address ? address.port : server.port;
  if (!port) throw new Error("porta do banco efêmero não identificada");
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&sslmode=disable&pool_timeout=120`;
  const parsed = new URL(url);
  const engine = String(((await db.query("select version() as v")).rows[0] as { v: string }).v);
  const validation = {
    host: parsed.hostname,
    port: Number(parsed.port),
    database: parsed.pathname.slice(1),
    user: parsed.username,
    engine,
    marker,
    envDatabaseUrlDiffers: process.env.DATABASE_URL !== url,
  };
  if (validation.host !== "127.0.0.1") throw new Error("banco de teste fora do loopback");
  if (!/PGlite/.test(engine)) throw new Error("motor do banco de teste não é o PGlite em memória");
  if (!validation.envDatabaseUrlDiffers) throw new Error("URL de teste coincide com DATABASE_URL do ambiente");
  return {
    url,
    validation,
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: async <T>(sql: string) => (await db.query(sql)).rows as T[],
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}

/* ------------------------------------------------------------------------- */
/* PostgreSQL 17 servidor real (multi-conexão)                               */
/* ------------------------------------------------------------------------- */

/**
 * Diretório `bin` de um PostgreSQL 17 local (initdb, pg_ctl, postgres). Ex.: os binários
 * do pacote npm `@embedded-postgres/windows-x64@17.x` instalados FORA do projeto.
 */
export function commissionPg17BinDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env.COMMISSION_PG17_BIN?.trim();
  if (!dir) return null;
  const exe = process.platform === "win32" ? ".exe" : "";
  return existsSync(join(dir, `initdb${exe}`)) && existsSync(join(dir, `pg_ctl${exe}`)) ? dir : null;
}

async function freeLoopbackPort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * `pg_ctl start` deixa o servidor herdando os descritores do processo: com pipes, o
 * evento "close" nunca chega. Sem stdio, espera só a saída do próprio pg_ctl (-w).
 */
function runDetached(cmd: string, args: string[], label: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${label} falhou (${code})`))));
  });
}

async function runChecked(cmd: string, args: string[], label: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const result = await runAsync(cmd, args, env);
  if (result.code !== 0) throw new Error(`${label} falhou (${result.code}): ${(result.stderr || result.stdout).slice(0, 800)}`);
  return result.stdout;
}

/** Executa um arquivo SQL com várias instruções pelo próprio Prisma CLI (sem psql). */
export async function executeSqlFile(url: string, file: string): Promise<void> {
  await runChecked(
    process.execPath,
    [join(REPO_ROOT, "node_modules/prisma/build/index.js"), "db", "execute", "--url", url, "--file", file],
    `prisma db execute ${file}`,
    { ...process.env, DATABASE_URL: url }
  );
}

export type CommissionPg17Database = CommissionTestDatabase & {
  /** URL com várias conexões (pool real) para testes de concorrência. */
  poolUrl: (connections: number) => string;
  dataDir: string;
};

/**
 * Sobe um PostgreSQL 17 descartável: `initdb` num diretório temporário, servidor só em
 * 127.0.0.1 numa porta livre, autenticação local `trust` com usuário de teste próprio.
 * `schema`:
 *   - "final" (padrão): estado final do schema.prisma + objetos só de migration (como o PGlite);
 *   - "none": banco vazio (o chamador aplica base + migrations, ex.: teste de deploy).
 * Isolamento conferido antes de devolver: loopback, versão 17, diretório criado agora,
 * URL ≠ DATABASE_URL do ambiente e marcador único gravado e lido pelo Prisma.
 */
export async function startCommissionPostgres17(
  binDir: string,
  options: { schema?: "final" | "none" } = {}
): Promise<CommissionPg17Database> {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const exe = process.platform === "win32" ? ".exe" : "";
  const dataDir = mkdtempSync(join(tmpdir(), "induscost-pg17-"));
  const pgData = join(dataDir, "data");
  const port = await freeLoopbackPort();
  const user = "induscost_test";
  await runChecked(join(binDir, `initdb${exe}`), ["-D", pgData, "-U", user, "-A", "trust", "-E", "UTF8", "--no-locale"], "initdb");
  await runDetached(
    join(binDir, `pg_ctl${exe}`),
    [
      "start",
      "-D",
      pgData,
      "-w",
      "-t",
      "60",
      "-l",
      join(dataDir, "server.log"),
      "-o",
      `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=60 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    ],
    "pg_ctl start"
  );
  const stopServer = async () => {
    await runDetached(join(binDir, `pg_ctl${exe}`), ["stop", "-D", pgData, "-m", "fast", "-w"], "pg_ctl stop").catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
  };
  const base = `postgresql://${user}@127.0.0.1:${port}/postgres`;
  const url = `${base}?connection_limit=1&sslmode=disable`;
  const poolUrl = (connections: number) => `${base}?connection_limit=${connections}&pool_timeout=120&sslmode=disable`;
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasourceUrl: poolUrl(2) });
  try {
    if ((options.schema ?? "final") === "final") {
      const file = join(dataDir, "schema.sql");
      const objects = migrationOnlyStatements().map((stmt) => `${stmt.trim().replace(/;$/, "")};`);
      writeFileSync(file, `${await generateSchemaSql()}\n${objects.join("\n")}\n`);
      await executeSqlFile(url, file);
    }
    const marker = randomUUID();
    await admin.$executeRawUnsafe(`CREATE TABLE "__induscost_test_marker" (token text primary key)`);
    await admin.$executeRawUnsafe(`INSERT INTO "__induscost_test_marker" VALUES ('${marker}')`);
    const engine = String(((await admin.$queryRawUnsafe(`select version() as v`)) as Array<{ v: string }>)[0]!.v);
    const parsed = new URL(url);
    const validation = {
      host: parsed.hostname,
      port: Number(parsed.port),
      database: parsed.pathname.slice(1),
      user: decodeURIComponent(parsed.username),
      engine,
      marker,
      envDatabaseUrlDiffers: process.env.DATABASE_URL !== url,
    };
    if (validation.host !== "127.0.0.1") throw new Error("banco de teste fora do loopback");
    if (!/^PostgreSQL 17\./.test(engine)) throw new Error(`banco de teste não é PostgreSQL 17: ${engine}`);
    if (!validation.envDatabaseUrlDiffers) throw new Error("URL de teste coincide com DATABASE_URL do ambiente");
    return {
      url,
      poolUrl,
      dataDir,
      validation,
      exec: async (sql) => {
        const file = join(dataDir, `exec-${randomUUID()}.sql`);
        writeFileSync(file, sql);
        await executeSqlFile(url, file);
      },
      query: async <T>(sql: string) => (await admin.$queryRawUnsafe(sql)) as T[],
      stop: async () => {
        await admin.$disconnect();
        await stopServer();
      },
    };
  } catch (error) {
    await admin.$disconnect().catch(() => undefined);
    await stopServer();
    throw error;
  }
}

/** Confere pelo cliente Prisma que a conexão é o banco efêmero (marcador único). */
export async function assertPrismaOnTestDatabase(
  prisma: { $queryRawUnsafe: (sql: string) => Promise<unknown> },
  marker: string
): Promise<void> {
  const rows = (await prisma.$queryRawUnsafe(`select token from "__induscost_test_marker"`)) as Array<{ token: string }>;
  if (rows[0]?.token !== marker) throw new Error("cliente Prisma não está no banco efêmero de teste");
}
