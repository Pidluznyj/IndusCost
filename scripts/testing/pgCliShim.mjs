#!/usr/bin/env node
// Substitutos de psql/createdb/pg_dump/pg_restore para TESTES da biblioteca de deploy num PostgreSQL 17
// real (scripts/testing/commissionPostgresHarness.ts). psql e createdb executam o SQL exatamente como a
// biblioteca envia (via Prisma). pg_dump/pg_restore são simulados: o "dump" registra a origem e o
// "restore" aplica PG_SHIM_RESTORE_SQL no banco de destino (conteúdo equivalente ao do banco de origem).
//   uso: node pgCliShim.mjs <psql|createdb|pg_dump|pg_restore> <argumentos do binário>
// Variáveis: PG_SHIM_URL (com {DB} no lugar do banco), PG_SHIM_REPO (raiz do repositório), PG_SHIM_CALLS
// (arquivo onde cada chamada é registrada), PG_SHIM_RESTORE_SQL.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const [tool, ...args] = process.argv.slice(2);
const repo = process.env.PG_SHIM_REPO;
const { PrismaClient } = createRequire(join(repo, "package.json"))("@prisma/client");
const urlFor = (db) => process.env.PG_SHIM_URL.replace("{DB}", encodeURIComponent(db));
if (process.env.PG_SHIM_CALLS) appendFileSync(process.env.PG_SHIM_CALLS, `${tool} ${args.join(" ")}\n`.replace(/\s+\n$/, "\n"));
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const longValue = (flag) => args.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
const fmt = (v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "t" : "f") : v instanceof Date ? v.toISOString() : String(v));

async function run(db, fn) {
  const prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  if (tool === "psql") {
    const db = valueOf("-d");
    const sql = valueOf("-Atc") ?? valueOf("-c");
    await run(db, async (prisma) => {
      if (/^\s*BEGIN;/i.test(sql)) {
        const statements = sql.replace(/^\s*BEGIN;/i, "").replace(/COMMIT;\s*$/i, "").split(";").map((s) => s.trim()).filter(Boolean);
        await prisma.$transaction(async (tx) => {
          for (const s of statements) await tx.$executeRawUnsafe(s);
        });
        return;
      }
      if (/^\s*(SELECT|WITH|SHOW)\b/i.test(sql)) {
        const rows = await prisma.$queryRawUnsafe(sql);
        for (const row of rows) process.stdout.write(`${Object.values(row).map(fmt).join("|")}\n`);
        return;
      }
      await prisma.$executeRawUnsafe(sql);
    });
  } else if (tool === "createdb") {
    const name = args[args.length - 1];
    const owner = valueOf("-O");
    const template = valueOf("-T");
    const encoding = valueOf("-E");
    const collate = longValue("--lc-collate");
    const ctype = longValue("--lc-ctype");
    const q = (s) => `"${s.replace(/"/g, '""')}"`;
    const parts = [`CREATE DATABASE ${q(name)}`];
    if (owner) parts.push(`OWNER ${q(owner)}`);
    if (template) parts.push(`TEMPLATE ${q(template)}`);
    if (encoding) parts.push(`ENCODING '${encoding}'`);
    if (collate) parts.push(`LC_COLLATE '${collate}'`);
    if (ctype) parts.push(`LC_CTYPE '${ctype}'`);
    await run("postgres", (prisma) => prisma.$executeRawUnsafe(parts.join(" ")));
  } else if (tool === "pg_dump") {
    writeFileSync(valueOf("-f"), `SHIM-DUMP ${valueOf("-d")}\n`);
  } else if (tool === "pg_restore") {
    if (args[0] === "-l") {
      const content = readFileSync(args[1], "utf8");
      if (!content.startsWith("SHIM-DUMP")) throw new Error("pg_restore: arquivo de dump inválido");
      process.stdout.write("1; 2615 1 TABLE public t owner\n");
    } else {
      const target = longValue("--dbname");
      const r = spawnSync(process.execPath, [join(repo, "node_modules/prisma/build/index.js"), "db", "execute", "--url", urlFor(target), "--file", process.env.PG_SHIM_RESTORE_SQL], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: urlFor(target) },
      });
      if (r.status !== 0) throw new Error(`pg_restore simulado falhou: ${(r.stderr || r.stdout).slice(0, 400)}`);
    }
  } else {
    throw new Error(`ferramenta não suportada: ${tool}`);
  }
} catch (error) {
  process.stderr.write(`${tool}: ${error.message.split("\n").filter(Boolean).slice(-1)[0]}\n`);
  process.exit(1);
}
