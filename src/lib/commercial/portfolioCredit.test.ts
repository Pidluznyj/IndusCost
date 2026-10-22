/**
 * Carteira, detalhe e relatório usam o mesmo score e a mesma decisão.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import { buildCommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import { creditConfidenceFromEvidence } from "./creditConfidence.js";
import { selectIeptbCreditEvidence, selectQuodCreditEvidence } from "./creditEvidenceSelection.js";
import { loadPortfolioCredit } from "./portfolioCredit.server.js";
import { presentPortfolioCredit } from "./portfolioCredit.js";
import { mapCustomerListReportExportRow } from "../customerListReportExport.js";
import { CustomerCnpjRiskTag } from "../../components/customers/CustomerCnpjRiskTag.js";
import { CustomerCreditPostureBadge } from "../../components/customers/CustomerCreditPostureBadge.js";
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";

const NOW = new Date("2026-10-22T15:00:00.000Z");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CNPJ_A = "11444777000161";
const CNPJ_B = "00000000000191";

function regular(customerId: string): CommercialDelinquencyAnalysis {
  return {
    status: "REGULAR",
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: NOW.toISOString(),
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 3,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: "2026-10-22",
      cnpj: CNPJ_A,
      nomusPersonId: 100,
      identity: "RESOLVED",
      syncRunStatus: "SUCCESS",
      payloadComplete: true,
      sourceMaxSyncedAt: NOW.toISOString(),
      includedTitleIds: [],
      overdueTitleIds: [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
  void customerId;
}

describe("paridade do Score de Confiança e da decisão", () => {
  it("lista, detalhe e relatório recebem o mesmo score e a mesma decisão no mesmo instante", () => {
    const quod = selectQuodCreditEvidence(
      [{ cnpj: CNPJ_A, status: "SUCCEEDED", confirmedRestriction: false, insufficient: false, validUntil: "2026-12-01T00:00:00.000Z", consultedAt: NOW.toISOString() }],
      NOW,
      CNPJ_A
    );
    const ieptb = selectIeptbCreditEvidence(
      [{ cnpj: CNPJ_A, status: "SUCCEEDED", confirmedClear: true, confirmedProtest: false, insufficient: false, validUntil: "2026-12-01T00:00:00.000Z", consultedAt: NOW.toISOString() }],
      NOW,
      CNPJ_A
    );
    const related = regular(B);
    related.status = "OVERDUE";
    related.overdueTitleCount = 1;
    related.overdueAmount = 6560;
    related.evidence = { ...related.evidence, cnpj: CNPJ_B, overdueTitleIds: [9] };
    const decision = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular(A),
      cadastral: { score: 100, verdict: "VENDA LIBERADA" },
      quod,
      ieptb,
      relatedParties: [{ customerId: B, delinquency: related }],
      now: NOW,
    });
    const view = buildCommercialCreditIntelligenceView({
      decision,
      delinquency: regular(A),
      externalProtest: "ABSENT",
      revealFinancial: false,
    });
    const portfolio = presentPortfolioCredit(decision, NOW);
    const exported = mapCustomerListReportExportRow({
      companyName: "Cliente A",
      portfolioCredit: portfolio,
    });
    assert.equal(decision.customerStatus, "BLOQUEADO");
    assert.equal(decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(decision.allowed, false);
    assert.equal(decision.cadastralIgnored, true);
    assert.equal(portfolio.confidence.score, 100);
    assert.equal(portfolio.confidence.label, view.confidenceScoreLabel);
    assert.equal(portfolio.confidence.label, creditConfidenceFromEvidence(decision.evidence, NOW).label);
    assert.equal(portfolio.confidence.policyVersion, view.confidencePolicyVersion);
    assert.equal(exported.cnpjScore, portfolio.confidence.label);
    assert.match(exported.creditDecision, /CRÉDITO BLOQUEADO/);
    assert.match(exported.creditDecision, /Risco compartilhado/);
    assert.equal(exported.cnpjScore.includes("VENDA"), false);
    assert.equal(portfolio.decision.reasonGroup, "risco_compartilhado");
    const html = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        React.createElement(CustomerCnpjRiskTag, { risk: null, confidence: portfolio.confidence }),
        React.createElement(CustomerCreditPostureBadge, { decision: portfolio.decision })
      )
    );
    assert.match(html, /100\/100 · Excelente/);
    assert.match(html, /CRÉDITO BLOQUEADO/);
    assert.match(html, /Risco compartilhado/);
    assert.equal(html.includes("VENDA LIBERADA"), false);
    assert.equal(html.includes("VENDA BLOQUEADA"), false);
  });

  it("falha de leitura não vira consulta ausente e não libera o prazo", () => {
    const quod = selectQuodCreditEvidence([], NOW, CNPJ_A);
    assert.equal(quod.state, "NOT_CONSULTED");
    const failed = selectQuodCreditEvidence(
      [{ cnpj: CNPJ_A, status: "FAILED", confirmedRestriction: false, insufficient: true, consultedAt: NOW.toISOString() }],
      NOW,
      CNPJ_A
    );
    assert.equal(failed.state, "FAILED");
    const mismatched = selectQuodCreditEvidence(
      [{ cnpj: CNPJ_B, status: "SUCCEEDED", confirmedRestriction: false, insufficient: false, validUntil: "2026-12-01T00:00:00.000Z", consultedAt: NOW.toISOString() }],
      NOW,
      CNPJ_A
    );
    assert.equal(mismatched.cnpjMatches, false);
    const decision = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular(A),
      cadastral: { score: 100, verdict: "VENDA LIBERADA" },
      quod: { ...failed, readFailed: true },
      now: NOW,
    });
    const portfolio = presentPortfolioCredit(decision, NOW);
    assert.equal(decision.customerStatus, "BLOQUEADO");
    assert.equal(portfolio.confidence.quod.status, "FALHA");
    assert.notEqual(portfolio.confidence.quod.status, "AUSENTE");
    assert.equal(portfolio.confidence.score, 80);
    assert.equal(decision.allowed, false);
  });
});

describe("lote da carteira", () => {
  it("cliente sem dívida própria fica bloqueado pela empresa relacionada confirmada", async () => {
    const synced = new Date("2026-10-22T12:00:00.000Z");
    const customers = [
      { id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, companyName: "A" },
      { id: B, taxId: CNPJ_B, nomusExternalPersonId: 200, companyName: "B" },
    ];
    const db = {
      customer: {
        async findMany(args: { where?: { id?: { in?: string[] }; taxId?: { in?: string[] }; OR?: unknown }; select?: { taxId?: boolean } }) {
          if (args.where?.id?.in) return customers.filter((row) => args.where?.id?.in?.includes(row.id));
          if (args.where?.taxId?.in || args.where?.OR) return customers;
          return customers;
        },
      },
      salesOrder: {
        async findMany() {
          return [
            { customerId: A, externalCustomerId: 100 },
            { customerId: B, externalCustomerId: 200 },
          ];
        },
      },
      nomusAccountsReceivable: {
        async findMany(args: { where?: { personId?: { in?: number[] } } }) {
          const ids = args.where?.personId?.in ?? [];
          if (!ids.includes(200)) return [];
          return [{
            externalId: 9,
            personId: 200,
            personName: "B",
            personCnpj: CNPJ_B,
            companyName: "B",
            description: "NF",
            comments: null,
            dueDate: new Date("2026-10-01T00:00:00.000Z"),
            settlementDate: null,
            amountReceivable: 6560,
            amountReceived: 0,
            balanceReceivable: 6560,
            sourceInvoiceId: 50,
            sourceInvoiceNumber: "100",
            paymentMethodName: "BOLETO",
            bankAccountName: null,
            suspendCollection: false,
            status: false,
            syncedAt: synced,
            sourcePresenceStatus: "PRESENT",
            rawPayload: { id: 9 },
          }];
        },
        async aggregate() {
          return { _max: { syncedAt: synced } };
        },
      },
      nomusSourceSyncRun: {
        async findFirst() {
          return { status: "SUCCESS", payloadComplete: true };
        },
      },
      customerCorporateLink: {
        async findMany() {
          return [{ customerId: A, relatedCustomerId: B, status: "CONFIRMED" }];
        },
      },
      quodDossierConsultation: {
        async findMany() {
          return [{
            customerId: A,
            cnpj: CNPJ_A,
            status: "SUCCEEDED",
            confirmedRestriction: false,
            insufficient: false,
            validUntil: new Date("2026-12-01T00:00:00.000Z"),
            consultedAt: NOW,
          }];
        },
      },
      ieptbOnlineConsultation: {
        async findMany() {
          return [{
            customerId: A,
            cnpj: CNPJ_A,
            status: "SUCCEEDED",
            confirmedProtest: false,
            confirmedClear: true,
            insufficient: false,
            validUntil: new Date("2026-12-01T00:00:00.000Z"),
            consultedAt: NOW,
          }];
        },
      },
    };
    const snapshots = await loadPortfolioCredit(db as never, [
      { id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, cnpjRisk: { score: 100, verdict: "VENDA LIBERADA" } },
      { id: B, taxId: CNPJ_B, nomusExternalPersonId: 200, cnpjRisk: { score: 40, verdict: "VENDA BLOQUEADA" } },
    ], NOW);
    const subject = snapshots.get(A)!;
    assert.equal(subject.decision.customerStatus, "BLOQUEADO");
    assert.equal(subject.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(subject.decision.reasonGroup, "risco_compartilhado");
    assert.equal(subject.confidence.score, 100);
    assert.equal(subject.confidence.label.includes("VENDA"), false);
    const again = await loadPortfolioCredit(db as never, [
      { id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, cnpjRisk: { score: 100, verdict: "VENDA LIBERADA" } },
    ], NOW);
    assert.equal(again.get(A)?.confidence.label, subject.confidence.label);
    assert.equal(again.get(A)?.decision.customerStatus, subject.decision.customerStatus);
    assert.equal(again.get(A)?.decision.evaluatedAt, subject.decision.evaluatedAt);
  });

  it("erro ao ler QUOD não é tratado como consulta ausente", async () => {
    const synced = new Date("2026-10-22T12:00:00.000Z");
    const db = {
      customer: {
        async findMany() {
          return [{ id: A, taxId: CNPJ_A, nomusExternalPersonId: 100 }];
        },
      },
      salesOrder: { async findMany() { return [{ customerId: A, externalCustomerId: 100 }]; } },
      nomusAccountsReceivable: {
        async findMany() { return []; },
        async aggregate() { return { _max: { syncedAt: synced } }; },
      },
      nomusSourceSyncRun: { async findFirst() { return { status: "SUCCESS", payloadComplete: true }; } },
      customerCorporateLink: { async findMany() { return []; } },
      quodDossierConsultation: { async findMany() { throw new Error("quod-down"); } },
      ieptbOnlineConsultation: { async findMany() { return []; } },
    };
    const snapshots = await loadPortfolioCredit(db as never, [{ id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, cnpjRisk: { score: 91 } }], NOW);
    const row = snapshots.get(A)!;
    assert.equal(row.confidence.quod.status, "FALHA");
    assert.notEqual(row.decision.customerStatus, "LIBERADO");
    assert.equal(row.decision.readFailed, true);
  });
});
