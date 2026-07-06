import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCustomerSuggestedAction } from "./financeAccountsReceivableActions.js";

describe("financeAccountsReceivableActions", () => {
  it("sugere acompanhar sem atraso", () => {
    assert.equal(
      buildCustomerSuggestedAction({ maxDaysOverdue: 0, hasSuspendedOpen: false, overdueAmount: 0 }),
      "Acompanhar"
    );
  });

  it("prioriza cobrança suspensa", () => {
    assert.equal(
      buildCustomerSuggestedAction({ maxDaysOverdue: 45, hasSuspendedOpen: true, overdueAmount: 1000 }),
      "Revisar motivo da cobrança suspensa"
    );
  });

  it("escala faixas de atraso", () => {
    assert.equal(
      buildCustomerSuggestedAction({ maxDaysOverdue: 3, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Lembrete leve"
    );
    assert.equal(
      buildCustomerSuggestedAction({ maxDaysOverdue: 10, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Cobrança ativa"
    );
    assert.equal(
      buildCustomerSuggestedAction({ maxDaysOverdue: 20, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Contato financeiro/comercial"
    );
    assert.equal(
      buildCustomerSuggestedAction({ maxDaysOverdue: 60, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Escalonar"
    );
  });
});
