/**
 * Auditoria de efeitos colaterais da suíte de testes — o que cada arquivo de teste faria no servidor
 * onde o gate do deploy roda (/opt/induscost, ao lado do banco, dos locks e das credenciais reais).
 *
 *   COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx scripts/testing/sideEffectAudit/run.mts <saída> [--files=a.test.ts,b.test.ts]
 *
 * Cada arquivo roda isolado com:
 *   - DATABASE_URL de um PostgreSQL 17 descartável que registra TODA escrita (log_statement=mod) com o
 *     arquivo como application_name (sem COMMISSION_PG17_BIN o banco fica inalcançável e não é auditado);
 *   - credenciais Nomus falsas presentes, como no servidor;
 *   - preload que registra escrita fora do diretório temporário, processos filhos e rede externa (bloqueada).
 * Resultado em <saída>/report.json; saída ≠ 0 se algum arquivo escrever no banco, acessar rede externa ou
 * gravar fora do temporário (exceto o tmp/ gitignored do próprio projeto, que o teste deve limpar).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { commissionPg17BinDir, startCommissionPostgres17 } from "../commissionPostgresHarness.js";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OUT = resolve(process.argv[2] ?? join(ROOT, "tmp", "side-effect-audit"));
const filesArg = process.argv.find((a) => a.startsWith("--files="));
mkdirSync(join(OUT, "fx"), { recursive: true });
const PRELOAD = pathToFileURL(join(import.meta.dirname, "preload.mjs")).href;
const files = filesArg
  ? filesArg.slice(8).split(",").filter(Boolean)
  : execFileSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], { cwd: ROOT, encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
writeFileSync(join(OUT, "files.json"), JSON.stringify(files));

const bin = commissionPg17BinDir();
const db = bin ? await startCommissionPostgres17(bin) : null;
if (db) {
  await db.query(`ALTER SYSTEM SET log_statement = 'mod'`);
  await db.query(`ALTER SYSTEM SET log_line_prefix = '@@%a@@ '`);
  await db.query(`SELECT pg_reload_conf()`);
  // Controle positivo: uma escrita conhecida precisa aparecer no log com o application_name.
  const { PrismaClient } = createRequire(join(ROOT, "package.json"))("@prisma/client") as typeof import("@prisma/client");
  const probe = new PrismaClient({ datasourceUrl: `${db.url}&application_name=selfcheck` });
  await probe.$executeRawUnsafe(`UPDATE "NomusPurchaseOrder" SET "stage" = "stage" WHERE false`);
  await probe.$disconnect();
}
console.log(`[side-effects] ${files.length} arquivo(s); banco ${db ? "PostgreSQL 17 auditado" : "inalcançável (não auditado)"}`);

const results: Record<string, { code: number | null; ms: number }> = {};
const queue = files.map((file, i) => ({ file, i }));
let done = 0;
async function runOne(item: { file: string; i: number }) {
  const started = Date.now();
  await new Promise<void>((resolveRun) => {
    const child = spawn(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), "--test", item.file], {
      cwd: ROOT,
      env: {
        ...process.env,
        COMMISSION_PG17_BIN: "",
        CHECKPOINT_DISABLE: "1",
        TZ: "UTC",
        DATABASE_URL: db ? `${db.url}&application_name=t${item.i}` : "postgresql://offline:offline@127.0.0.1:1/side_effect_audit",
        NOMUS_BASE_URL: "https://nomus.audit.invalid/rest",
        NOMUS_TOKEN: "AUDIT-TOKEN-NAO-REAL",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim(),
        SIDE_EFFECT_AUDIT_DIR: join(OUT, "fx"),
        SIDE_EFFECT_AUDIT_FILE: item.file,
      },
      stdio: "ignore",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      results[item.file] = { code, ms: Date.now() - started };
      done += 1;
      if (done % 100 === 0) console.log(`[side-effects] ${done}/${files.length}`);
      resolveRun();
    });
  });
}
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) await runOne(queue.shift()!);
}));
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
let dbLog = "";
if (db) {
  const log = join(db.dataDir, "server.log");
  if (existsSync(log)) dbLog = readFileSync(log, "utf8");
  await db.stop();
  if (!/@@selfcheck@@/.test(dbLog)) {
    console.error("[side-effects] controle positivo do banco ausente no log: auditoria inválida.");
    process.exit(2);
  }
}

// Consolidação por arquivo.
type Finding = { db: Set<string>; network: Set<string>; fs: Set<string>; child: Set<string> };
const byFile = new Map<string, Finding>();
const add = (file: string, kind: keyof Finding, detail: string) => {
  if (!byFile.has(file)) byFile.set(file, { db: new Set(), network: new Set(), fs: new Set(), child: new Set() });
  byFile.get(file)![kind].add(detail);
};
for (const line of dbLog.split(/\r?\n/)) {
  const m = /@@t(\d+)@@ LOG:\s+(?:execute [^:]*:|statement:)\s*(.*)$/.exec(line);
  if (m) add(files[Number(m[1])]!, "db", m[2]!.replace(/\s+/g, " ").slice(0, 120));
}
for (const f of readdirSync(join(OUT, "fx"))) {
  for (const line of readFileSync(join(OUT, "fx", f), "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as { file: string; kind: string; detail: string };
    if (/checkpoint\.prisma\.io|checkpoint-nodejs/.test(r.detail)) continue;
    add(r.file, r.kind === "fs-write" ? "fs" : r.kind === "child-process" ? "child" : "network", r.detail);
  }
}
// Escritas no tmp/ gitignored do próprio projeto são aceitas (o teste remove o que gera).
const projectTmp = /^(tmp[\\/]|.*[\\/]tmp[\\/]diagnostic-bundles)/i;
const report = { files: files.length, timeouts: Object.entries(results).filter(([, v]) => v.code === null).map(([k]) => k), findings: {} as Record<string, unknown> };
let violations = 0;
for (const [file, v] of [...byFile.entries()].sort()) {
  const fsOutside = [...v.fs].filter((d) => !projectTmp.test(d.replace(/^\S+ /, "")));
  const bad = v.db.size + v.network.size + fsOutside.length;
  if (bad) violations += 1;
  report.findings[file] = { db: [...v.db], network: [...v.network], fsOutsideTmp: fsOutside, fsProjectTmp: [...v.fs].filter((d) => !fsOutside.includes(d)), child: [...v.child] };
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`[side-effects] arquivos com escrita no banco, rede externa ou escrita fora do temporário: ${violations}`);
for (const [file, f] of Object.entries(report.findings) as Array<[string, { db: string[]; network: string[]; fsOutsideTmp: string[] }]>) {
  if (f.db.length || f.network.length || f.fsOutsideTmp.length) console.log(`  ✖ ${file}: ${[...f.db, ...f.network, ...f.fsOutsideTmp].slice(0, 4).join(" | ")}`);
}
process.exit(violations || report.timeouts.length ? 1 : 0);
