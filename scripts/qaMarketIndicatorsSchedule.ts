/**
 * QA estático + runtime — agenda oficial do Brent (Inteligência de Mercado).
 *
 * Uso: npx tsx scripts/qaMarketIndicatorsSchedule.ts
 *
 * Valida:
 *   1. Brent tem horários 07, 11, 14 e 16 (America/Sao_Paulo).
 *   2. Timezone `America/Sao_Paulo`.
 *   3. Rodagem em dias úteis (runsOnWeekdaysOnly=true; cron `1-5`).
 *   4. Rotina antiga do Brent NÃO ficou duplicada.
 *   5. PTAX preservou agenda 09:00 / 15:30.
 *   6. Enum Prisma tem os 4 novos slots.
 *   7. Migration criada com `ALTER TYPE ADD VALUE`.
 *   8. Documentação existe.
 *   9. Frontend não importa Prisma.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let failed = 0;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(root, rel));
}

function ok(id: string, msg: string) {
  console.log(`OK   ${id} — ${msg}`);
}

function fail(id: string, msg: string) {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
}

// ---------------------------------------------------------------------------
// 1) Estrutura de arquivos
// ---------------------------------------------------------------------------
function checkFilesPresent() {
  for (const rel of [
    "src/lib/brentCommodityJob.ts",
    "src/lib/ptaxSnapshotJob.ts",
    "src/lib/brentCommodityCollection.ts",
    "src/lib/brentCommodityRoutes.ts",
    "docs/market/brent-update-schedule.md",
    "tmp-audits/inspect-brent-update-schedule.ts",
    "prisma/migrations/20260722140000_commodity_slot_expand_brent_schedule/migration.sql",
  ]) {
    if (exists(rel)) ok(`files:${rel}`, "presente");
    else fail(`files:${rel}`, "ausente");
  }
}

// ---------------------------------------------------------------------------
// 2) Agenda oficial do Brent em brentCommodityJob.ts
// ---------------------------------------------------------------------------
function checkBrentSchedule() {
  const job = read("src/lib/brentCommodityJob.ts");
  const requiredSlots = [
    { slot: "MORNING_EARLY", hour: 7, label: "07:00" },
    { slot: "MORNING_LATE", hour: 11, label: "11:00" },
    { slot: "AFTERNOON_EARLY", hour: 14, label: "14:00" },
    { slot: "AFTERNOON_LATE", hour: 16, label: "16:00" },
  ];
  for (const s of requiredSlots) {
    const pattern = new RegExp(
      `slot:\\s*"${s.slot}"[^}]*hour:\\s*${s.hour}\\b[^}]*label:\\s*"${s.label}"`,
      "s"
    );
    if (pattern.test(job)) {
      ok(`brent:slot:${s.slot}`, `${s.label} em BRENT_COLLECTION_SCHEDULE`);
    } else {
      fail(`brent:slot:${s.slot}`, `entrada ${s.slot}/${s.label} não encontrada`);
    }
  }

  if (job.includes('BRENT_COLLECTION_TIMEZONE = "America/Sao_Paulo"')) {
    ok("brent:timezone", "timezone America/Sao_Paulo");
  } else {
    fail("brent:timezone", "timezone não é America/Sao_Paulo");
  }

  if (job.includes("BRENT_RUNS_ON_WEEKDAYS_ONLY = true")) {
    ok("brent:weekdays-flag", "flag BRENT_RUNS_ON_WEEKDAYS_ONLY=true");
  } else {
    fail("brent:weekdays-flag", "BRENT_RUNS_ON_WEEKDAYS_ONLY ausente ou não é true");
  }

  if (job.includes('cronExpression: "0 7,11,14,16 * * 1-5"')) {
    ok("brent:cron-expression", 'cronExpression "0 7,11,14,16 * * 1-5" documentada');
  } else {
    fail("brent:cron-expression", 'cronExpression "0 7,11,14,16 * * 1-5" ausente');
  }

  if (
    /isSaoPauloWeekday\s*\(\s*parts\s*\)/.test(job) &&
    /if\s*\(\s*BRENT_RUNS_ON_WEEKDAYS_ONLY[^\n]*!isSaoPauloWeekday/.test(job)
  ) {
    ok("brent:weekday-guard", "runBrentCommodityScheduledCollection filtra fim de semana");
  } else {
    fail("brent:weekday-guard", "guard de dia útil não aplicado no runner");
  }

  // Slots antigos (09:00 / 15:30) não podem aparecer como parte da agenda oficial
  // do Brent — apenas no PTAX / documentação legada.
  const brentScheduleBlock = job.match(/BRENT_COLLECTION_SCHEDULE\s*=\s*\[([^\]]+)\]/)?.[1] ?? "";
  if (/hour:\s*9\b/.test(brentScheduleBlock) || /"09:00"/.test(brentScheduleBlock)) {
    fail("brent:no-legacy-in-schedule", "BRENT_COLLECTION_SCHEDULE ainda contém 09:00");
  } else {
    ok("brent:no-legacy-in-schedule", "BRENT_COLLECTION_SCHEDULE não contém 09:00 (legado)");
  }
  if (/hour:\s*15\b/.test(brentScheduleBlock) || /"15:30"/.test(brentScheduleBlock)) {
    fail("brent:no-legacy-in-schedule-2", "BRENT_COLLECTION_SCHEDULE ainda contém 15:30");
  } else {
    ok("brent:no-legacy-in-schedule-2", "BRENT_COLLECTION_SCHEDULE não contém 15:30 (legado)");
  }
}

// ---------------------------------------------------------------------------
// 3) Único scheduler Brent (não pode existir 2 setInterval no mesmo módulo)
// ---------------------------------------------------------------------------
function checkNoDuplicateScheduler() {
  const job = read("src/lib/brentCommodityJob.ts");
  const setIntervalMatches = job.match(/setInterval\s*\(/g) ?? [];
  if (setIntervalMatches.length === 1) {
    ok("brent:single-scheduler", "1 setInterval registrado em brentCommodityJob.ts");
  } else {
    fail(
      "brent:single-scheduler",
      `esperado 1 setInterval, encontrado ${setIntervalMatches.length}`
    );
  }

  if (/if\s*\(\s*schedulerStarted\s*\)\s*return/.test(job)) {
    ok("brent:idempotent-start", "startBrentCommodityScheduledJob é idempotente");
  } else {
    fail("brent:idempotent-start", "guard schedulerStarted ausente");
  }
}

// ---------------------------------------------------------------------------
// 4) PTAX preservado
// ---------------------------------------------------------------------------
function checkPtaxPreserved() {
  const ptax = read("src/lib/ptaxSnapshotJob.ts");

  const requiredPtaxSlots = [
    { slot: "MORNING", hour: 9, label: "09:00" },
    { slot: "AFTERNOON", hour: 15, minute: 30, label: "15:30" },
  ];
  for (const s of requiredPtaxSlots) {
    const pattern = new RegExp(
      `slot:\\s*"${s.slot}"[^}]*hour:\\s*${s.hour}\\b[^}]*label:\\s*"${s.label}"`,
      "s"
    );
    if (pattern.test(ptax)) {
      ok(`ptax:slot:${s.slot}`, `${s.label} preservado em PTAX_COLLECTION_SCHEDULE`);
    } else {
      fail(`ptax:slot:${s.slot}`, `slot legado ${s.label} não encontrado no PTAX`);
    }
  }

  if (ptax.includes("resolvePtaxScheduledSlotForMinute")) {
    ok("ptax:own-resolver", "PTAX tem seu próprio resolver (desacoplado do Brent)");
  } else {
    fail("ptax:own-resolver", "resolver dedicado do PTAX ausente");
  }

  // O runner do PTAX não pode chamar resolveScheduledSlotForMinute do Brent.
  // Precisamos ignorar comentários/JSDoc — verificamos só imports reais.
  const ptaxNoComments = ptax
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const importsBrentResolver = /import[^;]+resolveScheduledSlotForMinute[^;]+brentCommodityJob/.test(
    ptaxNoComments
  );
  const callsBrentResolver = /\bresolveScheduledSlotForMinute\s*\(/.test(ptaxNoComments);
  if (importsBrentResolver || callsBrentResolver) {
    fail(
      "ptax:no-brent-resolver",
      "ptaxSnapshotJob.ts ainda importa/usa resolveScheduledSlotForMinute do Brent"
    );
  } else {
    ok(
      "ptax:no-brent-resolver",
      "PTAX não reusa resolveScheduledSlotForMinute do Brent"
    );
  }

  // PTAX_SNAPSHOT_REGISTERED_JOB.schedule deve ser 09:00, 15:30.
  const brentJob = read("src/lib/brentCommodityJob.ts");
  if (
    brentJob.includes('schedule: "09:00, 15:30"') &&
    brentJob.includes("PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB")
  ) {
    ok("ptax:legacy-schedule", "PTAX registered job mantém 09:00, 15:30");
  } else {
    fail("ptax:legacy-schedule", "PTAX registered job não expõe 09:00, 15:30");
  }
}

// ---------------------------------------------------------------------------
// 5) Prisma schema + migration
// ---------------------------------------------------------------------------
function checkPrisma() {
  const schema = read("prisma/schema.prisma");
  const enumBlock = schema.match(
    /enum\s+CommodityCollectionSlot\s*\{([^}]+)\}/
  )?.[1] ?? "";
  const requiredValues = [
    "MORNING",
    "AFTERNOON",
    "MORNING_EARLY",
    "MORNING_LATE",
    "AFTERNOON_EARLY",
    "AFTERNOON_LATE",
  ];
  for (const v of requiredValues) {
    const re = new RegExp(`\\b${v}\\b`);
    if (re.test(enumBlock)) {
      ok(`prisma:enum:${v}`, `${v} presente em CommodityCollectionSlot`);
    } else {
      fail(`prisma:enum:${v}`, `${v} ausente em CommodityCollectionSlot`);
    }
  }

  const migrationSql = read(
    "prisma/migrations/20260722140000_commodity_slot_expand_brent_schedule/migration.sql"
  );
  for (const v of ["MORNING_EARLY", "MORNING_LATE", "AFTERNOON_EARLY", "AFTERNOON_LATE"]) {
    const re = new RegExp(
      `ALTER\\s+TYPE\\s+"CommodityCollectionSlot"\\s+ADD\\s+VALUE\\s+IF\\s+NOT\\s+EXISTS\\s+'${v}'`,
      "i"
    );
    if (re.test(migrationSql)) {
      ok(`migration:${v}`, `ALTER TYPE ADD VALUE ${v}`);
    } else {
      fail(`migration:${v}`, `ALTER TYPE ADD VALUE ${v} ausente`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6) Logging convention
// ---------------------------------------------------------------------------
function checkLogging() {
  const job = read("src/lib/brentCommodityJob.ts");
  for (const line of [
    "update started",
    "update finished",
    "skipped weekend",
    "registered job=",
    "scheduler disabled via BRENT_COMMODITY_SCHEDULER_ENABLED",
  ]) {
    if (job.includes(line)) {
      ok(`log:${line}`, "linha de log presente");
    } else {
      fail(`log:${line}`, `linha de log "${line}" ausente`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7) Frontend não importa Prisma (defesa geral do módulo)
// ---------------------------------------------------------------------------
function checkNoPrismaLeakInHeader() {
  // Componente do header que consome os indicators (arquivo pode variar de
  // nome). Aqui basta garantir que ninguém importou @prisma/client no diretório
  // src/components/finance/bi ou similar do header.
  const marketTicker = "src/lib/marketHeaderTicker.ts";
  if (!exists(marketTicker)) {
    ok("frontend:no-prisma-check", "helper de header não presente — nada a checar");
    return;
  }
  const src = read(marketTicker);
  if (/@prisma\/client/.test(src)) {
    fail("frontend:no-prisma-check", "marketHeaderTicker importa @prisma/client");
  } else {
    ok("frontend:no-prisma-check", "marketHeaderTicker sem import Prisma");
  }
}

// ---------------------------------------------------------------------------
// 8) Runtime dynamic (fixture) — testa que registered job responde corretamente
// ---------------------------------------------------------------------------
async function checkRuntime() {
  const {
    BRENT_COMMODITY_REGISTERED_JOB,
    BRENT_COLLECTION_SCHEDULE,
    BRENT_RUNS_ON_WEEKDAYS_ONLY,
    listRegisteredScheduledJobs,
    resolveBrentCollectionSlot,
    resolveScheduledSlotForMinute,
    getSaoPauloDateTimeParts,
    isSaoPauloWeekday,
  } = await import("../src/lib/brentCommodityJob.js");

  if (BRENT_COMMODITY_REGISTERED_JOB.schedule === "07:00, 11:00, 14:00, 16:00") {
    ok("runtime:brent-schedule", `schedule="07:00, 11:00, 14:00, 16:00"`);
  } else {
    fail(
      "runtime:brent-schedule",
      `schedule esperado "07:00, 11:00, 14:00, 16:00", veio "${BRENT_COMMODITY_REGISTERED_JOB.schedule}"`
    );
  }

  if (BRENT_COLLECTION_SCHEDULE.length === 4) {
    ok("runtime:brent-slots-length", "4 slots no schedule");
  } else {
    fail("runtime:brent-slots-length", `esperado 4 slots, veio ${BRENT_COLLECTION_SCHEDULE.length}`);
  }

  if (BRENT_RUNS_ON_WEEKDAYS_ONLY === true) {
    ok("runtime:brent-weekdays-only", "runsOnWeekdaysOnly=true");
  } else {
    fail("runtime:brent-weekdays-only", "runsOnWeekdaysOnly não é true");
  }

  // resolveScheduledSlotForMinute deve bater exatamente 07/11/14/16.
  const cases: Array<[string, string | null]> = [
    ["2026-07-06T10:00:00.000Z" /* 07:00 SP */, "MORNING_EARLY"],
    ["2026-07-06T14:00:00.000Z" /* 11:00 SP */, "MORNING_LATE"],
    ["2026-07-06T17:00:00.000Z" /* 14:00 SP */, "AFTERNOON_EARLY"],
    ["2026-07-06T19:00:00.000Z" /* 16:00 SP */, "AFTERNOON_LATE"],
    ["2026-07-06T18:00:00.000Z" /* 15:00 SP */, null],
    ["2026-07-06T12:00:00.000Z" /* 09:00 SP legado */, null],
  ];
  for (const [utcIso, expected] of cases) {
    const parts = getSaoPauloDateTimeParts(new Date(utcIso));
    const got = resolveScheduledSlotForMinute(parts);
    if (got === expected) {
      ok(
        `runtime:slot:${utcIso}`,
        `SP ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} → ${got}`
      );
    } else {
      fail(
        `runtime:slot:${utcIso}`,
        `SP ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} esperado ${expected}, veio ${got}`
      );
    }
  }

  // resolveBrentCollectionSlot cobre faixas — teste alguns pontos-chave.
  assertResolve(resolveBrentCollectionSlot, { hour: 6, minute: 30 }, "MORNING_EARLY", "runtime:range:06:30");
  assertResolve(resolveBrentCollectionSlot, { hour: 10, minute: 0 }, "MORNING_LATE", "runtime:range:10:00");
  assertResolve(resolveBrentCollectionSlot, { hour: 13, minute: 45 }, "AFTERNOON_EARLY", "runtime:range:13:45");
  assertResolve(resolveBrentCollectionSlot, { hour: 20, minute: 0 }, "AFTERNOON_LATE", "runtime:range:20:00");

  // isSaoPauloWeekday
  const sunday = getSaoPauloDateTimeParts(new Date("2026-07-05T14:00:00.000Z"));
  if (isSaoPauloWeekday(sunday) === false) ok("runtime:weekday:sun", "domingo é reconhecido como fim de semana");
  else fail("runtime:weekday:sun", "domingo classificado como dia útil");

  const monday = getSaoPauloDateTimeParts(new Date("2026-07-06T14:00:00.000Z"));
  if (isSaoPauloWeekday(monday)) ok("runtime:weekday:mon", "segunda é dia útil");
  else fail("runtime:weekday:mon", "segunda não classificada como dia útil");

  const jobs = listRegisteredScheduledJobs();
  const ids = jobs.map((j) => j.id).sort();
  if (JSON.stringify(ids) === JSON.stringify(["brent-commodity-collection", "ptax-snapshot-collection"])) {
    ok("runtime:registered-jobs", "listRegisteredScheduledJobs = [brent, ptax]");
  } else {
    fail("runtime:registered-jobs", `ids inesperados: ${ids.join(", ")}`);
  }

  const ptax = jobs.find((j) => j.id === "ptax-snapshot-collection");
  if (ptax?.schedule === "09:00, 15:30") {
    ok("runtime:ptax-schedule", "PTAX preservou 09:00, 15:30");
  } else {
    fail("runtime:ptax-schedule", `PTAX schedule inesperado: "${ptax?.schedule}"`);
  }
}

function assertResolve(
  fn: (p: { hour: number; minute: number }) => string,
  input: { hour: number; minute: number },
  expected: string,
  id: string
) {
  const got = fn(input);
  if (got === expected) ok(id, `${input.hour}:${String(input.minute).padStart(2, "0")} → ${got}`);
  else fail(id, `esperado ${expected}, veio ${got}`);
}

async function main() {
  console.log("=== qaMarketIndicatorsSchedule (static + runtime) ===\n");
  checkFilesPresent();
  checkBrentSchedule();
  checkNoDuplicateScheduler();
  checkPtaxPreserved();
  checkPrisma();
  checkLogging();
  checkNoPrismaLeakInHeader();
  await checkRuntime();

  console.log("");
  if (failed === 0) {
    console.log("✔ Todos os checks passaram.");
  } else {
    console.error(`✗ ${failed} check(s) falharam.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
