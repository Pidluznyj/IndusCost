/**
 * Score de Confiança V1. Não autoriza crédito e não consulta bureau.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decideCommercialCredit, interpretIeptbConsultations } from "./commercialCreditDecision.js";
import { buildCommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import {
  CREDIT_CONFIDENCE_POLICY_VERSION,
  calculateCreditConfidence,
  explainBlockedConfidence,
  roundCreditConfidencePoints,
} from "./creditConfidence.js";
import { formatCustomerCnpjRiskTagLabel, type CustomerCnpjRiskSummary } from "../customerCnpjRiskSummary.js";
import { formatCustomerListExportCnpjScore } from "../customerListReportExport.js";
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const CUSTOMER = "11111111-1111-4111-8111-111111111111";

function analysis(status: CommercialDelinquencyAnalysis["status"] = "REGULAR"): CommercialDelinquencyAnalysis {
  return {
    status,
    unknownReason: null,
    overdueTitleCount: status === "OVERDUE" || status === "PROTESTED" ? 1 : 0,
    overdueAmount: status === "OVERDUE" || status === "PROTESTED" ? 100 : 0,
    openAmount: 0,
    maxDaysOverdue: status === "OVERDUE" || status === "PROTESTED" ? 10 : 0,
    lastSyncedAt: "2026-10-22T12:00:00.000Z",
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 0,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: "2026-10-22",
      cnpj: "11444777000161",
      nomusPersonId: 100,
      identity: "RESOLVED",
      syncRunStatus: "SUCCESS",
      payloadComplete: true,
      sourceMaxSyncedAt: "2026-10-22T12:00:00.000Z",
      includedTitleIds: [],
      overdueTitleIds: status === "OVERDUE" || status === "PROTESTED" ? [1] : [],
      protestedTitleIds: status === "PROTESTED" ? [1] : [],
      protestReading: status === "PROTESTED" ? "PROTESTED" : "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

function confidence(cadastralScore: number | null, extra: Parameters<typeof calculateCreditConfidence>[0] = { cadastralScore }) {
  return calculateCreditConfidence({ ...extra, cadastralScore, now: NOW });
}

const favorableQuod = { state: "VALID", confirmedRestriction: false, insufficient: false, cnpjMatches: true };
const favorableIeptb = { state: "VALID", confirmedClear: true, confirmedProtest: false, insufficient: false, cnpjMatches: true };

describe("Score de Confiança V1", () => {
  it("T01 a T08 — composição e arredondamento", () => {
    assert.equal(roundCreditConfidencePoints(72.8), 73);
    assert.equal(confidence(100).score, 80);
    assert.equal(confidence(100).maximumPossibleScore, 80);
    assert.equal(confidence(100, { cadastralScore: 100, quod: favorableQuod }).score, 92);
    assert.equal(confidence(100, { cadastralScore: 100, ieptb: favorableIeptb }).score, 88);
    assert.equal(confidence(100, { cadastralScore: 100, quod: favorableQuod, ieptb: favorableIeptb }).score, 100);
    assert.equal(confidence(91).score, 73);
    assert.equal(confidence(91).label, "73/100 · Bom");
    assert.equal(confidence(91, { cadastralScore: 91, quod: favorableQuod, ieptb: favorableIeptb }).score, 93);
    assert.equal(confidence(0).score, 0);
    assert.equal(confidence(0).band, "Baixo");
    assert.equal(confidence(null).band, "Insuficiente para avaliação");
    assert.equal(confidence(Number.NaN).cadastral.contribution, 0);
    assert.equal(confidence(140).cadastral.originalScore, null);
    assert.equal(confidence(100).policyVersion, CREDIT_CONFIDENCE_POLICY_VERSION);
  });

  it("T09 a T14 — evidência inválida não pontua e não apaga restrição", () => {
    assert.equal(confidence(100, { cadastralScore: 100, quod: { state: "STALE", confirmedRestriction: false } }).quod.status, "EXPIRADA");
    assert.equal(confidence(100, { cadastralScore: 100, quod: { state: "STALE" } }).score, 80);
    assert.equal(confidence(100, { cadastralScore: 100, ieptb: { state: "STALE", confirmedClear: true } }).ieptb.status, "EXPIRADA");
    assert.equal(confidence(100, { cadastralScore: 100, ieptb: { state: "PARTIAL", confirmedClear: true } }).score, 80);
    assert.equal(confidence(100, { cadastralScore: 100, quod: { state: "FAILED" } }).quod.status, "FALHA");
    assert.equal(confidence(100, { cadastralScore: 100, quod: { state: "VALID", cnpjMatches: false, confirmedRestriction: false } }).quod.status, "INCOMPATIVEL");
    assert.equal(confidence(100, { cadastralScore: 100, ieptb: { state: "VALID", confirmedProtest: false, confirmedClear: false } }).ieptb.contribution, 0);
    const interpreted = interpretIeptbConsultations(
      [
        { consultedAt: new Date("2026-10-01T00:00:00Z"), validUntil: new Date("2026-11-01T00:00:00Z"), status: "SUCCEEDED", confirmedProtest: true },
        { consultedAt: new Date("2026-10-20T00:00:00Z"), validUntil: new Date("2026-11-20T00:00:00Z"), status: "PARTIAL", confirmedProtest: false, insufficient: true },
      ],
      NOW
    );
    assert.equal(interpreted.confirmedProtest, true);
    const restricted = confidence(100, { cadastralScore: 100, ieptb: interpreted });
    assert.equal(restricted.ieptb.contribution, 0);
    assert.equal(restricted.ieptb.status, "RESTRITIVA");
  });

  it("T15 a T22 — a decisão oficial prevalece e o score não a altera", () => {
    const high = confidence(100, { cadastralScore: 100, quod: favorableQuod, ieptb: favorableIeptb });
    assert.equal(high.score, 100);
    const overdue = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("OVERDUE"),
      cadastral: { score: 100, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    assert.equal(overdue.customerStatus, "BLOQUEADO");
    assert.equal(overdue.cadastralIgnored, true);
    assert.match(explainBlockedConfidence({ score: high.score, customerStatus: overdue.customerStatus, reasons: overdue.reasons }) ?? "", /inadimplência própria/);

    const protested = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(),
      ieptb: { state: "VALID", confirmedProtest: true, insufficient: false },
      now: NOW,
    });
    assert.equal(protested.customerStatus, "BLOQUEADO");
    assert.equal(protested.reasons.includes("IEPTB_NATIONAL_PROTEST"), true);

    const related = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(),
      relatedParties: [{ customerId: "22222222-2222-4222-8222-222222222222", delinquency: analysis("OVERDUE") }],
      cadastral: { score: 96, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    assert.equal(related.customerStatus, "BLOQUEADO");
    assert.equal(related.reasons.includes("RELATED_PARTY_DELINQUENT"), true);
    assert.equal(confidence(96).score, 77);

    const quodHold = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(),
      quod: { state: "VALID", confirmedRestriction: true, insufficient: false },
      now: NOW,
    });
    assert.equal(quodHold.customerStatus, "BLOQUEADO");
    assert.equal(confidence(100, { cadastralScore: 100, quod: { state: "VALID", confirmedRestriction: true } }).quod.contribution, 0);

    const low = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(),
      cadastral: { score: 10, verdict: "VENDA BLOQUEADA" },
      now: NOW,
    });
    assert.equal(low.customerStatus, "LIBERADO");
    assert.equal(confidence(10).score, 8);

    const absent = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(),
      now: NOW,
    });
    assert.equal(absent.reasons.includes("IEPTB_NATIONAL_PROTEST"), false);
    assert.equal(confidence(80).ieptb.status, "AUSENTE");

    const lowScore = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("OVERDUE"),
      cadastral: { score: 0, verdict: "VENDA BLOQUEADA" },
      now: NOW,
    });
    assert.equal(lowScore.customerStatus, overdue.customerStatus);
    assert.equal(lowScore.reason, overdue.reason);

    const lifted = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("OVERDUE"),
      exceptions: [{ id: "33333333-3333-4333-8333-333333333333", scope: "OVERDUE", expiresAt: new Date("2026-11-22T00:00:00Z"), revokedAt: null }],
      now: NOW,
    });
    assert.equal(lifted.reason, "EXCEPTION_APPLIED");
    assert.equal(confidence(100).score, 80);
  });

  it("T23 a T30 — lista, relatório e política usam o mesmo indicador", () => {
    const risk: CustomerCnpjRiskSummary = {
      lookupId: "l",
      score: 91,
      verdict: "VENDA LIBERADA",
      riskLevel: null,
      saleRecommendation: null,
      source: "cnpj",
      fetchedAt: NOW.toISOString(),
      expiresAt: NOW.toISOString(),
      expired: false,
    };
    const label = formatCustomerCnpjRiskTagLabel(risk);
    assert.equal(label, formatCustomerListExportCnpjScore(risk));
    assert.equal(label.includes("VENDA"), false);
    const view = buildCommercialCreditIntelligenceView({
      decision: decideCommercialCredit({
        customerId: CUSTOMER,
        enforcement: "CREDIT_GRANT",
        paymentTerms: "30",
        delinquency: analysis("OVERDUE"),
        cadastral: { score: 91, verdict: "VENDA LIBERADA" },
        now: NOW,
      }),
      delinquency: analysis("OVERDUE"),
      externalProtest: "ABSENT",
      revealFinancial: false,
    });
    assert.equal(view.confidenceScoreLabel, "73/100 · Bom");
    assert.equal(view.decisionTitle, "CRÉDITO BLOQUEADO");
    assert.match(view.confidenceNote ?? "", /inadimplência própria/);
    assert.equal(view.confidencePolicyVersion, CREDIT_CONFIDENCE_POLICY_VERSION);
    assert.equal(view.cadastralScoreLabel, "91/100");
    const source = readFileSync(new URL("./creditConfidence.ts", import.meta.url), "utf8");
    assert.equal(source.includes("prisma"), false);
    assert.equal(source.includes("NomusAccountsReceivable"), false);
    assert.equal(source.includes("calculateCommercialRiskScore"), false);
    assert.equal(/from ["'].*(quodDossier|ieptbOnline)/.test(source), false);
  });

  it("casos visuais não misturam faixa de confiança com autorização de venda", () => {
    for (const original of [68, 91, 83, 100]) {
      const result = confidence(original);
      assert.equal(result.label.includes("VENDA"), false);
      assert.equal(result.label.includes("LIBERADA"), false);
      assert.equal(result.label.includes("BLOQUEADA"), false);
    }
    const blockedProtest = confidence(100, {
      cadastralScore: 100,
      ieptb: { state: "VALID", confirmedProtest: true, confirmedClear: false, insufficient: false },
    });
    assert.equal(blockedProtest.score, 80);
    assert.equal(blockedProtest.ieptb.contribution, 0);
  });
});
