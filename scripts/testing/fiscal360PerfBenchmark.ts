/**
 * Benchmark da Inteligência Fiscal 360° num PostgreSQL 17 descartável (nunca em banco operacional).
 *
 *   COMMISSION_PG17_BIN=<bin do PG17> npx tsx scripts/testing/fiscal360PerfBenchmark.ts [--nfe 20000] [--ap 6000] [--guides 400] [--iterations 40]
 *
 * Mede: (1) backfill incremental (docs/s), (2) latência p50/p95 dos endpoints do dashboard sobre as tabelas
 * materializadas, (3) o relatório T07 anterior (lê NF-e/guias na requisição) como referência "antes",
 * (4) consulta direta agregada com o predicado oficial (piso teórico sem materialização).
 * Dataset sintético gerado por generate_series — sem dados reais.
 */
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { commissionPg17BinDir, startCommissionPostgres17 } from "./commissionPostgresHarness.js";
import { runFiscal360Processing } from "../../src/lib/finance/fiscal360/fiscal360Processor.server.js";
import {
  getFiscal360Forecast,
  getFiscal360Intercompany,
  getFiscal360Overview,
  getFiscal360Processing,
  listFiscal360Documents,
  listFiscal360Payments,
  listFiscal360Reconciliation,
  parseFiscal360Filters,
} from "../../src/lib/finance/fiscal360/fiscal360QueryService.server.js";
import { buildFiscalTaxIntelligenceReport, parseFiscalTaxIntelFilters } from "../../src/lib/finance/fiscalTaxIntelligenceService.server.js";
import { fiscalNfeWhereSql, nfeCompetenceDateSql } from "../../src/lib/financeBillingNfeDashboard.js";
import { Prisma } from "@prisma/client";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  const n = i >= 0 ? Number.parseInt(process.argv[i + 1] ?? "", 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

async function time<T>(fn: () => Promise<T>, iterations: number): Promise<{ p50: number; p95: number; max: number }> {
  await fn(); // aquecimento
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) };
}

async function main(): Promise<void> {
  const bin = commissionPg17BinDir();
  if (!bin) throw new Error("COMMISSION_PG17_BIN ausente: o benchmark só roda em PostgreSQL 17 descartável.");
  const nfe = arg("--nfe", 20_000);
  const apCount = arg("--ap", 6_000);
  const guides = arg("--guides", 400);
  const iterations = arg("--iterations", 40);
  const db = await startCommissionPostgres17(bin, { schema: "final" });
  const prisma = new PrismaClient({ datasourceUrl: db.poolUrl(8) });
  try {
    console.log(`Gerando dataset: ${nfe} NF-e, ${apCount} títulos AP, ${guides} guias…`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "NomusNfe" ("id","externalId","numero","serie","status","tipoOperacao","isFornecedor","ambiente","cnpjEmitente","xmlTpNF","xmlNatOp","xmlDestCnpjCpf","xmlDhEmi","xmlVProd","xmlVNF","valorLiquido","billingClassification","isMarketSale","isFiscalBilling","rawPayload","payloadHash","syncedAt","updatedAt")
      SELECT gen_random_uuid()::text, g, g::text, '1', CASE WHEN g % 50 = 0 THEN 7 ELSE 4 END, 1, 0, 1,
             (ARRAY['14055501000180','72569510000195','55717719000130'])[1 + g % 3], 1,
             CASE WHEN g % 40 = 0 THEN 'REMESSA PARA CONSERTO' ELSE 'VENDA DE PRODUCAO' END,
             CASE WHEN g % 20 = 0 THEN (ARRAY['72569510000195','14055501000180','55717719000130'])[1 + (g / 3) % 3] ELSE '11222333000181' END,
             timestamp '2024-01-01 12:00' + ((g * 7) % 1000) * interval '1 day', 1000 + g % 500, 1000 + g % 500, 1000 + g % 500,
             CASE WHEN g % 20 = 0 THEN 'INTERCOMPANY'::"NomusNfeBillingClassification" WHEN g % 40 = 0 THEN 'LOGISTICS_NOT_REVENUE'::"NomusNfeBillingClassification" ELSE 'MARKET_REVENUE'::"NomusNfeBillingClassification" END,
             (g % 20 <> 0 AND g % 40 <> 0), true, '{}'::json, 'h' || g, now(), now()
      FROM generate_series(1, ${nfe}) g`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "NomusNfeFiscalSummary" ("id","nomusNfeId","parserVersion","source","xmlHash","parsedAt","isCancelled","finalidade","tpNF","vProd","vNF","vBC","vICMS","vPIS","vCOFINS","vIPI","updatedAt")
      SELECT gen_random_uuid()::text, n."id", 'nfe-xml-fiscal-v1', CASE WHEN n."externalId" % 200 = 0 THEN 'MISSING' ELSE 'XML' END, 'x' || n."externalId", now(), n."status" = 7, 1, 1,
             n."xmlVProd", n."xmlVNF", n."xmlVProd", n."xmlVProd" * 0.12, n."xmlVProd" * 0.0165, n."xmlVProd" * 0.076, n."xmlVProd" * 0.05, now()
      FROM "NomusNfe" n`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "NomusAccountsPayable" ("id","externalId","companyName","personName","description","classification","dueDate","amountPayable","amountPaid","balancePayable","rawPayload","payloadHash","syncedAt","updatedAt")
      SELECT gen_random_uuid()::text, 100000 + g,
             (ARRAY['Koppetel Comercio de Plasticos LTDA','Lazarios Comercio de Plasticos LTDA','Sm Comercio de Plasticos LTDA - SM'])[1 + g % 3],
             CASE WHEN g % 12 = 0 THEN 'Receita Federal' WHEN g % 40 = 1 THEN 'Koppetel Comercio de Plasticos LTDA' ELSE 'Fornecedor ' || (g % 300) END,
             CASE WHEN g % 12 = 0 THEN 'DARF 2172 comp ' || to_char(timestamp '2024-01-01' + (g % 30) * interval '30 day', 'MM/YYYY') WHEN g % 50 = 2 THEN 'Pagamento de imposto' ELSE 'Compra de material ' || g END,
             NULL, timestamp '2024-01-15' + (g % 1000) * interval '1 day', 1000 + g % 900, CASE WHEN g % 3 = 0 THEN 0 ELSE 1000 + g % 900 END, CASE WHEN g % 3 = 0 THEN 0 ELSE 0 END,
             '{}'::json, 'a' || g, now(), now()
      FROM generate_series(1, ${apCount}) g`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "FiscalPaymentGuide" ("id","taxType","jurisdiction","revenueCode","guideType","guideNumber","periodStart","periodEnd","dueDate","assessedAmount","amountDue","amountPaid","balanceDue","status","source","updatedAt")
      SELECT gen_random_uuid()::text, (ARRAY['ICMS','PIS','COFINS','IPI'])[1 + g % 4], 'FEDERAL'::"FiscalJurisdiction", '2172', 'DARF'::"FiscalGuideType", 'G' || g,
             date_trunc('month', timestamp '2024-01-01' + (g % 30) * interval '30 day')::date, (date_trunc('month', timestamp '2024-01-01' + (g % 30) * interval '30 day') + interval '1 month - 1 day')::date,
             (timestamp '2024-02-20' + (g % 30) * interval '30 day')::date, 1000, 1000, CASE WHEN g % 3 = 0 THEN 1000 ELSE 0 END, CASE WHEN g % 3 = 0 THEN 0 ELSE 1000 END, 'ISSUED'::"FiscalGuideStatus", 'MANUAL', now()
      FROM generate_series(1, ${guides}) g`);

    const t0 = performance.now();
    const run = await runFiscal360Processing(prisma, { trigger: "BACKFILL", workerId: "bench", maxJobs: 1_000_000, timeBudgetMs: 4 * 60 * 60_000, batchSize: 1000, maxDiscoveryBatches: 100_000 });
    let seconds = (performance.now() - t0) / 1000;
    let guard = 0;
    while ((await prisma.fiscalProcessingJob.count({ where: { status: "PENDING" } })) > 0 && guard < 50) {
      const more = await runFiscal360Processing(prisma, { trigger: "BACKFILL", workerId: `bench-${guard}`, skipDiscovery: true, maxJobs: 1_000_000, timeBudgetMs: 4 * 60 * 60_000 });
      run.jobsSucceeded += more.jobsSucceeded;
      guard += 1;
    }
    seconds = (performance.now() - t0) / 1000;
    const jobs = await prisma.fiscalProcessingJob.groupBy({ by: ["jobType", "status"], _count: { _all: true } });
    console.log(`\nBACKFILL: ${seconds.toFixed(1)} s · ${run.jobsSucceeded} jobs · ${(nfe / seconds).toFixed(0)} NF-e/s (incluindo AP, guias, partições e projeções)`);
    console.log("Jobs:", jobs.map((j) => `${j.jobType}/${j.status}=${j._count._all}`).join(" "));

    const reprocess = await runFiscal360Processing(prisma, { trigger: "CLI", workerId: "bench-noop" });
    console.log(`REPROCESSO SEM MUDANÇA: ${reprocess.jobsSucceeded} jobs em ${reprocess.durationMs} ms`);

    const filters = parseFiscal360Filters({ company: "group", fromMonth: "2024-01", toMonth: "2026-10" });
    const page = { page: 1, pageSize: 50 };
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["dashboard (visão executiva)", () => getFiscal360Overview(prisma, filters)],
      ["tributos pagos (página)", () => listFiscal360Payments(prisma, filters, page)],
      ["conciliação (página)", () => listFiscal360Reconciliation(prisma, filters, page, null)],
      ["documentos (página)", () => listFiscal360Documents(prisma, filters, page)],
      ["operações do grupo", () => getFiscal360Intercompany(prisma, filters, page)],
      ["projeções", () => getFiscal360Forecast(prisma, filters, null)],
      ["processamento", () => getFiscal360Processing(prisma)],
    ];
    console.log(`\nLATÊNCIA (${iterations} iterações, ms):`);
    for (const [label, fn] of cases) {
      const r = await time(fn, iterations);
      console.log(`  ${label.padEnd(30)} p50 ${r.p50.toFixed(1).padStart(7)}  p95 ${r.p95.toFixed(1).padStart(7)}  max ${r.max.toFixed(1).padStart(7)}`);
    }
    const old = await time(() => buildFiscalTaxIntelligenceReport(prisma, parseFiscalTaxIntelFilters({ periodStart: "2024-01-01", periodEnd: "2026-10-31" })), Math.min(iterations, 8));
    console.log(`  ${"T07 anterior (lê fontes)".padEnd(30)} p50 ${old.p50.toFixed(1).padStart(7)}  p95 ${old.p95.toFixed(1).padStart(7)}  max ${old.max.toFixed(1).padStart(7)}`);
    const direct = await time(
      () =>
        prisma.$queryRaw(Prisma.sql`
          SELECT to_char(${nfeCompetenceDateSql("emissao", "n")}, 'YYYY-MM') AS m, SUM(n."valorLiquido") AS r, SUM(fs."vICMS") AS icms
          FROM "NomusNfe" n LEFT JOIN "NomusNfeFiscalSummary" fs ON fs."nomusNfeId" = n."id"
          WHERE ${fiscalNfeWhereSql("emissao", undefined, "n")} GROUP BY 1`),
      Math.min(iterations, 12)
    );
    console.log(`  ${"agregação direta (referência)".padEnd(30)} p50 ${direct.p50.toFixed(1).padStart(7)}  p95 ${direct.p95.toFixed(1).padStart(7)}  max ${direct.max.toFixed(1).padStart(7)}`);
    const counts = await Promise.all([prisma.fiscalDocumentFact.count(), prisma.fiscalApTitleFact.count(), prisma.fiscalPaymentFact.count(), prisma.fiscalMonthlySnapshot.count(), prisma.fiscalReconciliationItem.count()]);
    console.log(`\nTamanho materializado: docs ${counts[0]} · títulos AP ${counts[1]} · obrigações ${counts[2]} · linhas de snapshot ${counts[3]} · itens de conciliação ${counts[4]}`);
  } finally {
    await prisma.$disconnect();
    await db.stop();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
