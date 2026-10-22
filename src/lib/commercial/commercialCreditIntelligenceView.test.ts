import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import {
  BCB_CNPJ_NO_QUERY_DETAIL,
  INTELLIGENCE_FACT_LABEL,
  buildCommercialCreditIntelligenceView,
  describeCreditDecisionReasons,
  formatCreditDateTime,
  notConsultedCommercialCreditView,
  presentCnpjSourceFact,
} from "./commercialCreditIntelligenceView.js";
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";

const NOW = new Date(2026, 9, 19, 12, 0, 0);
const CUSTOMER = "11111111-1111-4111-8111-111111111111";

function analysis(overrides: Partial<CommercialDelinquencyAnalysis> = {}): CommercialDelinquencyAnalysis {
  const evidence = {
    source: "NomusAccountsReceivable" as const,
    toleranceDays: 0 as const,
    toleranceUnit: "CALENDAR_DAYS" as const,
    referenceDate: "2026-10-19",
    cnpj: "11444777000161",
    nomusPersonId: 100,
    identity: "RESOLVED" as const,
    syncRunStatus: "SUCCESS" as const,
    payloadComplete: true,
    sourceMaxSyncedAt: "2026-10-19T12:00:00.000Z",
    includedTitleIds: [] as number[],
    overdueTitleIds: [] as number[],
    protestedTitleIds: [] as number[],
    protestReading: "NOT_IN_SOURCE" as const,
    exclusions: [],
  };
  return {
    status: "REGULAR",
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
    ...overrides,
    evidence: { ...evidence, ...overrides.evidence },
  };
}

describe("apresentação da consulta CNPJ", () => {
  it("separa os cinco estados e não trata o Banco Central como consulta feita", () => {
    assert.deepEqual(Object.values(INTELLIGENCE_FACT_LABEL), [
      "Não consultado",
      "Não aplicável",
      "Indisponível",
      "Sem ocorrência",
      "Ocorrência encontrada",
    ]);
    const bcb = presentCnpjSourceFact({
      id: "bcb",
      label: "Banco Central do Brasil",
      status: "not_applicable",
      message: "not_applicable",
    });
    assert.equal(bcb.state, "NOT_APPLICABLE");
    assert.equal(bcb.stateLabel, "Não aplicável");
    assert.match(bcb.detail, /Nenhuma consulta ao Banco Central foi realizada/);
    assert.equal(bcb.detail.includes("not_applicable"), false);
    assert.equal(BCB_CNPJ_NO_QUERY_DETAIL.includes("consulta realizada com sucesso"), false);

    assert.equal(presentCnpjSourceFact({ id: "brasilapi", label: "BrasilAPI", status: "timeout" }).state, "UNAVAILABLE");
    assert.equal(presentCnpjSourceFact({ id: "brasilapi", label: "BrasilAPI", status: "not_found" }).state, "CLEAR");
    assert.equal(presentCnpjSourceFact({ id: "brasilapi", label: "BrasilAPI", status: "" }).state, "NOT_CONSULTED");
  });

  it("score cadastral 91 não impede o destaque de crédito bloqueado nem vaza o valor sem permissão", () => {
    const delinquency = analysis({
      status: "OVERDUE",
      overdueTitleCount: 2,
      overdueAmount: 1500,
      openAmount: 1500,
      maxDaysOverdue: 4,
      overdueTitles: [
        {
          externalId: 4,
          description: "Parcela NF 100",
          sourceInvoiceNumber: "100",
          dueDate: "2026-10-15",
          daysOverdue: 4,
          balanceReceivable: 1500,
          protested: false,
        },
      ],
    });
    const decision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    const visible = buildCommercialCreditIntelligenceView({
      decision,
      delinquency,
      externalProtest: "ABSENT",
      revealFinancial: true,
    });
    const hidden = buildCommercialCreditIntelligenceView({
      decision,
      delinquency,
      externalProtest: "ABSENT",
      revealFinancial: false,
    });
    assert.equal(visible.headline, "CRÉDITO BLOQUEADO");
    assert.equal(visible.cadastralAuthorizesCredit, false);
    assert.equal(visible.customerStatus, "BLOQUEADO");
    assert.match(visible.overdueAmountLabel, /1\.?500/);
    assert.equal(visible.overdueTitleCountLabel, "2");
    assert.equal(visible.maxDaysOverdueLabel, "4 dias");
    assert.equal(hidden.headline, "CRÉDITO BLOQUEADO");
    assert.equal(hidden.overdueAmountLabel, "Restrito");
    assert.equal(hidden.overdueTitleCountLabel, "Restrito");
    assert.equal(hidden.maxDaysOverdueLabel, "Restrito");
    assert.equal(hidden.financialDetailsRestricted, true);
    assert.equal(JSON.stringify(hidden).includes("1500"), false);
    assert.equal(visible.overdueTitles.length, 1);
    assert.equal(visible.overdueTitles[0]?.documentLabel, "100");
    assert.equal(visible.overdueTitles[0]?.dueDateLabel, "15/10/2026");
    assert.equal(hidden.overdueTitles.length, 0);
    assert.equal(visible.cadastralScoreLabel, "91/100");
    assert.equal(visible.cadastralVerdict, "VENDA LIBERADA");
    assert.equal(visible.cadastralAuthorizesCredit, false);
    // Redesign: estado executivo e motivos reais, sem mudar o score cadastral.
    assert.equal(visible.decisionState, "BLOQUEADO");
    assert.equal(visible.decisionTitle, "CRÉDITO BLOQUEADO");
    assert.match(visible.decisionDescription, /Venda a prazo não autorizada/);
    assert.ok(visible.decisionReasons.some((r) => r.code === "OVERDUE_OPEN_BALANCE"));
    assert.equal(visible.decisionReasons[0]?.origin, "Contas a Receber — Nomus");
  });
});

describe("cabeçalho executivo de decisão de crédito", () => {
  function decisionFor(overrides: Partial<CommercialDelinquencyAnalysis>, extra?: Parameters<typeof decideCommercialCredit>[0]["quod"]) {
    const delinquency = analysis(overrides);
    const decision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      quod: extra,
      now: NOW,
    });
    return buildCommercialCreditIntelligenceView({ decision, delinquency, externalProtest: "ABSENT", revealFinancial: true });
  }

  it("mapeia bloqueio crítico (protesto interno)", () => {
    const view = decisionFor({ status: "PROTESTED", evidence: { protestedTitleIds: [7] } as never });
    assert.equal(view.decisionState, "BLOQUEIO_CRITICO");
    assert.equal(view.decisionTitle, "BLOQUEIO CRÍTICO DE CRÉDITO");
    assert.equal(view.decisionTone, "critical");
    assert.ok(view.decisionReasons.some((r) => r.code === "INTERNAL_PROTEST" && r.severity === "CRITICAL"));
  });

  it("mapeia crédito bloqueado quando o financeiro não foi verificado", () => {
    const view = decisionFor({ status: "UNKNOWN", unknownReason: "SYNC_FAILED" });
    assert.equal(view.decisionState, "BLOQUEADO");
    assert.equal(view.decisionTitle, "CRÉDITO BLOQUEADO");
    assert.equal(view.decisionTone, "blocked");
  });

  it("mapeia crédito liberado somente quando o motor libera", () => {
    const view = decisionFor({});
    assert.equal(view.decisionState, "LIBERADO");
    assert.equal(view.decisionTitle, "CRÉDITO LIBERADO");
    assert.equal(view.decisionTone, "released");
    assert.deepEqual(view.decisionReasons, []);
  });

  it("não determina crédito quando não consultado (sem verde implícito)", () => {
    const view = notConsultedCommercialCreditView();
    assert.equal(view.decisionState, "NAO_DETERMINADO");
    assert.equal(view.decisionTitle, "CRÉDITO NÃO DETERMINADO");
    assert.equal(view.decisionTone, "undetermined");
    assert.equal(view.consulted, false);
  });

  it("QUOD com restrição confirmada leva a EM_ANÁLISE sem converter o score externo", () => {
    const view = decisionFor({}, { state: "VALID", confirmedRestriction: true, insufficient: false });
    assert.equal(view.decisionState, "BLOQUEADO");
    assert.equal(view.quodState, "VALID");
    assert.equal(view.quodConfirmedRestriction, true);
    assert.ok(view.decisionReasons.some((r) => r.code === "QUOD_EXTERNAL_RESTRICTION" && r.origin === "Dossiê QUOD — Direct Data"));
    // score externo alto nunca aparece como aprovação: a decisão continua em análise
    assert.notEqual(view.decisionState, "LIBERADO");
  });

  it("QUOD com atrasos mas pendências zero não é tratado como cliente regular", () => {
    // pendências zero + score insuficiente marca análise, não liberação
    const view = decisionFor({}, { state: "VALID", confirmedRestriction: false, insufficient: true });
    assert.equal(view.decisionState, "BLOQUEADO");
    assert.ok(view.decisionReasons.some((r) => r.code === "QUOD_INSUFFICIENT"));
  });
});

describe("catálogo de motivos e datas", () => {
  it("descreve apenas motivos conhecidos, com origem e gravidade, sem duplicar", () => {
    const reasons = describeCreditDecisionReasons([
      "OVERDUE_OPEN_BALANCE",
      "OVERDUE_OPEN_BALANCE",
      "REGULAR",
      "QUOD_EXTERNAL_RESTRICTION",
    ]);
    assert.equal(reasons.length, 2);
    assert.equal(reasons[0]?.code, "OVERDUE_OPEN_BALANCE");
    assert.equal(reasons[0]?.severity, "HIGH");
    assert.ok(reasons.every((r) => r.origin.length > 0));
  });

  it("formata data/hora em pt-BR com 'às' e trata ausência/erro", () => {
    assert.match(formatCreditDateTime("2026-10-20T15:03:00.000Z"), /^\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/);
    assert.equal(formatCreditDateTime(null), INTELLIGENCE_FACT_LABEL.NOT_CONSULTED);
    assert.equal(formatCreditDateTime("not-a-date"), INTELLIGENCE_FACT_LABEL.UNAVAILABLE);
  });
});
