/**
 * Inteligência Fiscal 360° — testes unitários dos motores puros (documento, AP, pagamento, partição,
 * projeção), filtros e utilidades de fila. Sem banco.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFiscal360ApTitleFact, classifyFiscal360ApTitle, type FiscalApSourceRow } from "./fiscal360ApClassifier.js";
import { FISCAL360_COMPANIES, addFiscal360Months, fiscal360MonthRange, resolveFiscal360GroupCnpj } from "./fiscal360Constants.js";
import { buildFiscal360DocumentFact, classifyFiscal360Operation, type FiscalDocumentSourceRow } from "./fiscal360DocumentFact.js";
import { buildFiscal360Forecast, sanitizeForecastAssumptions, summarizeFiscal360Forecast, type ForecastHistoryRow } from "./fiscal360Forecast.js";
import { buildFiscal360Partition, detectFiscal360PossibleDuplicates, type PartitionPaymentFact } from "./fiscal360Partition.js";
import {
  buildFiscal360ApPaymentFact,
  buildFiscal360GuidePaymentFact,
  effectiveFiscal360PaymentStatus,
  type FiscalApEvidence,
  type FiscalGuideSourceRow,
} from "./fiscal360PaymentFact.js";
import { fiscal360DedupeKey, fiscal360Hash, sanitizeFiscal360Error } from "./fiscal360Queue.server.js";
import { Fiscal360InputError, parseFiscal360Filters } from "./fiscal360QueryService.server.js";
import { validateFiscal360RuleParameters } from "./fiscal360WriteService.server.js";

const LAZ = FISCAL360_COMPANIES[0]!.cnpj;
const KOP = FISCAL360_COMPANIES[1]!.cnpj;

function summary(over: Partial<NonNullable<FiscalDocumentSourceRow["summary"]>> = {}): NonNullable<FiscalDocumentSourceRow["summary"]> {
  return {
    parserVersion: "nfe-xml-fiscal-v1",
    source: "XML",
    xmlHash: "h",
    isCancelled: false,
    finalidade: 1,
    tpNF: 1,
    vProd: 1000,
    vDesc: 0,
    vNF: 1000,
    vBC: 1000,
    vICMS: 120,
    vICMSDeson: null,
    vBCST: null,
    vST: null,
    vFCP: null,
    vFCPST: null,
    vIPI: 0,
    vPIS: 16.5,
    vCOFINS: 76,
    vISS: null,
    vII: null,
    extensibleTotals: null,
    ...over,
  };
}

function doc(over: Partial<FiscalDocumentSourceRow> = {}): FiscalDocumentSourceRow {
  return {
    nomusNfeId: "n1",
    externalId: 1,
    chave: "k",
    numero: "100",
    serie: "1",
    status: 4,
    cnpjEmitente: "14.055.501/0001-80",
    xmlDestCnpjCpf: "11222333000181",
    xmlNatOp: "VENDA DE PRODUCAO",
    xmlTpNF: 1,
    isFornecedor: 0,
    tipoOperacao: 1,
    billingClassification: "MARKET_REVENUE",
    isMarketSale: true,
    isOfficialBilling: true,
    competenceMonth: "2026-09",
    issueDate: "2026-09-10",
    valorLiquido: 1000,
    xmlVProd: 1000,
    xmlVDesc: 0,
    xmlVNF: 1000,
    payloadHash: "p",
    summary: summary(),
    ...over,
  };
}

describe("documento fiscal (camada A)", () => {
  it("NF-e autorizada de mercado entra no faturamento oficial e no destacado", () => {
    const f = buildFiscal360DocumentFact(doc());
    assert.equal(f.companyCnpj, KOP);
    assert.equal(f.operationClass, "MARKET_SALE");
    assert.equal(f.officialRevenueAmount, 1000);
    assert.equal(f.highlightedTaxTotal, 212.5);
    assert.equal(f.fiscalStatus, "AUTHORIZED");
  });

  it("NF-e cancelada: sem receita e sem tributo destacado efetivo (rastro preservado)", () => {
    const f = buildFiscal360DocumentFact(doc({ status: 7, isOfficialBilling: false, summary: summary({ isCancelled: true }) }));
    assert.equal(f.fiscalStatus, "CANCELLED");
    assert.equal(f.officialRevenueAmount, 0);
    assert.equal(f.highlightedTaxTotal, 0);
    assert.ok(f.taxes.length > 0);
  });

  it("nota intercompany: fora do faturamento externo, destinatário do grupo identificado", () => {
    const f = buildFiscal360DocumentFact(doc({ isOfficialBilling: false, isMarketSale: false, billingClassification: "INTERCOMPANY", xmlDestCnpjCpf: LAZ, cnpjEmitente: KOP }));
    assert.equal(f.operationClass, "INTERCOMPANY");
    assert.equal(f.officialRevenueAmount, 0);
    assert.equal(f.recipientGroupCnpj, LAZ);
    assert.ok(f.highlightedTaxTotal > 0, "tributo efetivo continua documentado");
  });

  it("operação logística (remessa/retorno/devolução) não é receita", () => {
    for (const [nat, cls] of [["REMESSA PARA INDUSTRIALIZACAO", "REMESSA"], ["RETORNO DE INDUSTRIALIZACAO", "RETORNO"], ["DEVOLUCAO DE VENDA", "DEVOLUCAO"], ["BRINDE", "BONIFICACAO"]] as const) {
      const f = buildFiscal360DocumentFact(doc({ isOfficialBilling: false, isMarketSale: false, billingClassification: "LOGISTICS_NOT_REVENUE", xmlNatOp: nat }));
      assert.equal(f.operationClass, cls);
      assert.equal(f.officialRevenueAmount, 0);
    }
  });

  it("documento sem XML processado: sem tributos e com alerta", () => {
    const f = buildFiscal360DocumentFact(doc({ summary: null }));
    assert.equal(f.xmlStatus, "NOT_PARSED");
    assert.equal(f.taxes.length, 0);
    assert.ok(f.qualityFlags.includes("XML_NOT_PARSED"));
  });

  it("XML parcial é sinalizado; tributos ausentes não viram zero silencioso", () => {
    const partial = buildFiscal360DocumentFact(doc({ summary: summary({ source: "PARTIAL" }) }));
    assert.ok(partial.qualityFlags.includes("XML_PARTIAL"));
    const empty = buildFiscal360DocumentFact(doc({ summary: summary({ vICMS: null, vPIS: null, vCOFINS: null, vIPI: null, vBC: null }) }));
    assert.ok(empty.qualityFlags.includes("NO_HEADER_TAXES"));
  });

  it("ICMS-ST, desonerado e IBS/CBS ficam separados do destacado efetivo; entrada vira crédito documental", () => {
    const f = buildFiscal360DocumentFact(doc({ summary: summary({ vST: 50, vICMSDeson: 30, extensibleTotals: { vIBS: 10, vCBS: 5 } }) }));
    const effects = Object.fromEntries(f.taxes.map((t) => [t.taxType, t.effect]));
    assert.equal(effects.ICMS_ST, "ST");
    assert.equal(effects.ICMS_DESON, "DESONERATED");
    assert.equal(effects.IBS, "INFORMATIVE");
    assert.equal(effects.CBS, "INFORMATIVE");
    assert.equal(f.highlightedTaxTotal, 212.5);
    const inbound = buildFiscal360DocumentFact(doc({ xmlTpNF: 0, isOfficialBilling: false, cnpjEmitente: "99999999000199", xmlDestCnpjCpf: KOP, summary: summary({ tpNF: 0 }) }));
    assert.equal(inbound.operationClass, "INBOUND");
    assert.equal(inbound.companyCnpj, KOP);
    assert.ok(inbound.taxes.every((t) => t.effect !== "DEBIT"));
    assert.equal(inbound.highlightedTaxTotal, 0);
  });

  it("faturamento oficial prevalece sobre a heurística de natureza", () => {
    assert.equal(classifyFiscal360Operation({ isOfficialBilling: true, billingClassification: "MARKET_REVENUE", natOp: "REMESSA", tpNF: 1, isFornecedor: 0, finalidade: 1 }), "MARKET_SALE");
  });
});

function ap(over: Partial<FiscalApSourceRow> = {}): FiscalApSourceRow {
  return {
    id: "u1",
    externalId: 10,
    classification: null,
    type: null,
    status: true,
    companyName: "Koppetel Comercio de Plasticos LTDA",
    personName: "Fornecedor X",
    personCnpj: null,
    description: "Compra de material",
    comments: null,
    paymentMethodName: null,
    documentNumber: null,
    dueDate: new Date("2026-10-20T00:00:00Z"),
    competenceDate: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    suspendPayment: false,
    payloadHash: "h",
    sourcePresenceStatus: "PRESENT",
    ...over,
  };
}
const NO_CTX = { guideClaim: null, decision: null, rules: [] };

describe("classificação de títulos do contas a pagar", () => {
  it("a palavra 'imposto' sozinha nunca vira tributo — fica pendente", () => {
    const c = classifyFiscal360ApTitle(ap({ description: "Pagamento de imposto" }), NO_CTX);
    assert.equal(c.classificationStatus, "PENDING");
    assert.equal(c.taxType, null);
  });

  it("título comum não é tributo", () => {
    assert.equal(classifyFiscal360ApTitle(ap({ description: "Compra das peças de reposição" }), NO_CTX).classificationStatus, "NOT_TAX");
  });

  it("DARF com código de receita conhecido + órgão arrecadador = tributo com confiança alta", () => {
    const c = classifyFiscal360ApTitle(ap({ personName: "Receita Federal", description: "DARF cód. receita 2172 competência 09/2026" }), NO_CTX);
    assert.equal(c.classificationStatus, "TAX");
    assert.equal(c.taxType, "COFINS");
    assert.equal(c.revenueCode, "2172");
    assert.equal(c.confidence, "HIGH");
  });

  it("citar um tributo no texto, sem órgão ou código, é só sugestão (pendente)", () => {
    const c = classifyFiscal360ApTitle(ap({ description: "ICMS referente a setembro" }), NO_CTX);
    assert.equal(c.classificationStatus, "PENDING");
    assert.equal(c.suggestedTaxType, "ICMS");
  });

  it("tributos ambíguos não classificam", () => {
    const c = classifyFiscal360ApTitle(ap({ personName: "Receita Federal", description: "PIS e COFINS" }), NO_CTX);
    assert.equal(c.classificationStatus, "PENDING");
    assert.equal(c.rule, "AMBIGUOUS_TAX_TOKENS");
  });

  it("vínculo com guia, regra configurada e decisão manual são evidências fortes e a decisão prevalece", () => {
    assert.equal(classifyFiscal360ApTitle(ap(), { ...NO_CTX, guideClaim: { guideId: "g", taxType: "ICMS", source: "FK" } }).classificationStatus, "TAX");
    const rule = { id: "r1", field: "classification" as const, match: "equals" as const, value: "Impostos Federais - COFINS", outcome: "TAX" as const, taxType: "COFINS" };
    assert.equal(classifyFiscal360ApTitle(ap({ classification: "IMPOSTOS FEDERAIS - COFINS" }), { ...NO_CTX, rules: [rule] }).taxType, "COFINS");
    const reject = classifyFiscal360ApTitle(ap(), { guideClaim: { guideId: "g", taxType: "ICMS", source: "FK" }, decision: { id: "d", decisionType: "AP_REJECT_TAX", taxType: null, revenueCode: null, competenceMonth: null }, rules: [] });
    assert.equal(reject.classificationStatus, "NOT_TAX");
  });

  it("fato do título: intercompany, cancelado, baixa sem numerário e competência pelo texto", () => {
    const base = { ...NO_CTX, treasury: null };
    const ic = buildFiscal360ApTitleFact(ap({ companyName: "Lazarios Comercio de Plasticos LTDA", personName: "Koppetel Comercio de Plasticos LTDA" }), base);
    assert.equal(ic.isIntercompany, true);
    assert.equal(ic.intercompanyCounterpartyCnpj, KOP);
    const cancelled = buildFiscal360ApTitleFact(ap({ description: "cancelado DARF 2172", amountPaid: 500 }), base);
    assert.equal(cancelled.effectiveStatus, "CANCELLED");
    assert.equal(cancelled.amountPaid, 0);
    const text = buildFiscal360ApTitleFact(ap({ description: "DARF 2172 comp 08/2026", personName: "Receita Federal" }), base);
    assert.equal(text.competenceMonth, "2026-08");
    const wo = buildFiscal360ApTitleFact(ap({ comments: "baixa sem numerario", balancePayable: 0, amountPaid: 0 }), base);
    assert.equal(wo.settledWithoutCash, true);
    assert.equal(wo.amountPaid, 0);
  });
});

function guide(over: Partial<FiscalGuideSourceRow> = {}): FiscalGuideSourceRow {
  return {
    id: "g1",
    taxType: "COFINS",
    jurisdiction: "FEDERAL",
    revenueCode: "2172",
    guideType: "DARF",
    guideNumber: "0421",
    periodStart: new Date("2026-09-01T00:00:00Z"),
    periodEnd: new Date("2026-09-30T00:00:00Z"),
    dueDate: new Date("2026-10-22T00:00:00Z"),
    assessedAmount: 1000,
    creditsAmount: 0,
    compensationsAmount: 0,
    interestAmount: 0,
    fineAmount: 0,
    amountDue: 1000,
    amountPaid: 0,
    balanceDue: 1000,
    paidAt: null,
    status: "ISSUED",
    paymentAccount: null,
    accountsPayableExternalId: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    periodCompanyName: "Koppetel",
    proofCount: 0,
    ...over,
  };
}
function apEv(over: Partial<FiscalApEvidence> = {}): FiscalApEvidence {
  return { apExternalId: 10, companyCnpj: KOP, amountOriginal: 1000, amountPaid: 1000, balance: 0, effectiveStatus: "SETTLED", settledWithoutCash: false, dueDate: "2026-10-22", apPaymentDate: null, treasuryPaidDate: null, treasuryMatchCount: 0, ...over };
}
const GCTX = { ap: null, apLinkSource: "NONE" as const, apClaimLost: false, companyDecisionCnpj: null };

describe("pagamento fiscal (camada C)", () => {
  it("guia em aberto: obrigação aberta, sem pago; vencida só é derivada na leitura", () => {
    const f = buildFiscal360GuidePaymentFact(guide(), GCTX);
    assert.equal(f.status, "OPEN");
    assert.equal(f.paidAmount, 0);
    assert.equal(f.openBalance, 1000);
    assert.equal(f.companyCnpj, KOP);
    assert.equal(effectiveFiscal360PaymentStatus(f.status, f.dueDate, f.openBalance, "2026-10-30"), "OVERDUE");
    assert.equal(effectiveFiscal360PaymentStatus(f.status, f.dueDate, f.openBalance, "2026-10-01"), "OPEN");
  });

  it("pagamento integral via AP vinculado: baixa no ERP (não comprovado) com fonte única", () => {
    const f = buildFiscal360GuidePaymentFact(guide({ accountsPayableExternalId: 10, amountPaid: 1000 }), { ...GCTX, ap: apEv(), apLinkSource: "FK" });
    assert.equal(f.status, "PAID_ERP");
    assert.equal(f.paidAmount, 1000);
    assert.equal(f.paidSource, "AP_LINK");
    assert.equal(f.evidenceLevel, "ERP_SETTLEMENT");
    assert.equal(f.apExternalId, 10);
  });

  it("comprovante documental ou conciliação bancária elevam a evidência; a data de caixa vem da Tesouraria", () => {
    const proof = buildFiscal360GuidePaymentFact(guide({ proofCount: 1 }), { ...GCTX, ap: apEv(), apLinkSource: "FK" });
    assert.equal(proof.status, "PAID_PROVEN");
    const bank = buildFiscal360GuidePaymentFact(guide(), { ...GCTX, ap: apEv({ treasuryMatchCount: 1, treasuryMatchedAmount: 1000, treasuryPaidDate: "2026-10-21", apPaymentDate: "2026-10-23" }), apLinkSource: "FK" });
    assert.equal(bank.evidenceLevel, "BANK_MATCH");
    assert.equal(bank.paidAt, "2026-10-21");
    assert.equal(bank.paidAtSource, "TREASURY");
    assert.equal(bank.paidMonth, "2026-10");
  });

  it("pagamento parcial; valor só declarado na guia é 'declarado', nunca comprovado", () => {
    const partial = buildFiscal360GuidePaymentFact(guide(), { ...GCTX, ap: apEv({ amountPaid: 400, balance: 600 }), apLinkSource: "FK" });
    assert.equal(partial.status, "PARTIAL");
    assert.equal(partial.openBalance, 600);
    const declared = buildFiscal360GuidePaymentFact(guide({ amountPaid: 1000, paidAt: new Date("2026-10-20T00:00:00Z") }), GCTX);
    assert.equal(declared.status, "PAID_DECLARED");
    assert.equal(declared.evidenceLevel, "MANUAL_DECLARED");
  });

  it("estorno e guia cancelada não contam como pago e não duplicam a operação original", () => {
    const reversed = buildFiscal360GuidePaymentFact(guide({ status: "REVERSED", amountPaid: 0 }), { ...GCTX, ap: apEv(), apLinkSource: "FK" });
    assert.equal(reversed.status, "REVERSED");
    assert.equal(reversed.paidAmount, 0);
    assert.equal(reversed.openBalance, 1000);
    const cancelled = buildFiscal360GuidePaymentFact(guide({ status: "CANCELLED" }), GCTX);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.openBalance, 0);
  });

  it("título AP tributário sem guia gera UMA obrigação ancorada no título", () => {
    const f = buildFiscal360ApPaymentFact({ ...apEv({ treasuryMatchCount: 0 }), taxType: "ICMS", revenueCode: null, competenceMonth: "2026-09", documentNumber: null });
    assert.equal(f.anchorKey, "AP:10");
    assert.equal(f.linkState, "AP_ONLY");
    assert.equal(f.paidSource, "AP_TITLE");
    assert.equal(f.paidAmount, 1000);
  });

  it("vínculo duplicado: a guia que perdeu o título não conta pago e não reutiliza a evidência", () => {
    const f = buildFiscal360GuidePaymentFact(guide({ accountsPayableExternalId: 10 }), { ...GCTX, ap: apEv(), apLinkSource: "FK", apClaimLost: true });
    assert.equal(f.countsInPaidTotals, false);
    assert.equal(f.paidAmount, 0);
    assert.ok(f.flags.includes("DUPLICATE_AP_LINK"));
  });

  it("empresa da guia: período › AP › decisão; sem nada fica pendente (nunca assume)", () => {
    assert.equal(buildFiscal360GuidePaymentFact(guide({ periodCompanyName: null }), GCTX).companyCnpj, "UNKNOWN");
    assert.equal(buildFiscal360GuidePaymentFact(guide({ periodCompanyName: null }), { ...GCTX, companyDecisionCnpj: LAZ }).companyCnpj, LAZ);
    assert.equal(buildFiscal360GuidePaymentFact(guide({ periodCompanyName: null }), { ...GCTX, ap: apEv(), apLinkSource: "FK" }).companyResolution, "AP");
  });

  it("mudança de competência: a partição antiga e a nova são ambas afetadas", () => {
    const f = buildFiscal360GuidePaymentFact(guide(), { ...GCTX, ap: apEv({ treasuryMatchCount: 1, treasuryPaidDate: "2026-11-02" }), apLinkSource: "FK" });
    assert.equal(f.competenceMonth, "2026-09");
    assert.equal(f.paidMonth, "2026-11");
  });
});

function pay(over: Partial<PartitionPaymentFact> = {}): PartitionPaymentFact {
  return { id: "p1", anchorKey: "GUIDE:g1", anchorType: "GUIDE", guideId: "g1", apExternalId: null, companyCnpj: KOP, taxType: "COFINS", competenceMonth: "2026-09", dueDate: "2026-10-22", amountDue: 1000, paidAmount: 1000, openBalance: 0, paidMonth: "2026-10", status: "PAID_DECLARED", evidenceLevel: "MANUAL_DECLARED", linkState: "GUIDE_ONLY", proofCount: 0, hasBankMatch: false, flags: [], countsInPaidTotals: true, ...over };
}
function part(over: Partial<Parameters<typeof buildFiscal360Partition>[0]> = {}): Parameters<typeof buildFiscal360Partition>[0] {
  return { companyCnpj: KOP, month: "2026-09", docTaxes: [], docs: [], payments: [], cashPayments: [], apuration: [], pendingAp: [], intercompanyDocs: [], intercompanyAp: [], distinctPairs: [], acceptedItemKeys: [], openIssueCount: 0, ...over };
}

describe("partição: conciliação e snapshot", () => {
  it("mesmo tributo em guia e em título AP sem vínculo conta UMA vez (evidência mais forte prevalece)", () => {
    const g = pay();
    const a = pay({ id: "p2", anchorKey: "AP:10", anchorType: "AP_TITLE", guideId: null, apExternalId: 10, linkState: "AP_ONLY", evidenceLevel: "ERP_SETTLEMENT" });
    const dup = detectFiscal360PossibleDuplicates([g, a], []);
    assert.equal(dup.length, 1);
    assert.equal(dup[0]!.keep.anchorKey, "AP:10");
    const r = buildFiscal360Partition(part({ payments: [g, a], cashPayments: [g, a] }));
    const total = r.snapshots.find((s) => s.taxType === "*")!;
    assert.equal(total.paidAmount, 1000, "total pago não aumenta por haver duas fontes");
    assert.equal(total.reviewAmount, 1000);
    assert.equal(r.paymentReviews.find((x) => x.id === "p1")?.countsInPaidTotals, false);
    assert.ok(r.items.some((i) => i.checkType === "POSSIBLE_DUPLICATE" && i.status === "REVIEW"));
  });

  it("decisão 'obrigações distintas' desfaz a suspeita; divergência aceita muda o status do item", () => {
    const g = pay();
    const a = pay({ id: "p2", anchorKey: "AP:10", anchorType: "AP_TITLE", guideId: null, apExternalId: 10, linkState: "AP_ONLY", evidenceLevel: "ERP_SETTLEMENT" });
    assert.equal(detectFiscal360PossibleDuplicates([g, a], [{ guideId: "g1", apExternalId: 10 }]).length, 0);
    const r = buildFiscal360Partition(part({ payments: [pay({ paidAmount: 0, openBalance: 1000, status: "OPEN", evidenceLevel: "NONE" })] }));
    const gw = r.items.find((i) => i.checkType === "GUIDE_WITHOUT_AP")!;
    const accepted = buildFiscal360Partition(part({ payments: [pay({ paidAmount: 0, openBalance: 1000, status: "OPEN", evidenceLevel: "NONE" })], acceptedItemKeys: [gw.itemKey] }));
    assert.equal(accepted.items.find((i) => i.itemKey === gw.itemKey)!.status, "ACCEPTED");
  });

  it("separa pago comprovado, baixa sem comprovação e declarado; caixa × competência não se misturam", () => {
    const proven = pay({ id: "a", anchorKey: "GUIDE:a", guideId: "a", taxType: "ICMS", paidAmount: 500, evidenceLevel: "BANK_MATCH", paidMonth: "2026-10", linkState: "GUIDE_WITH_AP", apExternalId: 1 });
    const erp = pay({ id: "b", anchorKey: "GUIDE:b", guideId: "b", taxType: "ICMS", paidAmount: 300, evidenceLevel: "ERP_SETTLEMENT", paidMonth: null, linkState: "GUIDE_WITH_AP", apExternalId: 2 });
    const decl = pay({ id: "c", anchorKey: "GUIDE:c", guideId: "c", taxType: "PIS", paidAmount: 200, evidenceLevel: "MANUAL_DECLARED", paidMonth: "2026-10" });
    const sep = buildFiscal360Partition(part({ payments: [proven, erp, decl], cashPayments: [] }));
    const t = sep.snapshots.find((s) => s.taxType === "*")!;
    assert.equal(t.paidAmount, 1000);
    assert.equal(t.paidProvenAmount, 500);
    assert.equal(t.paidUnprovenAmount, 300);
    assert.equal(t.paidDeclaredAmount, 200);
    assert.equal(t.paidWithoutCashDateAmount, 300);
    const cash = buildFiscal360Partition(part({ month: "2026-10", payments: [], cashPayments: [proven, decl] }));
    assert.equal(cash.snapshots.find((s) => s.taxType === "*")!.paidByCashDateAmount, 700);
  });

  it("apuração × guias: divergência, competência sem fechamento e créditos", () => {
    const line = { periodId: "per", periodStatus: "OPEN", taxType: "COFINS", nature: "DEBIT", assessedAmount: 1200, creditsAmount: 100, compensationsAmount: 0, amountDue: 1100 };
    const r = buildFiscal360Partition(part({ apuration: [line], payments: [pay({ paidAmount: 0, openBalance: 1000, status: "OPEN", evidenceLevel: "NONE" })] }));
    assert.equal(r.items.find((i) => i.checkType === "APURATION_VS_GUIDE")!.status, "DIVERGENT");
    assert.ok(r.items.some((i) => i.checkType === "COMPETENCE_WITHOUT_CLOSING"));
    assert.equal(r.items.find((i) => i.checkType === "CREDITS_UNRECONCILED")!.status, "REVIEW");
    const row = r.snapshots.find((s) => s.taxType === "COFINS")!;
    assert.equal(row.apurationAmountDue, 1100);
    assert.equal(row.apurationStatus, "OPEN");
  });

  it("receita consolidada só conta faturamento oficial; intercompany fica à parte; cancelada não soma", () => {
    const r = buildFiscal360Partition(
      part({
        docs: [
          { operationClass: "MARKET_SALE", fiscalStatus: "AUTHORIZED", xmlStatus: "XML", count: 2, officialCount: 2, officialRevenue: 3000, valorLiquido: 3000, vNF: 3100 },
          { operationClass: "INTERCOMPANY", fiscalStatus: "AUTHORIZED", xmlStatus: "XML", count: 1, officialCount: 0, officialRevenue: 0, valorLiquido: 800, vNF: 800 },
          { operationClass: "MARKET_SALE", fiscalStatus: "CANCELLED", xmlStatus: "XML", count: 1, officialCount: 0, officialRevenue: 0, valorLiquido: 500, vNF: 500 },
          { operationClass: "REMESSA", fiscalStatus: "AUTHORIZED", xmlStatus: "MISSING", count: 1, officialCount: 0, officialRevenue: 0, valorLiquido: 100, vNF: 100 },
        ],
        docTaxes: [
          { taxType: "ICMS", effect: "DEBIT", operationClass: "MARKET_SALE", fiscalStatus: "AUTHORIZED", amount: 360 },
          { taxType: "ICMS", effect: "DEBIT", operationClass: "INTERCOMPANY", fiscalStatus: "AUTHORIZED", amount: 96 },
          { taxType: "ICMS", effect: "DEBIT", operationClass: "MARKET_SALE", fiscalStatus: "CANCELLED", amount: 60 },
          { taxType: "ICMS", effect: "ST", operationClass: "MARKET_SALE", fiscalStatus: "AUTHORIZED", amount: 40 },
        ],
      })
    );
    const total = r.snapshots.find((s) => s.taxType === "*")!;
    assert.equal(total.officialRevenue, 3000);
    assert.equal(total.intercompanyRevenue, 800);
    assert.equal(total.cancelledDocumentCount, 1);
    assert.equal(total.missingXmlCount, 1);
    const icms = r.snapshots.find((s) => s.taxType === "ICMS")!;
    assert.equal(icms.highlightedAmount, 456);
    assert.equal(icms.highlightedMarketAmount, 360);
    assert.equal(icms.highlightedIntercompanyAmount, 96);
    assert.equal(icms.stAmount, 40);
  });

  it("intercompany: documento × AP por par, divergência indicativa", () => {
    const r = buildFiscal360Partition(
      part({ intercompanyDocs: [{ recipientCnpj: LAZ, count: 2, documentValue: 5000, highlightedTax: 600 }], intercompanyAp: [{ payerCnpj: LAZ, count: 1, amount: 4800, paid: 4800, open: 0 }] })
    );
    assert.equal(r.intercompany.length, 1);
    assert.equal(r.intercompany[0]!.divergenceAmount, 200);
    assert.equal(r.intercompany[0]!.issuerCnpj, KOP);
  });

  it("partição vazia não gera linhas inventadas e é determinística (mesma entrada → mesma saída)", () => {
    const a = buildFiscal360Partition(part());
    const b = buildFiscal360Partition(part());
    assert.deepEqual(a, b);
    assert.equal(a.items.length, 0);
  });
});

function history(): ForecastHistoryRow[] {
  const rows: ForecastHistoryRow[] = [];
  for (let i = 1; i <= 14; i += 1) {
    const month = addFiscal360Months("2026-11", -i);
    rows.push({ companyCnpj: KOP, month, taxType: "*", officialRevenue: 1_000_000, apurationAmountDue: 0, obligationAmountDue: 0 });
    rows.push({ companyCnpj: KOP, month, taxType: "COFINS", officialRevenue: 0, apurationAmountDue: 76_000, obligationAmountDue: 76_000 });
    rows.push({ companyCnpj: KOP, month, taxType: "PIS", officialRevenue: 0, apurationAmountDue: 16_500, obligationAmountDue: 16_500 });
  }
  return rows;
}
const BASE = { revenueGrowthPct: 0, revenueShiftPct: 0, ratioPercentile: "MEDIAN" as const, purchasesShiftPct: 0, paymentLagMonths: null, horizonMonths: 6 };

describe("projeções por CNPJ e tributo", () => {
  it("usa razão histórica POR tributo (não percentual único) e persiste intervalo e metodologia", () => {
    const rows = buildFiscal360Forecast({ referenceMonth: "2026-11", history: history(), openObligations: [], lagSamples: [], parameters: [], assumptions: BASE });
    const cofins = rows.find((r) => r.taxType === "COFINS" && r.month === "2026-11")!;
    const pis = rows.find((r) => r.taxType === "PIS" && r.month === "2026-11")!;
    assert.equal(cofins.kind, "ESTIMATED");
    assert.ok(Math.abs((cofins.ratioUsed ?? 0) - 0.076) < 1e-6);
    assert.ok(Math.abs((pis.ratioUsed ?? 0) - 0.0165) < 1e-6);
    assert.notEqual(cofins.amount, pis.amount);
    assert.ok(cofins.methodology.includes("Razão histórica"));
    assert.ok(cofins.lowAmount != null && cofins.highAmount != null);
  });

  it("sem base suficiente: projeção indisponível com motivo (nunca zero)", () => {
    const thin = history().filter((h) => h.month >= "2026-09");
    const rows = buildFiscal360Forecast({ referenceMonth: "2026-11", history: thin, openObligations: [], lagSamples: [], parameters: [], assumptions: BASE });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.availability === "UNAVAILABLE" && r.amount == null && r.unavailableReason));
    assert.equal(buildFiscal360Forecast({ referenceMonth: "2026-11", history: [], openObligations: [], lagSamples: [], parameters: [], assumptions: BASE }).length, 0);
  });

  it("determinística (saldo em aberto conhecido) não é duplicada pela estimada da mesma competência", () => {
    const rows = buildFiscal360Forecast({
      referenceMonth: "2026-11",
      history: history(),
      openObligations: [{ companyCnpj: KOP, taxType: "COFINS", competenceMonth: "2026-11", dueDate: "2026-12-22", openBalance: 80_000, anchorKey: "GUIDE:x" }],
      lagSamples: [],
      parameters: [],
      assumptions: BASE,
    });
    assert.equal(rows.filter((r) => r.taxType === "COFINS" && r.kind === "DETERMINISTIC").length, 1);
    assert.equal(rows.filter((r) => r.taxType === "COFINS" && r.kind === "ESTIMATED" && r.month === "2026-11").length, 0);
  });

  it("parâmetro por vigência substitui a razão apenas dentro da vigência (sem retroatividade)", () => {
    const parameters = [{ companyCnpj: KOP, taxType: "COFINS", rate: 0.05, effectiveFrom: "2027-01-01", effectiveTo: null, normativeSource: "Lei X", ruleVersionId: "v1" }];
    const rows = buildFiscal360Forecast({ referenceMonth: "2026-11", history: history(), openObligations: [], lagSamples: [], parameters, assumptions: BASE });
    assert.ok(Math.abs((rows.find((r) => r.taxType === "COFINS" && r.month === "2026-12")!.ratioUsed ?? 0) - 0.076) < 1e-6);
    assert.equal(rows.find((r) => r.taxType === "COFINS" && r.month === "2027-01")!.ratioUsed, 0.05);
  });

  it("cenário conservador projeta menos receita e mais carga que o base; crescimento eleva a receita", () => {
    const run = (a: Partial<typeof BASE>) => buildFiscal360Forecast({ referenceMonth: "2026-11", history: history(), openObligations: [], lagSamples: [], parameters: [], assumptions: sanitizeForecastAssumptions({ ...BASE, ...a }) });
    const horizon = Array.from({ length: 6 }, (_, i) => addFiscal360Months("2026-11", i));
    const base = summarizeFiscal360Forecast(run({}), horizon);
    const growth = summarizeFiscal360Forecast(run({ revenueGrowthPct: 30 }), horizon);
    const shrink = summarizeFiscal360Forecast(run({ revenueShiftPct: -10 }), horizon);
    assert.ok(growth.revenue > base.revenue);
    assert.ok(shrink.revenue < base.revenue);
    assert.ok(base.taxesDue > 0);
  });

  it("defasagem competência → pagamento define o mês de desembolso", () => {
    const rows = buildFiscal360Forecast({ referenceMonth: "2026-11", history: history(), openObligations: [], lagSamples: [], parameters: [], assumptions: { ...BASE, paymentLagMonths: 2 } });
    assert.equal(rows.find((r) => r.taxType === "COFINS" && r.month === "2026-11")!.cashMonth, "2027-01");
  });

  it("premissas são saneadas e limitadas", () => {
    const s = sanitizeForecastAssumptions({ revenueGrowthPct: 99999, horizonMonths: 99, ratioPercentile: "XX" as never });
    assert.equal(s.revenueGrowthPct, 300);
    assert.equal(s.horizonMonths, 18);
    assert.equal(s.ratioPercentile, "MEDIAN");
  });
});

describe("empresas, competências e utilidades", () => {
  it("resolve empresas do grupo por CNPJ formatado ou nome; externo é nulo", () => {
    assert.equal(resolveFiscal360GroupCnpj({ cnpj: "72.569.510/0001-95" }), LAZ);
    assert.equal(resolveFiscal360GroupCnpj({ name: "Koppetel Comércio de Plásticos LTDA" }), KOP);
    assert.equal(resolveFiscal360GroupCnpj({ name: "Fornecedor X" }), null);
    assert.equal(resolveFiscal360GroupCnpj({ cnpj: "11222333000181" }), null);
  });

  it("intervalos de competência e soma de meses", () => {
    assert.deepEqual(fiscal360MonthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
    assert.equal(addFiscal360Months("2026-01", -1), "2025-12");
    assert.deepEqual(fiscal360MonthRange("2026-05", "2026-01"), []);
  });

  it("hash estável (ordem de chaves, datas, decimais) e dedupeKey", () => {
    assert.equal(fiscal360Hash({ a: 1, b: new Date("2026-01-01T00:00:00Z") }), fiscal360Hash({ b: new Date("2026-01-01T00:00:00Z"), a: 1 }));
    assert.notEqual(fiscal360Hash([1]), fiscal360Hash([2]));
    assert.equal(fiscal360DedupeKey({ jobType: "REBUILD_PARTITION", sourceEntity: "PARTITION", sourceId: "x:2026-09" }), "REBUILD_PARTITION:PARTITION:x:2026-09");
  });

  it("erros de job não vazam credenciais", () => {
    const msg = sanitizeFiscal360Error(new Error("falha postgresql://user:senha@host:5432/db?password=abc token=xyz"));
    assert.ok(!msg.includes("senha"));
    assert.ok(!msg.includes("abc"));
    assert.ok(!msg.includes("xyz"));
  });
});

describe("filtros e regras (entrada hostil)", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  it("padrão YTD e consolidado; empresa fora do grupo é recusada", () => {
    const f = parseFiscal360Filters({}, now);
    assert.equal(f.fromMonth, "2026-01");
    assert.equal(f.toMonth, "2026-10");
    assert.equal(f.companyCnpj, null);
    assert.throws(() => parseFiscal360Filters({ company: "99999999000199" }, now), Fiscal360InputError);
    assert.equal(parseFiscal360Filters({ company: "72.569.510/0001-95" }, now).companyCnpj, LAZ);
  });

  it("tokens com SQL são rejeitados; intervalos inválidos e muito longos também", () => {
    assert.throws(() => parseFiscal360Filters({ taxType: "ICMS'; DROP TABLE x;--" }, now), Fiscal360InputError);
    assert.throws(() => parseFiscal360Filters({ status: "A OR 1=1" }, now), Fiscal360InputError);
    assert.throws(() => parseFiscal360Filters({ fromMonth: "2026-13" }, now), Fiscal360InputError);
    assert.throws(() => parseFiscal360Filters({ fromMonth: "2026-05", toMonth: "2026-01" }, now), Fiscal360InputError);
    assert.throws(() => parseFiscal360Filters({ fromMonth: "2015-01", toMonth: "2026-10" }, now), Fiscal360InputError);
  });

  it("regras do classificador: termo genérico não classifica como tributo; tributo e fonte são obrigatórios", () => {
    assert.throws(() => validateFiscal360RuleParameters("fiscal360.ap-classification-rules", { rules: [{ field: "description", match: "contains", value: "imposto", outcome: "TAX", taxType: "ICMS" }] }), /genérico/);
    assert.throws(() => validateFiscal360RuleParameters("fiscal360.ap-classification-rules", { rules: [{ field: "description", match: "contains", value: "DARF 2172", outcome: "TAX" }] }), /tributo/i);
    assert.doesNotThrow(() => validateFiscal360RuleParameters("fiscal360.ap-classification-rules", { rules: [{ field: "classification", match: "equals", value: "Impostos Federais", outcome: "NOT_TAX" }] }));
    assert.throws(() => validateFiscal360RuleParameters("fiscal360.tax-parameters", { items: [{ companyCnpj: LAZ, taxType: "PIS", rate: 3.65 }] }), /fração/);
    assert.throws(() => validateFiscal360RuleParameters("outra.regra", {}), Fiscal360InputError);
  });
});
