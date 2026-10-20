import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import {
  BCB_CNPJ_NO_QUERY_DETAIL,
  INTELLIGENCE_FACT_LABEL,
  buildCommercialCreditIntelligenceView,
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
    assert.equal(visible.cadastralScoreLabel, "91/100");
    assert.equal(visible.cadastralVerdict, "VENDA LIBERADA");
    assert.equal(visible.cadastralAuthorizesCredit, false);
  });
});
