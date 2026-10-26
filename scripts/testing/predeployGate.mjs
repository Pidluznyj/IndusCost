#!/usr/bin/env node
// Ensaio local do gate de testes do deploy (antes de cada push na main).
//
//   node scripts/testing/predeployGate.mjs --base=<commit em execução no servidor> [--target=HEAD]
//
// Executa os MESMOS arquivos de teste que o executor do servidor roda (alterados entre base e target),
// pelo MESMO caminho (ids_run_test_gate de infra/deploy/induscost-deploy-safety.sh), em duas passagens:
//   1. gate isolado (executor protegido): sem .env, banco inalcançável, locks temporários;
//   2. ambiente "de servidor" (executor antigo): flags de presença Nomus ligadas, credenciais falsas.
// Nas duas, outro processo segura os locks REAIS das rotinas Nomus (/tmp/induscost-nomus-*), como as
// sincronizações em execução no servidor. Saída 0 = pode publicar; ≠ 0 = o deploy falharia.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
// --root: checkout cujo código/testes serão exercitados (padrão: este repositório).
const ROOT = resolve(arg("root", resolve(import.meta.dirname, "..", "..")));
const LIB = resolve(import.meta.dirname, "..", "..", "infra/deploy/induscost-deploy-safety.sh");
const base = arg("base", null);
const target = arg("target", "HEAD");
if (!base) {
  console.error("Informe --base=<commit em execução no servidor> (ex.: saída de `git -C /opt/induscost log -1 --format=%H`).");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const files = git("diff", "--name-only", "--diff-filter=d", `${base}..${target}`, "--", "*.test.ts", "*.test.tsx")
  .split("\n")
  .filter(Boolean)
  .filter((f) => existsSync(join(ROOT, f)));
console.log(`[predeploy] base=${base} target=${target} arquivos de teste alterados: ${files.length}`);
if (files.length === 0) {
  console.log("[predeploy] nenhum teste alterado: o gate do servidor não executa testes.");
  process.exit(0);
}

function findBash() {
  if (process.platform !== "win32") return "bash";
  for (const c of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (existsSync(c)) return c;
  return null;
}
const BASH = findBash();
if (!BASH) {
  console.error("[predeploy] bash não encontrado.");
  process.exit(2);
}
const posix = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => `/${d.toLowerCase()}`) : p);

// Segura os locks reais como as rotinas do servidor (arquivo com PID vivo = lock ocupado).
const REAL_LOCKS = [
  "/tmp/induscost-nomus-sales-orders.lock",
  "/tmp/induscost-nomus-accounts-receivable.canonical.lock",
  "/tmp/induscost-nomus-accounts-payable.canonical.lock",
  "/tmp/induscost-nomus-purchase-orders.canonical.lock",
];
const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" });
const created = [];
for (const lock of REAL_LOCKS) {
  try {
    const fd = openSync(lock, "wx");
    // Mesmo formato do lock canônico (pid=…): PID vivo = ocupado, nunca recuperado como "stale".
    writeFileSync(fd, `pid=${holder.pid}\nname=predeploy-gate\nstartedAt=${new Date().toISOString()}\n`);
    closeSync(fd);
    created.push(lock);
  } catch {
    // Já existe (rotina real local ou execução anterior): continua ocupado, que é o cenário desejado.
  }
}
const cleanup = () => {
  for (const lock of created) rmSync(lock, { force: true });
  holder.kill();
};
process.on("exit", cleanup);

function pass(label, extraEnv) {
  const envFile = join(mkdtempSync(join(tmpdir(), "predeploy-env-")), ".env");
  // .env simulado do servidor: as chaves existem (com valores falsos) — o gate isolado precisa zerá-las.
  writeFileSync(envFile, "DATABASE_URL=postgresql://servidor:segredo@db.invalid:5432/teste_bi\nNOMUS_TOKEN=token-servidor\nNOMUS_BASE_URL=https://nomus.servidor.invalid/rest\n");
  const script = [
    `source "${posix(LIB)}"`,
    `cd "${posix(ROOT)}"`,
    extraEnv.isolated
      ? `IDS_ENV_FILE="${posix(envFile)}" IDS_TEST_RUNNER=node IDS_TEST_RUNNER_ARGS="${posix(join(ROOT, "node_modules/tsx/dist/cli.mjs"))} --test" ids_run_test_gate ${files.map((f) => `"${f}"`).join(" ")}`
      : `node "${posix(join(ROOT, "node_modules/tsx/dist/cli.mjs"))}" --test ${files.map((f) => `"${f}"`).join(" ")}`,
  ].join("\n");
  const started = Date.now();
  const r = spawnSync(BASH, ["-c", script], {
    cwd: ROOT,
    env: { ...process.env, TZ: "UTC", NODE_ENV: "production", ...(extraEnv.env ?? {}) },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const num = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) ?? [])[1] ?? NaN);
  const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  console.log(`[predeploy] ${label}: testes=${num("tests")} ok=${num("pass")} falhas=${num("fail")} (${Math.round((Date.now() - started) / 1000)} s)`);
  for (const f of failing.slice(0, 20)) console.log(`   ✖ ${f}`);
  return r.status === 0 && num("fail") === 0;
}

const ok1 = pass("1) gate isolado (executor protegido)", { isolated: true });
const ok2 = pass("2) ambiente de servidor (executor antigo, flags ligadas)", {
  isolated: false,
  env: {
    DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/predeploy_offline",
    NOMUS_BASE_URL: "https://nomus.servidor.invalid/rest",
    NOMUS_TOKEN: "token-servidor-falso",
    NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED: "1",
    NOMUS_OPS_EXCLUDE_MISSING_PURCHASE_ORDERS_ENABLED: "1",
    NOMUS_OPS_EXCLUDE_MISSING_AR_ENABLED: "1",
    NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED: "1",
  },
});
const ok = ok1 && ok2;
console.log(ok ? "[predeploy] RESULTADO: OK — o gate do servidor deve passar." : "[predeploy] RESULTADO: FALHA — não publicar.");
process.exit(ok ? 0 : 1);
