/**
 * Inteligência Fiscal 360° — processamento incremental, backfill e verificação (CLI).
 *
 *   npm run fiscal360:status                              # somente leitura (padrão)
 *   npm run fiscal360:process -- --apply --confirm-apply  # ciclo incremental (descoberta + fila)
 *   npm run fiscal360:backfill -- --apply --confirm-apply # zera watermarks e processa o histórico em lotes
 *   npm run fiscal360:verify                              # equivalência materializado × fonte oficial (leitura)
 *
 * Opções: --max-jobs N  --time-budget-min M  --batch N  --max-batches N
 * Fontes operacionais: SOMENTE LEITURA. Escrita: apenas tabelas Fiscal* derivadas.
 * Interrompível (Ctrl+C): o job em curso termina; watermarks e fila persistem; rodar de novo continua.
 * NUNCA rodar em homologação/produção sem autorização expressa.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { fiscalNfeWhereSql, nfeCompetenceDateSql } from "../src/lib/financeBillingNfeDashboard.js";
import { FISCAL360_UNKNOWN_COMPANY, resolveFiscal360GroupCnpj } from "../src/lib/finance/fiscal360/fiscal360Constants.js";
import { runFiscal360Processing } from "../src/lib/finance/fiscal360/fiscal360Processor.server.js";
import { writeFiscal360Checkpoint } from "../src/lib/finance/fiscal360/fiscal360Queue.server.js";

const DISCOVERY_KEYS = ["nfe", "nfe-summary", "ap", "treasury-ap", "guide", "proof", "apuration-period", "apuration-line", "decision"];

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}
const has = (name: string) => process.argv.includes(name);
const int = (name: string, def: number) => {
  const n = Number.parseInt(arg(name) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

async function status(prisma: PrismaClient): Promise<void> {
  const [jobs, lastRun, checkpoints, facts] = await Promise.all([
    prisma.fiscalProcessingJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.fiscalProcessingRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.fiscalProcessingCheckpoint.findMany({ orderBy: { key: "asc" } }),
    Promise.all([
      prisma.nomusNfe.count(),
      prisma.fiscalDocumentFact.count(),
      prisma.nomusAccountsPayable.count(),
      prisma.fiscalApTitleFact.count(),
      prisma.fiscalPaymentGuide.count(),
      prisma.fiscalPaymentFact.count(),
      prisma.fiscalMonthlySnapshot.count(),
    ]),
  ]);
  console.log("Fila:", Object.fromEntries(jobs.map((j) => [j.status, j._count._all])));
  console.log("Última execução:", lastRun ? `${lastRun.status} ${lastRun.startedAt.toISOString()} (${lastRun.durationMs ?? "-"} ms)` : "nenhuma");
  console.log("Watermarks:", checkpoints.map((c) => `${c.key}=${c.cursorUpdatedAt?.toISOString() ?? "-"}`).join(" "));
  const [nfe, docFacts, ap, apFacts, guides, payFacts, snapshots] = facts;
  console.log(`NF-e ${nfe} → fatos ${docFacts} | AP ${ap} → fatos ${apFacts} | guias ${guides} | obrigações ${payFacts} | linhas de snapshot ${snapshots}`);
}

/** Equivalência: receita oficial e destacado materializados × consulta direta com o predicado canônico. */
async function verify(prisma: PrismaClient): Promise<number> {
  const competence = nfeCompetenceDateSql("emissao", "n");
  const official = await prisma.$queryRaw<Array<{ cnpj: string | null; month: string; revenue: unknown; icms: unknown; pis: unknown; cofins: unknown; ipi: unknown }>>(Prisma.sql`
    SELECT regexp_replace(COALESCE(n."cnpjEmitente", ''), '[^0-9]', '', 'g') AS cnpj,
           to_char(${competence}, 'YYYY-MM') AS month,
           SUM(n."valorLiquido") AS revenue,
           SUM(fs."vICMS") AS icms, SUM(fs."vPIS") AS pis, SUM(fs."vCOFINS") AS cofins, SUM(fs."vIPI") AS ipi
    FROM "NomusNfe" n LEFT JOIN "NomusNfeFiscalSummary" fs ON fs."nomusNfeId" = n."id"
    WHERE ${fiscalNfeWhereSql("emissao", undefined, "n")}
    GROUP BY 1, 2`);
  const snaps = await prisma.fiscalMonthlySnapshot.findMany({ select: { companyCnpj: true, competenceMonth: true, taxType: true, officialRevenue: true, highlightedMarketAmount: true } });
  const key = (c: string, m: string) => `${c}|${m}`;
  const revenueSnap = new Map<string, number>();
  const taxSnap = new Map<string, number>();
  for (const s of snaps) {
    if (s.taxType === "*") revenueSnap.set(key(s.companyCnpj, s.competenceMonth), Number(s.officialRevenue));
    else taxSnap.set(`${key(s.companyCnpj, s.competenceMonth)}|${s.taxType}`, Number(s.highlightedMarketAmount));
  }
  let divergences = 0;
  for (const row of official) {
    const cnpj = resolveFiscal360GroupCnpj({ cnpj: row.cnpj }) ?? FISCAL360_UNKNOWN_COMPANY;
    const k = key(cnpj, row.month);
    const checks: Array<[string, number, number]> = [
      ["receita oficial", Number(row.revenue ?? 0), revenueSnap.get(k) ?? 0],
      ["ICMS destacado (venda de mercado)", Number(row.icms ?? 0), taxSnap.get(`${k}|ICMS`) ?? 0],
      ["PIS destacado (venda de mercado)", Number(row.pis ?? 0), taxSnap.get(`${k}|PIS`) ?? 0],
      ["COFINS destacado (venda de mercado)", Number(row.cofins ?? 0), taxSnap.get(`${k}|COFINS`) ?? 0],
      ["IPI destacado (venda de mercado)", Number(row.ipi ?? 0), taxSnap.get(`${k}|IPI`) ?? 0],
    ];
    for (const [label, source, materialized] of checks) {
      if (Math.abs(source - materialized) > 0.01) {
        divergences += 1;
        console.log(`DIVERGÊNCIA ${k} ${label}: fonte=${source.toFixed(2)} materializado=${materialized.toFixed(2)}`);
      }
    }
  }
  console.log(`Verificação concluída: ${official.length} competências×empresa, ${divergences} divergência(s).`);
  return divergences;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const mode = has("--verify") ? "verify" : has("--backfill") ? "backfill" : has("--apply") ? "process" : "status";
    if (mode === "status") return void (await status(prisma));
    if (mode === "verify") {
      const n = await verify(prisma);
      process.exitCode = n > 0 ? 1 : 0;
      return;
    }
    if (!has("--confirm-apply")) {
      console.error("Escrita nas tabelas Fiscal* exige --apply --confirm-apply. Nada foi feito.");
      process.exitCode = 2;
      return;
    }
    let stop = false;
    process.on("SIGINT", () => {
      console.log("Interrupção solicitada: terminando o job em curso; a fila e os watermarks ficam persistidos.");
      stop = true;
    });
    if (mode === "backfill" && !has("--resume")) {
      for (const key of DISCOVERY_KEYS) await writeFiscal360Checkpoint(prisma, key, { cursorUpdatedAt: null, cursorId: null, metadata: null });
      console.log("Watermarks zerados: o histórico será descoberto em lotes (fatos idênticos não geram job).");
    }
    const budgetMs = int("--time-budget-min", mode === "backfill" ? 120 : 10) * 60_000;
    const started = Date.now();
    let cycle = 0;
    do {
      cycle += 1;
      const res = await runFiscal360Processing(prisma, {
        trigger: mode === "backfill" ? "BACKFILL" : "CLI",
        maxJobs: int("--max-jobs", mode === "backfill" ? 20_000 : 5000),
        timeBudgetMs: Math.max(60_000, budgetMs - (Date.now() - started)),
        batchSize: int("--batch", 500),
        maxDiscoveryBatches: int("--max-batches", mode === "backfill" ? 10_000 : 200),
        skipDiscovery: cycle > 1,
        shouldStop: () => stop,
        log: (m) => console.log(m),
      });
      console.log(`Ciclo ${cycle}: ${res.status} · jobs ok ${res.jobsSucceeded} · falhas ${res.jobsFailed} · partições ${res.partitionsRebuilt} · ${res.durationMs} ms`);
      const pending = await prisma.fiscalProcessingJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } });
      if (pending === 0 || stop || mode !== "backfill") break;
    } while (Date.now() - started < budgetMs);
    await status(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
