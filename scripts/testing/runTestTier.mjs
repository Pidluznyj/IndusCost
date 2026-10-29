// Testes proporcionais ao impacto (política em CLAUDE.md › Testes).
//
//   npm run test:quick          testes alterados + os do mesmo módulo dos arquivos alterados (segundos)
//   npm run test:affected       todo teste que importa, direta ou transitivamente, um arquivo alterado
//   npm run test:critical       deploy/executor, segurança, permissões e autenticação
//   npm run test:deploy-safety  executor de deploy, hooks e isolamento do gate (só simulados)
//   npm run test:full           todos os testes do repositório que não exigem PostgreSQL real
//   npm run test:pg17           integrações com PostgreSQL 17 real — SÓ na homologação (servidor-01), com
//                               INDUSCOST_REAL_PG_TESTS=1 e COMMISSION_PG17_BIN; recusa (2) sem as duas
//
// Opções: --base=<ref> (quick/affected; padrão origin/main), --list (só mostra a seleção).
// Fora do test:pg17, nenhum teste inicia PostgreSQL, cria banco ou conecta a servidor: o runner remove a opção
// explícita (INDUSCOST_REAL_PG_TESTS), COMMISSION_PG17_BIN e toda variável IDS_*/PG* do ambiente dos testes.
// Resumo no console (comando, abrangência e motivo, duração, testes, aprovados, reprovados, ignorados); saída
// completa em arquivo. Código de saída ≠ 0 se algum teste falhar.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const tier = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `=${fallback}`).split("=").slice(1).join("=");
const listOnly = args.includes("--list");
const TIERS = ["quick", "affected", "critical", "deploy-safety", "full", "pg17"];
if (!TIERS.includes(tier)) {
  console.error(`uso: node scripts/testing/runTestTier.mjs <${TIERS.join("|")}> [--base=<ref>] [--list]`);
  process.exit(2);
}

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const posixRel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const isTest = (f) => /\.test\.(ts|tsx|mts)$/.test(f);
// Exigem PostgreSQL real (cluster descartável do harness): só no test:pg17, na homologação.
const isRealPg = (f) => /\.pg17\.|Postgres[A-Za-z]*\.integration\.test\./.test(f);
const tracked = git("ls-files").concat(git("ls-files", "--others", "--exclude-standard"));
const allTests = tracked.filter((f) => isTest(f) && !f.includes("node_modules/") && existsSync(join(ROOT, f)));

function changedFiles(base) {
  const files = new Set([
    ...git("diff", "--name-only", `${base}...HEAD`),
    ...git("diff", "--name-only", "HEAD"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]);
  return [...files].filter((f) => existsSync(join(ROOT, f)));
}

// Grafo de imports (relativos e "@/…") para a seleção por impacto.
function reverseImportGraph() {
  const sources = tracked.filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f) && (f.startsWith("src/") || f.startsWith("scripts/") || f === "server.ts"));
  const exts = ["", ".ts", ".tsx", ".mts", ".mjs", "/index.ts", "/index.tsx"];
  const resolveImport = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = join(ROOT, dirname(from), spec);
    else return null;
    const noJs = base.replace(/\.js$/, "");
    for (const e of exts) {
      const p = `${noJs}${e}`;
      if (existsSync(p) && statSync(p).isFile()) return posixRel(p);
    }
    return null;
  };
  const rev = new Map();
  for (const f of sources) {
    let text;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)) {
      const target = resolveImport(f, m[1] ?? m[2] ?? m[3]);
      if (!target) continue;
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target).add(f);
    }
  }
  return rev;
}

const DEPLOY_SAFETY = allTests.filter((f) => /^src\/lib\/ops\/.*\.test\.ts$/.test(f) || f === "src/lib/testSafeLockPath.test.ts");
let selection = [];
let reason = "";
const base = opt("base", "origin/main");
if (tier === "quick" || tier === "affected") {
  const changed = changedFiles(base);
  const changedTests = changed.filter(isTest);
  const changedSources = changed.filter((f) => !isTest(f) && /\.(ts|tsx|mts|mjs)$/.test(f));
  const deployInfra = changed.some((f) => f.startsWith("infra/deploy/") || f.startsWith("scripts/ops/"));
  const picked = new Set(changedTests);
  if (tier === "quick") {
    // Mesmo módulo: <arquivo>.test.ts(x) e <arquivo>.*.test.ts ao lado do fonte alterado.
    for (const src of changedSources) {
      const stem = src.replace(/\.(ts|tsx|mts|mjs)$/, "");
      for (const t of allTests) if (t.startsWith(`${stem}.`) || t.startsWith(`${stem}/`)) picked.add(t);
    }
    reason = `quick: ${changed.length} arquivo(s) alterado(s) desde ${base}; testes alterados (${changedTests.length}) + testes do mesmo módulo dos fontes alterados`;
  } else {
    const rev = reverseImportGraph();
    const seen = new Set(changedSources);
    const queue = [...changedSources];
    while (queue.length) {
      const f = queue.shift();
      for (const dep of rev.get(f) ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        queue.push(dep);
      }
    }
    for (const f of seen) if (isTest(f)) picked.add(f);
    reason = `affected: ${changed.length} arquivo(s) alterado(s) desde ${base}; ${changedSources.length} fonte(s) expandido(s) pelo grafo de imports até ${seen.size} arquivo(s) dependente(s)`;
  }
  if (deployInfra) {
    for (const t of DEPLOY_SAFETY) picked.add(t);
    reason += "; infra de deploy alterada → testes do executor incluídos";
  }
  selection = [...picked].filter((f) => existsSync(join(ROOT, f)));
} else if (tier === "deploy-safety") {
  selection = DEPLOY_SAFETY;
  reason = "deploy-safety: executor, biblioteca, instalador, hooks e isolamento do gate (só simulados)";
} else if (tier === "critical") {
  selection = [...new Set([...DEPLOY_SAFETY, ...allTests.filter((f) => /^src\/lib\/(security|auth)\//.test(f) || /[Pp]ermission/.test(f))])];
  reason = "critical: deploy/executor + segurança, autenticação e permissões";
} else if (tier === "full") {
  selection = allTests;
  reason = "full: todos os testes do repositório que não exigem PostgreSQL real (esses: test:pg17, na homologação)";
} else {
  selection = allTests.filter(isRealPg);
  reason = "pg17: integrações com PostgreSQL 17 real (cluster descartável do harness; nunca o banco da aplicação)";
}
if (tier !== "pg17") selection = selection.filter((f) => !isRealPg(f));
selection.sort();

if (tier === "pg17") {
  const optIn = process.env.INDUSCOST_REAL_PG_TESTS === "1";
  const bin = process.env.COMMISSION_PG17_BIN?.trim();
  if (!optIn || !bin) {
    console.error("[testes] RECUSADO: test:pg17 só roda na homologação (servidor-01), com INDUSCOST_REAL_PG_TESTS=1 e COMMISSION_PG17_BIN=<bin do PostgreSQL 17>.");
    console.error("[testes] Localmente use test:quick / test:affected / test:deploy-safety / test:full (sem banco real).");
    process.exit(2);
  }
}

console.log(`[testes] comando: npm run test:${tier}${args.filter((a) => a.startsWith("--")).map((a) => ` ${a}`).join("")}`);
console.log(`[testes] abrangência: ${reason}`);
console.log(`[testes] arquivos: ${selection.length}`);
if (listOnly || selection.length === 0) {
  for (const f of selection) console.log(`  ${f}`);
  if (selection.length === 0) console.log("[testes] nada a executar para esta abrangência.");
  process.exit(0);
}

// Ambiente dos testes: fora do test:pg17, nada que permita alcançar um PostgreSQL real.
const env = { ...process.env, TZ: process.env.TZ ?? "UTC" };
if (tier !== "pg17") {
  for (const key of Object.keys(env)) if (/^(IDS_|PG)/.test(key)) delete env[key];
  delete env.INDUSCOST_REAL_PG_TESTS;
  delete env.COMMISSION_PG17_BIN;
}
delete env.NODE_TEST_CONTEXT;

const logDir = mkdtempSync(join(tmpdir(), `induscost-test-${tier}-`));
const logFile = join(logDir, "saida.log");
let out = "";
const started = Date.now();
const BATCH = 120; // limite de linha de comando do Windows
const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
let worst = 0;
for (let i = 0; i < selection.length; i += BATCH) {
  const batch = selection.slice(i, i + BATCH);
  const testArgs = ["--import", "tsx", "--test", ...(tier === "pg17" ? ["--test-concurrency=1"] : []), ...batch];
  const code = await new Promise((res) => {
    const child = spawn(process.execPath, testArgs, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let chunk = "";
    child.stdout.on("data", (d) => (chunk += d));
    child.stderr.on("data", (d) => (chunk += d));
    child.on("close", (c) => {
      out += chunk;
      for (const k of Object.keys(totals)) totals[k] += Number((chunk.match(new RegExp(`^ℹ ${k} (\\d+)`, "m")) ?? [])[1] ?? 0);
      for (const m of chunk.matchAll(/^\s*✖ (.+?) \(\d+(?:\.\d+)?ms\)$/gm)) console.log(`   ✖ ${m[1]}`);
      res(c ?? 1);
    });
  });
  if (code !== 0) worst = code;
}
writeFileSync(logFile, out);
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`[testes] duração: ${secs} s · testes: ${totals.tests} · aprovados: ${totals.pass} · reprovados: ${totals.fail} · ignorados: ${totals.skipped}${totals.cancelled ? ` · cancelados: ${totals.cancelled}` : ""}`);
console.log(`[testes] saída completa: ${logFile}`);
const failed = worst !== 0 || totals.fail > 0 || totals.cancelled > 0;
console.log(failed ? "[testes] RESULTADO: FALHA" : "[testes] RESULTADO: OK");
process.exit(failed ? worst || 1 : 0);
