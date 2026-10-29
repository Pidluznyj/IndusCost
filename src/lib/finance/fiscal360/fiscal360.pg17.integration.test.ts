/**
 * Inteligência Fiscal 360° num PostgreSQL 17 REAL e DESCARTÁVEL (schema completo do projeto + índice parcial
 * da migration): materialização, equivalência com a regra oficial de faturamento, idempotência, incremental,
 * mudança de competência, concorrência entre workers, lease/recuperação, falha intermediária, decisões
 * manuais, não duplicidade de pagamento e integridade após reinício. Nada sai da máquina.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/finance/fiscal360/fiscal360.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { commissionPg17BinDir, startCommissionPostgres17, type CommissionPg17Database } from "../../../../scripts/testing/commissionPostgresHarness.js";
import { fiscalNfeWhereSql, nfeCompetenceDateSql } from "../../financeBillingNfeDashboard.js";
import { FISCAL360_COMPANIES } from "./fiscal360Constants.js";
import { executeFiscal360Job, runFiscal360Processing } from "./fiscal360Processor.server.js";
import { claimFiscal360Jobs, completeFiscal360Job, enqueueFiscal360Jobs, failFiscal360Job, partitionJob } from "./fiscal360Queue.server.js";
import { getFiscal360Forecast, getFiscal360Overview, getFiscal360PaymentDetail, listFiscal360Payments, parseFiscal360Filters } from "./fiscal360QueryService.server.js";
import { createFiscal360Decision, requestFiscal360Reprocess } from "./fiscal360WriteService.server.js";

const bin = commissionPg17BinDir();
const SKIP = bin ? false : "COMMISSION_PG17_BIN ausente: suíte PostgreSQL 17 não executada.";
const LAZ = FISCAL360_COMPANIES[0]!.cnpj;
const KOP = FISCAL360_COMPANIES[1]!.cnpj;
const ACTOR = { userId: null, userName: "teste" };

describe("Inteligência Fiscal 360° com PostgreSQL 17 real", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let prisma: PrismaClient;
  let seq = 1000;

  async function nfe(over: Partial<Prisma.NomusNfeUncheckedCreateInput> & { vICMS?: number; vPIS?: number; vCOFINS?: number; summary?: boolean } = {}) {
    const id = ++seq;
    const { vICMS = 120, vPIS = 16.5, vCOFINS = 76, summary = true, ...rest } = over;
    const row = await prisma.nomusNfe.create({
      data: {
        externalId: id,
        numero: String(id),
        serie: "1",
        status: 4,
        tipoOperacao: 1,
        isFornecedor: 0,
        ambiente: 1,
        cnpjEmitente: "14.055.501/0001-80",
        xmlTpNF: 1,
        xmlNatOp: "VENDA",
        xmlDestCnpjCpf: "11222333000181",
        xmlDhEmi: new Date("2026-09-10T12:00:00Z"),
        xmlVProd: 1000,
        xmlVNF: 1000,
        valorLiquido: 1000,
        billingClassification: "MARKET_REVENUE",
        isMarketSale: true,
        isFiscalBilling: true,
        rawPayload: {},
        payloadHash: `h${id}`,
        syncedAt: new Date(),
        ...rest,
      },
    });
    if (summary) {
      await prisma.nomusNfeFiscalSummary.create({
        data: { nomusNfeId: row.id, parserVersion: "nfe-xml-fiscal-v1", source: "XML", xmlHash: `x${id}`, parsedAt: new Date(), vProd: 1000, vNF: 1000, vICMS, vPIS, vCOFINS, vBC: 1000 },
      });
    }
    return row;
  }

  async function ap(over: Partial<Prisma.NomusAccountsPayableUncheckedCreateInput> = {}) {
    const id = ++seq;
    return prisma.nomusAccountsPayable.create({
      data: {
        externalId: id,
        companyName: "Koppetel Comercio de Plasticos LTDA",
        personName: "Fornecedor",
        description: "Compra de material",
        dueDate: new Date("2026-10-22T00:00:00Z"),
        amountPayable: 1000,
        amountPaid: 0,
        balancePayable: 1000,
        rawPayload: {},
        payloadHash: `a${id}`,
        syncedAt: new Date(),
        ...over,
      },
    });
  }

  async function drain(label = "CLI") {
    // Executa até a fila esvaziar (partições e follow-ups entram na mesma execução).
    let last = await runFiscal360Processing(prisma, { trigger: "CLI", workerId: `t-${label}` });
    for (let i = 0; i < 6; i += 1) {
      const pending = await prisma.fiscalProcessingJob.count({ where: { status: "PENDING" } });
      if (pending === 0) break;
      last = await runFiscal360Processing(prisma, { trigger: "CLI", workerId: `t-${label}-${i}`, skipDiscovery: true });
    }
    return last;
  }

  const total = async (company: string, month: string, tax = "*") =>
    prisma.fiscalMonthlySnapshot.findUnique({ where: { companyCnpj_competenceMonth_taxType: { companyCnpj: company, competenceMonth: month, taxType: tax } } });

  before(async () => {
    db = await startCommissionPostgres17(bin!, { schema: "final" });
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(12) });
    const indexes = (await prisma.$queryRawUnsafe(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'FiscalProcessingJob'`)) as Array<{ indexname: string; indexdef: string }>;
    const partial = indexes.find((i) => i.indexname === "FiscalProcessingJob_pending_dedupe_key");
    assert.ok(partial, `índice parcial ausente: ${indexes.map((i) => i.indexname).join(", ")}`);
    assert.match(partial.indexdef, /UNIQUE/);
    assert.match(partial.indexdef, /WHERE/);
  });

  after(async () => {
    await prisma?.$disconnect();
    await db?.stop();
  });

  it("materializa documentos e o agregado é equivalente à regra oficial de faturamento (fiscalNfeWhereSql)", async () => {
    await nfe();
    await nfe({ valorLiquido: 2500, xmlVNF: 2500 });
    await nfe({ status: 7, valorLiquido: 700 }); // cancelada
    await nfe({ billingClassification: "INTERCOMPANY", isMarketSale: false, xmlDestCnpjCpf: LAZ, valorLiquido: 900 });
    await nfe({ billingClassification: "LOGISTICS_NOT_REVENUE", isMarketSale: false, xmlNatOp: "REMESSA PARA CONSERTO", valorLiquido: 300 });
    await nfe({ summary: false, valorLiquido: 400 }); // sem XML processado
    const res = await drain("a");
    assert.ok(res.jobsFailed === 0, "nenhum job falhou");

    const reference = await prisma.$queryRaw<Array<{ revenue: unknown }>>(Prisma.sql`
      SELECT SUM(n."valorLiquido") AS revenue FROM "NomusNfe" n
      WHERE ${fiscalNfeWhereSql("emissao", "14055501000180", "n")} AND to_char(${nfeCompetenceDateSql("emissao", "n")}, 'YYYY-MM') = '2026-09'`);
    const snap = await total(KOP, "2026-09");
    assert.ok(snap);
    assert.equal(Number(snap.officialRevenue), Number(reference[0]!.revenue));
    assert.equal(Number(snap.officialRevenue), 1000 + 2500 + 400);
    assert.equal(Number(snap.intercompanyRevenue), 900, "intercompany fora da receita externa");
    assert.equal(snap.cancelledDocumentCount, 1);
    assert.equal(snap.missingXmlCount, 1);

    const icms = await total(KOP, "2026-09", "ICMS");
    // 3 docs oficiais com summary (2 com 120 + 1 sem summary) + intercompany + logística (efetivo) ; cancelada NÃO soma.
    assert.equal(Number(icms!.highlightedMarketAmount), 240);
    assert.equal(Number(icms!.highlightedIntercompanyAmount), 120);
    const ic = await prisma.fiscalIntercompanySnapshot.findFirst({ where: { issuerCnpj: KOP, recipientCnpj: LAZ, competenceMonth: "2026-09" } });
    assert.ok(ic && ic.documentCount === 1 && Number(ic.documentValue) === 1000);
  });

  it("reprocessar sem mudança na fonte é idempotente: nenhum job novo, versões e contagens iguais", async () => {
    const before = await prisma.fiscalMonthlySnapshot.findMany({ orderBy: [{ companyCnpj: "asc" }, { competenceMonth: "asc" }, { taxType: "asc" }] });
    const factsBefore = await prisma.fiscalDocumentFact.count();
    const jobsBefore = await prisma.fiscalProcessingJob.count();
    const again = await runFiscal360Processing(prisma, { trigger: "CLI", workerId: "t-idem" });
    assert.equal(again.jobsSucceeded, 0, "descoberta não enfileira nada sem mudança");
    assert.equal(await prisma.fiscalProcessingJob.count(), jobsBefore);
    assert.equal(await prisma.fiscalDocumentFact.count(), factsBefore);
    const after = await prisma.fiscalMonthlySnapshot.findMany({ orderBy: [{ companyCnpj: "asc" }, { competenceMonth: "asc" }, { taxType: "asc" }] });
    assert.deepEqual(after.map((r) => [r.id, r.snapshotVersion]), before.map((r) => [r.id, r.snapshotVersion]));
  });

  it("atualização incremental: só a partição da NF alterada é reconstruída; mudança de competência invalida a antiga e a nova", async () => {
    const docOct = await nfe({ xmlDhEmi: new Date("2026-10-05T12:00:00Z"), valorLiquido: 100, xmlVNF: 100 });
    await drain("b");
    const sep = await total(KOP, "2026-09");
    const sepVersion = sep!.snapshotVersion;
    const oct = await total(KOP, "2026-10");
    assert.equal(Number(oct!.officialRevenue), 100);

    // Alteração de valor: só outubro muda.
    await prisma.nomusNfe.update({ where: { id: docOct.id }, data: { valorLiquido: 150, payloadHash: "changed" } });
    const r1 = await drain("c");
    assert.equal((await total(KOP, "2026-10"))!.officialRevenue.toString(), "150");
    assert.equal((await total(KOP, "2026-09"))!.snapshotVersion, sepVersion, "setembro intacto");
    assert.ok(r1.partitionsRebuilt <= 1);

    // Mudança de competência: outubro → novembro (antiga zera, nova cresce).
    await prisma.nomusNfe.update({ where: { id: docOct.id }, data: { xmlDhEmi: new Date("2026-11-03T12:00:00Z"), payloadHash: "moved" } });
    await drain("d");
    assert.equal(await total(KOP, "2026-10"), null, "partição antiga sem conteúdo é limpa");
    assert.equal(Number((await total(KOP, "2026-11"))!.officialRevenue), 150);
    assert.equal((await total(KOP, "2026-09"))!.snapshotVersion, sepVersion);
  });

  it("guia vinculada ao AP: uma obrigação, pago uma única vez; desfazer o vínculo não duplica o pagamento", async () => {
    const period = await prisma.fiscalApurationPeriod.create({ data: { companyName: "Koppetel", jurisdiction: "FEDERAL", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), status: "CLOSED" } });
    await prisma.fiscalApurationLine.create({ data: { periodId: period.id, taxType: "COFINS", nature: "DEBIT", assessedAmount: 1000, amountDue: 1000 } });
    const title = await ap({ description: "DARF 2172 comp 08/2026", personName: "Receita Federal", amountPaid: 1000, balancePayable: 0, paymentDate: new Date("2026-09-22T00:00:00Z") });
    const guide = await prisma.fiscalPaymentGuide.create({
      data: { periodId: period.id, taxType: "COFINS", jurisdiction: "FEDERAL", revenueCode: "2172", guideType: "DARF", guideNumber: "DARF-1", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), dueDate: new Date("2026-09-22"), assessedAmount: 1000, amountDue: 1000, status: "ISSUED", accountsPayableExternalId: title.externalId },
    });
    await drain("e");
    const facts = await prisma.fiscalPaymentFact.findMany({ where: { OR: [{ guideId: guide.id }, { apExternalId: title.externalId }] } });
    assert.equal(facts.length, 1, "guia + AP = uma obrigação");
    assert.equal(facts[0]!.anchorType, "GUIDE");
    assert.equal(Number(facts[0]!.paidAmount), 1000);
    assert.equal(facts[0]!.status, "PAID_ERP");
    assert.equal(facts[0]!.evidenceLevel, "ERP_SETTLEMENT");
    assert.equal(facts[0]!.paidMonth, "2026-09");
    let snap = await total(KOP, "2026-08", "COFINS");
    assert.equal(Number(snap!.paidAmount), 1000);
    assert.equal(snap!.apurationStatus, "CLOSED");
    assert.equal((await total(KOP, "2026-09", "COFINS"))!.paidByCashDateAmount.toString(), "1000");

    // Desfaz o vínculo da guia: o título passa a ser obrigação própria (alta confiança) — total pago continua 1000 contado uma vez,
    // porém a guia sem AP e o título sem guia viram POSSÍVEL DUPLICIDADE se a guia declarar pago; aqui a guia não declara valor.
    await prisma.fiscalPaymentGuide.update({ where: { id: guide.id }, data: { accountsPayableExternalId: null } });
    await drain("f");
    const after = await prisma.fiscalPaymentFact.findMany({ where: { OR: [{ guideId: guide.id }, { apExternalId: title.externalId }] }, orderBy: { anchorKey: "asc" } });
    assert.equal(after.length, 2);
    const paid = after.reduce((s, f) => s + (f.countsInPaidTotals ? Number(f.paidAmount) : 0), 0);
    assert.equal(paid, 1000, "pago não cresce quando o mesmo imposto aparece em duas fontes");
    snap = await total(KOP, "2026-08", "COFINS");
    assert.equal(Number(snap!.paidAmount), 1000);
  });

  it("decisões manuais: confirmar título como tributo, rejeitar, definir empresa da guia — com trilha, revogáveis e reprocessadas", async () => {
    const vague = await ap({ description: "Pagamento de imposto referente ao mês", personName: "Prefeitura Municipal", amountPaid: 300, balancePayable: 0, dueDate: new Date("2026-09-15T00:00:00Z") });
    await drain("g");
    let fact = await prisma.fiscalApTitleFact.findUnique({ where: { apExternalId: vague.externalId } });
    assert.equal(fact!.classificationStatus, "PENDING", "palavra genérica não classifica sozinha");
    assert.equal(await prisma.fiscalPaymentFact.count({ where: { apExternalId: vague.externalId } }), 0, "pendente não vira pagamento");

    await assert.rejects(() => createFiscal360Decision(prisma, { decisionType: "AP_CONFIRM_TAX", apExternalId: vague.externalId, payload: { taxType: "ISS" }, reason: "curto" }, ACTOR), /motivo/i);
    await createFiscal360Decision(prisma, { decisionType: "AP_CONFIRM_TAX", apExternalId: vague.externalId, payload: { taxType: "ISS", competenceMonth: "2026-09" }, reason: "Guia ISS conferida com o extrato municipal" }, ACTOR);
    await drain("h");
    fact = await prisma.fiscalApTitleFact.findUnique({ where: { apExternalId: vague.externalId } });
    assert.equal(fact!.classificationStatus, "TAX");
    assert.equal(fact!.classificationRule, "MANUAL_CONFIRM");
    const pf = await prisma.fiscalPaymentFact.findUnique({ where: { anchorKey: `AP:${vague.externalId}` } });
    assert.ok(pf && pf.taxType === "ISS" && Number(pf.paidAmount) === 300 && pf.evidenceLevel === "ERP_SETTLEMENT");

    await createFiscal360Decision(prisma, { decisionType: "AP_REJECT_TAX", apExternalId: vague.externalId, reason: "Título era taxa de alvará, fora do escopo" }, ACTOR);
    await drain("i");
    assert.equal((await prisma.fiscalApTitleFact.findUnique({ where: { apExternalId: vague.externalId } }))!.classificationStatus, "NOT_TAX");
    assert.equal(await prisma.fiscalPaymentFact.count({ where: { apExternalId: vague.externalId } }), 0, "rejeição remove a obrigação");
    assert.equal(await prisma.fiscalReconciliationDecision.count({ where: { apExternalId: vague.externalId, active: true } }), 1, "a nova decisão revoga a anterior");
    assert.ok((await prisma.fiscalSettlementAuditLog.count({ where: { entityType: "Fiscal360Decision" } })) >= 2);

    const orphan = await prisma.fiscalPaymentGuide.create({
      data: { taxType: "ICMS", jurisdiction: "STATE", guideType: "DAE", guideNumber: "DAE-9", periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), dueDate: new Date("2026-10-15"), assessedAmount: 500, amountDue: 500, status: "ISSUED" },
    });
    await drain("j");
    assert.equal((await prisma.fiscalPaymentFact.findUnique({ where: { guideId: orphan.id } }))!.companyCnpj, "UNKNOWN");
    await createFiscal360Decision(prisma, { decisionType: "ASSIGN_GUIDE_COMPANY", guideId: orphan.id, payload: { companyCnpj: LAZ }, reason: "DAE emitido para o CNPJ da Lazarios" }, ACTOR);
    await drain("k");
    const assigned = await prisma.fiscalPaymentFact.findUnique({ where: { guideId: orphan.id } });
    assert.equal(assigned!.companyCnpj, LAZ);
    assert.equal(assigned!.companyResolution, "DECISION");
    assert.equal(Number((await total(LAZ, "2026-09", "ICMS"))!.obligationAmountDue), 500);
  });

  it("consultas leem somente tabelas materializadas e respeitam pagamento × competência, paginação e busca", async () => {
    const filters = parseFiscal360Filters({ company: "group", fromMonth: "2026-08", toMonth: "2026-11" }, new Date("2026-10-29T12:00:00Z"));
    const overview = await getFiscal360Overview(prisma, filters, new Date("2026-10-29T12:00:00Z"));
    assert.equal(overview.kpis.officialRevenue, 1000 + 2500 + 400 + 150);
    assert.ok(overview.kpis.paid >= 1000);
    assert.equal(overview.kpis.cashBurdenState === "INSUFFICIENT_DATA" || overview.kpis.cashBurdenPct != null, true);
    const cash = await getFiscal360Overview(prisma, { ...filters, basis: "CASH" }, new Date("2026-10-29T12:00:00Z"));
    assert.ok(cash.kpis.paid <= overview.kpis.paid + 1e-6, "caixa só inclui pagamento com data");
    // A quebra por evidência fecha com o total em AMBAS as visões (competência e caixa não se misturam).
    for (const k of [overview.kpis, cash.kpis]) {
      assert.ok(Math.abs(k.paidProven + k.paidUnproven + k.paidDeclared - k.paid) < 0.01, `quebra ${k.paid} ≠ ${k.paidProven}+${k.paidUnproven}+${k.paidDeclared}`);
    }

    const page1 = await listFiscal360Payments(prisma, filters, { page: 1, pageSize: 1 }, new Date("2026-10-29T12:00:00Z"));
    const page2 = await listFiscal360Payments(prisma, filters, { page: 2, pageSize: 1 }, new Date("2026-10-29T12:00:00Z"));
    assert.ok(page1.total >= 2 && page1.rows.length === 1 && page2.rows.length === 1);
    assert.notEqual(page1.rows[0]!.anchorKey, page2.rows[0]!.anchorKey);
    assert.ok(page1.totals.paidCounted >= 1000);

    const detail = await getFiscal360PaymentDetail(prisma, page1.rows[0]!.anchorKey);
    assert.ok(detail && detail.evidenceTrail.length >= 5);
    assert.equal(await getFiscal360PaymentDetail(prisma, "GUIDE:00000000-0000-0000-0000-000000000000"), null);
    await assert.rejects(() => getFiscal360PaymentDetail(prisma, "x'; DROP TABLE y;--"), /inválido/i);

    const forecast = await getFiscal360Forecast(prisma, filters, null, new Date("2026-10-29T12:00:00Z"));
    assert.ok(forecast.scenarios.length >= 3, "cenários de sistema persistidos");
  });

  it("mesmo imposto em guia e em título AP de competências vizinhas: pago e devido contados UMA vez, na competência e no caixa", async () => {
    const title = await ap({
      companyName: "Lazarios Comercio de Plasticos LTDA",
      personName: "Receita Federal",
      description: "DARF 5123 comp 09/2026",
      amountPayable: 700,
      amountPaid: 700,
      balancePayable: 0,
      paymentDate: new Date("2026-10-12T00:00:00Z"),
      dueDate: new Date("2026-10-20T00:00:00Z"),
    });
    await prisma.fiscalPaymentGuide.create({
      data: { taxType: "IPI", jurisdiction: "FEDERAL", revenueCode: "5123", guideType: "DARF", guideNumber: "DARF-IPI-8", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), dueDate: new Date("2026-09-22"), assessedAmount: 700, amountDue: 700, amountPaid: 700, paidAt: new Date("2026-10-10T15:00:00Z"), status: "PAID", periodId: (await prisma.fiscalApurationPeriod.create({ data: { companyName: "Lazarios", jurisdiction: "FEDERAL", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), status: "CLOSED" } })).id },
    });
    await drain("race");
    const facts = await prisma.fiscalPaymentFact.findMany({ where: { companyCnpj: LAZ, taxType: "IPI" } });
    assert.equal(facts.length, 2, "guia e título são obrigações distintas na fonte (sem vínculo)");
    assert.equal(facts.filter((x) => x.countsInPaidTotals).length, 1, "só uma conta; a outra fica em revisão");
    const sum = async (month: string, field: "paidAmount" | "paidByCashDateAmount" | "obligationAmountDue") =>
      Number((await total(LAZ, month, "IPI"))?.[field] ?? 0);
    assert.equal((await sum("2026-08", "paidAmount")) + (await sum("2026-09", "paidAmount")), 700, "competência: 700, não 1400");
    assert.equal(await sum("2026-10", "paidByCashDateAmount"), 700, "caixa de outubro: 700, não 1400");
    assert.equal((await sum("2026-08", "obligationAmountDue")) + (await sum("2026-09", "obligationAmountDue")), 700, "devido não repetido");
    const detail = await prisma.fiscalReconciliationItem.count({ where: { companyCnpj: LAZ, checkType: "POSSIBLE_DUPLICATE" } });
    assert.equal(detail, 1);
    void title;
  });

  it("concorrência: workers paralelos executam cada job exatamente uma vez e o enfileiramento duplicado colapsa", async () => {
    await prisma.fiscalProcessingJob.deleteMany({});
    const jobs = Array.from({ length: 40 }, (_, i) => {
      const company = Math.floor(i / 12) % 2 ? LAZ : KOP;
      return partitionJob(company, `${2018 + Math.floor(i / 24)}-${String((i % 12) + 1).padStart(2, "0")}`);
    });
    // Enfileiramentos duplicados em paralelo: apenas um PENDING por dedupeKey.
    const results = await Promise.all([enqueueFiscal360Jobs(prisma, jobs), enqueueFiscal360Jobs(prisma, jobs), enqueueFiscal360Jobs(prisma, jobs)]);
    assert.equal(results.reduce((s, n) => s + n, 0), new Set(jobs.map((j) => `${j.sourceId}`)).size);
    const executed = new Map<string, number>();
    const workers = Array.from({ length: 6 }, (_, w) =>
      (async () => {
        for (;;) {
          const claimed = await claimFiscal360Jobs(prisma, { workerId: `w${w}`, limit: 3, leaseMs: 60_000 });
          if (claimed.length === 0) return;
          for (const job of claimed) {
            await executeFiscal360Job(prisma, job, { rules: { version: "none", rules: [] }, runId: null });
            executed.set(job.id, (executed.get(job.id) ?? 0) + 1);
            assert.ok(await completeFiscal360Job(prisma, job, { durationMs: 1 }));
          }
        }
      })()
    );
    // allSettled: uma falha não deixa workers órfãos disputando a fila dos testes seguintes.
    const settled = await Promise.allSettled(workers);
    assert.deepEqual(settled.filter((s) => s.status === "rejected").map((s) => String((s as PromiseRejectedResult).reason)), []);
    assert.ok([...executed.values()].every((n) => n === 1), "nenhum job executado em duplicidade");
    const partitions = await prisma.fiscalProcessingJob.count({ where: { jobType: "REBUILD_PARTITION", status: "SUCCEEDED", attempts: 1 } });
    assert.equal(partitions, 40, "as 40 partições distintas foram reconstruídas uma vez cada");
    assert.equal(executed.size, await prisma.fiscalProcessingJob.count({ where: { status: "SUCCEEDED" } }));
    assert.equal(await prisma.fiscalProcessingJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }), 0);
  });

  it("recuperação: job com lease vencido é retomado; falha intermediária reenfileira com backoff e esgota em FAILED", async () => {
    await prisma.fiscalProcessingJob.deleteMany({});
    await enqueueFiscal360Jobs(prisma, [partitionJob(KOP, "2023-01")]);
    const [first] = await claimFiscal360Jobs(prisma, { workerId: "morreu", limit: 1, leaseMs: 1 });
    assert.ok(first);
    await new Promise((r) => setTimeout(r, 30));
    const [second] = await claimFiscal360Jobs(prisma, { workerId: "novo", limit: 1, leaseMs: 60_000 });
    assert.equal(second!.id, first!.id);
    assert.equal(second!.attempts, 2);
    assert.equal(await completeFiscal360Job(prisma, first!, { durationMs: 1 }), false, "token antigo não conclui o job");
    assert.equal(await completeFiscal360Job(prisma, second!, { durationMs: 1 }), true);

    await prisma.fiscalProcessingJob.create({ data: { jobType: "TIPO_INEXISTENTE", sourceEntity: "X", sourceId: "1", ruleVersion: "t", dedupeKey: "TIPO_INEXISTENTE:X:1", maxAttempts: 2, priority: 1 } });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const [job] = await claimFiscal360Jobs(prisma, { workerId: "w", limit: 1, leaseMs: 60_000 });
      assert.ok(job, `tentativa ${attempt}`);
      await assert.rejects(() => executeFiscal360Job(prisma, job!, { rules: { version: "none", rules: [] }, runId: null }));
      const outcome = await failFiscal360Job(prisma, job!, new Error("falha postgresql://u:senha@h/db"));
      assert.equal(outcome, attempt === 2 ? "FAILED" : "RETRY");
      if (attempt === 1) await prisma.fiscalProcessingJob.updateMany({ where: { dedupeKey: "TIPO_INEXISTENTE:X:1" }, data: { availableAt: new Date() } });
    }
    const dead = await prisma.fiscalProcessingJob.findFirst({ where: { dedupeKey: "TIPO_INEXISTENTE:X:1" } });
    assert.equal(dead!.status, "FAILED");
    assert.ok(!String(dead!.lastError).includes("senha"));
  });

  it("reprocessamento seletivo só enfileira o escopo pedido e exige motivo", async () => {
    await prisma.fiscalProcessingJob.deleteMany({});
    await assert.rejects(() => requestFiscal360Reprocess(prisma, { scope: "PARTITIONS", companyCnpj: KOP, fromMonth: "2026-09", toMonth: "2026-09", reason: "x" }, ACTOR), /motivo/i);
    const res = await requestFiscal360Reprocess(prisma, { scope: "PARTITIONS", companyCnpj: KOP, fromMonth: "2026-08", toMonth: "2026-09", reason: "Conferência após correção de regra" }, ACTOR);
    assert.deepEqual(res, { requested: 2, enqueued: 2 });
    const again = await requestFiscal360Reprocess(prisma, { scope: "PARTITIONS", companyCnpj: KOP, fromMonth: "2026-08", toMonth: "2026-09", reason: "Conferência após correção de regra" }, ACTOR);
    assert.equal(again.enqueued, 0, "pedido repetido não duplica a fila");
    await assert.rejects(() => requestFiscal360Reprocess(prisma, { scope: "PARTITIONS", companyCnpj: "99999999000199", fromMonth: "2026-09", reason: "Tentativa fora do grupo" }, ACTOR), /grupo/i);
  });

  it("integridade após reinício: nova conexão enxerga os mesmos fatos, snapshots e watermark; nada é reprocessado", async () => {
    await drain("final");
    const snapshotCount = await prisma.fiscalMonthlySnapshot.count();
    const sumRevenue = await prisma.fiscalMonthlySnapshot.aggregate({ where: { taxType: "*" }, _sum: { officialRevenue: true } });
    await prisma.$disconnect();
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(6) });
    assert.equal(await prisma.fiscalMonthlySnapshot.count(), snapshotCount);
    assert.equal(Number((await prisma.fiscalMonthlySnapshot.aggregate({ where: { taxType: "*" }, _sum: { officialRevenue: true } }))._sum.officialRevenue), Number(sumRevenue._sum.officialRevenue));
    const cp = await prisma.fiscalProcessingCheckpoint.findUnique({ where: { key: "nfe" } });
    assert.ok(cp?.cursorUpdatedAt && cp.lastSuccessAt);
    const jobsBefore = await prisma.fiscalProcessingJob.count();
    const restart = await runFiscal360Processing(prisma, { trigger: "CLI", workerId: "t-restart" });
    assert.equal(restart.jobsSucceeded, 0);
    assert.equal(await prisma.fiscalProcessingJob.count(), jobsBefore);
  });
});
