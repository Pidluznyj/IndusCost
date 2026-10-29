/**
 * Regressões da revisão adversarial: dupla contagem no caixa/devido, baixa sem numerário, conciliação
 * bancária parcial, título intercompany, documento de entrada, data civil de pagamento e projeções.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFiscal360ApTitleFact, type FiscalApSourceRow } from "./fiscal360ApClassifier.js";
import { FISCAL360_COMPANIES, addFiscal360Months } from "./fiscal360Constants.js";
import { buildFiscal360DocumentFact, type FiscalDocumentSourceRow } from "./fiscal360DocumentFact.js";
import { buildFiscal360Forecast, summarizeFiscal360Forecast, type ForecastHistoryRow } from "./fiscal360Forecast.js";
import { buildFiscal360Partition, detectFiscal360PossibleDuplicates, type PartitionPaymentFact } from "./fiscal360Partition.js";
import { buildFiscal360ApPaymentFact, buildFiscal360GuidePaymentFact, type FiscalApEvidence, type FiscalGuideSourceRow } from "./fiscal360PaymentFact.js";

const LAZ = FISCAL360_COMPANIES[0]!.cnpj;
const KOP = FISCAL360_COMPANIES[1]!.cnpj;

function apRow(over: Partial<FiscalApSourceRow> = {}): FiscalApSourceRow {
  return {
    id: "u", externalId: 10, classification: null, type: null, status: true, companyName: "Koppetel Comercio de Plasticos LTDA", personName: "Receita Federal",
    personCnpj: null, description: "DARF 2172 comp 09/2026", comments: null, paymentMethodName: null, documentNumber: null, dueDate: new Date("2026-10-22T00:00:00Z"),
    competenceDate: null, settlementDate: null, paymentDate: null, amountPayable: 1000, amountPaid: 0, balancePayable: 1000, suspendPayment: false, payloadHash: "h", sourcePresenceStatus: "PRESENT", ...over,
  };
}
const NO = { guideClaim: null, decision: null, rules: [], treasury: null };

function guide(over: Partial<FiscalGuideSourceRow> = {}): FiscalGuideSourceRow {
  return {
    id: "g1", taxType: "COFINS", jurisdiction: "FEDERAL", revenueCode: "2172", guideType: "DARF", guideNumber: "1", periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z"),
    dueDate: new Date("2026-10-22T00:00:00Z"), assessedAmount: 1000, creditsAmount: 0, compensationsAmount: 0, interestAmount: 0, fineAmount: 0, amountDue: 1000, amountPaid: 0, balanceDue: 1000,
    paidAt: null, status: "ISSUED", paymentAccount: null, accountsPayableExternalId: null, createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"),
    periodCompanyName: "Koppetel", proofCount: 0, ...over,
  };
}
function evidence(over: Partial<FiscalApEvidence> = {}): FiscalApEvidence {
  return { apExternalId: 10, companyCnpj: KOP, amountOriginal: 1000, amountPaid: 1000, balance: 0, effectiveStatus: "SETTLED", settledWithoutCash: false, dueDate: "2026-10-22", apPaymentDate: null, treasuryPaidDate: null, treasuryMatchCount: 0, ...over };
}
const GCTX = { ap: null, apLinkSource: "NONE" as const, apClaimLost: false, companyDecisionCnpj: null };

describe("baixa sem numerário e comprovação bancária parcial", () => {
  it("'baixa sem numerário' com valor baixado NÃO conta como pago", () => {
    const f = buildFiscal360ApTitleFact(apRow({ comments: "baixa sem numerario", amountPaid: 1000, balancePayable: 0 }), NO);
    assert.equal(f.settledWithoutCash, true);
    assert.equal(f.amountPaid, 0);
    const fact = buildFiscal360ApPaymentFact({ ...evidence({ amountPaid: f.amountPaid, settledWithoutCash: true }), taxType: "COFINS", revenueCode: "2172", competenceMonth: "2026-09", documentNumber: null });
    assert.equal(fact.paidAmount, 0);
    assert.equal(fact.status, "INSUFFICIENT_DATA");
    assert.ok(fact.flags.includes("SETTLED_WITHOUT_CASH"));
  });

  it("conciliação bancária que cobre só parte do pagamento não o torna comprovado", () => {
    const partial = buildFiscal360GuidePaymentFact(guide(), { ...GCTX, ap: evidence({ treasuryMatchCount: 1, treasuryMatchedAmount: 100, treasuryPaidDate: "2026-10-21" }), apLinkSource: "FK" });
    assert.equal(partial.evidenceLevel, "ERP_SETTLEMENT");
    assert.equal(partial.status, "PAID_ERP");
    assert.ok(partial.flags.includes("PARTIAL_BANK_MATCH"));
    const full = buildFiscal360GuidePaymentFact(guide(), { ...GCTX, ap: evidence({ treasuryMatchCount: 2, treasuryMatchedAmount: 1000 }), apLinkSource: "FK" });
    assert.equal(full.evidenceLevel, "BANK_MATCH");
    assert.equal(full.status, "PAID_PROVEN");
    const apOnly = buildFiscal360ApPaymentFact({ ...evidence({ treasuryMatchCount: 1, treasuryMatchedAmount: 10 }), taxType: "COFINS", revenueCode: null, competenceMonth: "2026-09", documentNumber: null });
    assert.equal(apOnly.evidenceLevel, "ERP_SETTLEMENT");
  });
});

describe("intercompany e empresa do documento", () => {
  it("título entre empresas do grupo com 'DARF 2089' não vira pagamento tributário por inferência", () => {
    const f = buildFiscal360ApTitleFact(apRow({ companyName: "Lazarios Comercio de Plasticos LTDA", personName: "Koppetel Comercio de Plasticos LTDA", description: "Reembolso DARF 2089 comp 09/2026" }), NO);
    assert.equal(f.isIntercompany, true);
    assert.equal(f.classification.classificationStatus, "PENDING");
    assert.equal(f.classification.rule, "INTERCOMPANY_TITLE");
    assert.equal(f.classification.suggestedTaxType, "IRPJ");
    // decisão manual explícita ainda pode promovê-lo
    const manual = buildFiscal360ApTitleFact(apRow({ companyName: "Lazarios Comercio de Plasticos LTDA", personName: "Koppetel Comercio de Plasticos LTDA", description: "Reembolso" }), {
      ...NO,
      decision: { id: "d", decisionType: "AP_CONFIRM_TAX", taxType: "IRPJ", revenueCode: null, competenceMonth: "2026-09" },
    });
    assert.equal(manual.classification.classificationStatus, "TAX");
  });

  it("NF-e de entrada emitida por empresa do grupo e recebida por outra pertence à DESTINATÁRIA", () => {
    const base: FiscalDocumentSourceRow = {
      nomusNfeId: "n", externalId: 1, chave: null, numero: "1", serie: "1", status: 4, cnpjEmitente: "72569510000195", xmlDestCnpjCpf: "14055501000180", xmlNatOp: "COMPRA", xmlTpNF: 0, isFornecedor: 1,
      tipoOperacao: 0, billingClassification: "MARKET_REVENUE", isMarketSale: false, isOfficialBilling: false, competenceMonth: "2026-09", issueDate: "2026-09-10", valorLiquido: 100, xmlVProd: 100, xmlVDesc: 0, xmlVNF: 100, payloadHash: "p",
      summary: { parserVersion: "v", source: "XML", xmlHash: "h", isCancelled: false, finalidade: 1, tpNF: 0, vProd: 100, vDesc: 0, vNF: 100, vBC: 100, vICMS: 12, vICMSDeson: null, vBCST: null, vST: null, vFCP: null, vFCPST: null, vIPI: 0, vPIS: 0, vCOFINS: 0, vISS: null, vII: null, extensibleTotals: null },
    };
    const f = buildFiscal360DocumentFact(base);
    assert.equal(f.operationClass, "INBOUND");
    assert.equal(f.companyCnpj, KOP, "crédito documental vai para quem recebeu");
  });
});

describe("data civil do pagamento", () => {
  it("pagamento registrado às 21h30 BRT de 31/10 (01/11 UTC) fica em outubro", () => {
    const f = buildFiscal360GuidePaymentFact(guide({ amountPaid: 1000, paidAt: new Date("2026-11-01T00:30:00Z") }), GCTX);
    assert.equal(f.paidAt, "2026-10-31");
    assert.equal(f.paidMonth, "2026-10");
  });
});

function pay(over: Partial<PartitionPaymentFact> = {}): PartitionPaymentFact {
  return { id: "p", anchorKey: "GUIDE:g", anchorType: "GUIDE", guideId: "g", apExternalId: null, companyCnpj: KOP, taxType: "PIS", competenceMonth: "2026-09", dueDate: "2026-10-20", amountDue: 1000, paidAmount: 1000, openBalance: 0, paidMonth: "2026-10", status: "PAID_DECLARED", evidenceLevel: "MANUAL_DECLARED", linkState: "GUIDE_ONLY", proofCount: 0, hasBankMatch: false, flags: [], countsInPaidTotals: true, ...over };
}
const apFact = (over: Partial<PartitionPaymentFact> = {}) => pay({ id: "a", anchorKey: "AP:10", anchorType: "AP_TITLE", guideId: null, apExternalId: 10, linkState: "AP_ONLY", evidenceLevel: "ERP_SETTLEMENT", status: "PAID_ERP", ...over });
const part = (over: Partial<Parameters<typeof buildFiscal360Partition>[0]> = {}): Parameters<typeof buildFiscal360Partition>[0] => ({
  companyCnpj: KOP, month: "2026-09", docTaxes: [], docs: [], payments: [], cashPayments: [], apuration: [], pendingAp: [], intercompanyDocs: [], intercompanyAp: [], distinctPairs: [], acceptedItemKeys: [], openIssueCount: 0, ...over,
});

describe("duplicidade entre competências e dupla contagem de devido/saldo", () => {
  it("guia (08/2026) e título (09/2026) do mesmo imposto, pagos no mesmo mês, com 2% de juros, são suspeita de duplicidade", () => {
    const g = pay({ competenceMonth: "2026-08", paidAmount: 1000 });
    const a = apFact({ competenceMonth: "2026-09", paidAmount: 1020, amountDue: 1020 });
    assert.equal(detectFiscal360PossibleDuplicates([g, a], []).length, 1);
    assert.equal(detectFiscal360PossibleDuplicates([g, apFact({ competenceMonth: "2026-11", paidMonth: "2026-12", paidAmount: 1000 })], []).length, 0, "meses distantes não casam");
    assert.equal(detectFiscal360PossibleDuplicates([g, apFact({ paidAmount: 1500, amountDue: 1500 })], []).length, 0, "valor muito diferente não casa");
    assert.equal(detectFiscal360PossibleDuplicates([g, apFact({ companyCnpj: LAZ })], []).length, 0, "empresas diferentes não casam");
  });

  it("obrigação em revisão não repete devido nem saldo; pago em revisão fica separado", () => {
    const g = pay({ openBalance: 0 });
    const a = apFact();
    const r = buildFiscal360Partition(part({ payments: [g, a], pool: [g, a], cashPayments: [] }));
    const total = r.snapshots.find((s) => s.taxType === "*")!;
    assert.equal(total.obligationAmountDue, 1000, "uma obrigação de 1000, não 2000");
    assert.equal(total.paidAmount, 1000);
    assert.equal(total.reviewAmount, 1000);
    assert.equal(r.items.filter((i) => i.checkType === "POSSIBLE_DUPLICATE").length, 1);
  });

  it("corrida de caixa: ao colocar um fato em revisão, o mês de pagamento é reenfileirado e a partição de caixa respeita o flag persistido", () => {
    const g = pay({ competenceMonth: "2026-09", paidMonth: "2026-10" });
    const a = apFact({ competenceMonth: "2026-09", paidMonth: "2026-10" });
    const comp = buildFiscal360Partition(part({ payments: [g, a], pool: [g, a] }));
    assert.deepEqual(comp.affectedPartitions, [{ companyCnpj: KOP, month: "2026-10" }]);
    // Partição de caixa (2026-10) com o flag JÁ decidido: conta uma vez.
    const decided = { ...g, countsInPaidTotals: false };
    const cash = buildFiscal360Partition(part({ month: "2026-10", payments: [], cashPayments: [decided, a] }));
    assert.equal(cash.snapshots.find((s) => s.taxType === "*")!.paidByCashDateAmount, 1000);
    // Antes da decisão (flag ainda true) mostraria 2000 — por isso a repartição é enfileirada.
    const stale = buildFiscal360Partition(part({ month: "2026-10", payments: [], cashPayments: [g, a] }));
    assert.equal(stale.snapshots.find((s) => s.taxType === "*")!.paidByCashDateAmount, 2000);
  });

  it("partição que só VÊ a duplicidade pelo pool não duplica o item de conciliação em outras competências", () => {
    const g = pay({ competenceMonth: "2026-08", paidMonth: "2026-10", id: "g8" });
    const a = apFact({ competenceMonth: "2026-09", paidMonth: "2026-10" });
    const rep = a; // o fato em revisão é o do mês 09 ou 08, conforme a evidência
    const m8 = buildFiscal360Partition(part({ month: "2026-08", payments: [g], pool: [g, a] }));
    const m9 = buildFiscal360Partition(part({ month: "2026-09", payments: [a], pool: [g, a] }));
    assert.ok(rep);
    const reviewed = [m8, m9].flatMap((r) => r.items).filter((i) => i.checkType === "POSSIBLE_DUPLICATE");
    assert.equal(reviewed.length, 1, "o item existe só na partição do fato em revisão");
  });
});

describe("projeção", () => {
  function hist(): ForecastHistoryRow[] {
    const rows: ForecastHistoryRow[] = [];
    for (let i = 1; i <= 14; i += 1) {
      const month = addFiscal360Months("2026-12", -i);
      rows.push({ companyCnpj: KOP, month, taxType: "*", officialRevenue: 100_000, apurationAmountDue: 0, obligationAmountDue: 0 });
      if (["2025-12", "2026-03", "2026-06", "2026-09"].includes(month)) rows.push({ companyCnpj: KOP, month, taxType: "IRPJ", officialRevenue: 0, apurationAmountDue: 3000, obligationAmountDue: 3000 });
    }
    return rows;
  }
  const A = { revenueGrowthPct: 0, revenueShiftPct: 0, ratioPercentile: "MEDIAN" as const, purchasesShiftPct: 0, paymentLagMonths: null, horizonMonths: 6 };

  it("tributo trimestral usa a receita REALIZADA dos meses anteriores à referência (≈ 3000, não 1000)", () => {
    const rows = buildFiscal360Forecast({ referenceMonth: "2026-12", history: hist(), openObligations: [], lagSamples: [], parameters: [], assumptions: A });
    const dec = rows.find((r) => r.taxType === "IRPJ" && r.month === "2026-12");
    assert.ok(dec && dec.availability === "AVAILABLE");
    assert.ok(Math.abs((dec.amount ?? 0) - 3000) < 300, `esperado ≈ 3000, veio ${dec.amount}`);
  });

  it("atrasos já vencidos entram no desembolso, não em 'tributos devidos' nem na carga", () => {
    const rows = buildFiscal360Forecast({
      referenceMonth: "2026-12",
      history: hist(),
      openObligations: [
        { companyCnpj: KOP, taxType: "COFINS", competenceMonth: "2026-09", dueDate: "2026-10-22", openBalance: 5000, anchorKey: "GUIDE:a" },
        { companyCnpj: KOP, taxType: "COFINS", competenceMonth: "2026-11", dueDate: "2026-12-22", openBalance: 2000, anchorKey: "GUIDE:b" },
      ],
      lagSamples: [],
      parameters: [],
      assumptions: A,
    });
    const horizon = Array.from({ length: 6 }, (_, i) => addFiscal360Months("2026-12", i));
    const e = summarizeFiscal360Forecast(rows.filter((r) => r.taxType === "COFINS"), horizon);
    assert.equal(e.arrears, 5000);
    assert.equal(e.cashOut, 7000);
    assert.equal(e.taxesDue, 2000);
  });
});
