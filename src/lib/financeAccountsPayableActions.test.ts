import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSupplierSuggestedAction } from "./financeAccountsPayableActions.js";

describe("financeAccountsPayableActions", () => {
  it("sugere programar pagamento sem atraso", () => {
    assert.equal(
      buildSupplierSuggestedAction({ maxDaysOverdue: 0, hasSuspendedOpen: false, overdueAmount: 0 }),
      "Programar pagamento"
    );
  });

  it("prioriza pagamento suspenso", () => {
    assert.equal(
      buildSupplierSuggestedAction({ maxDaysOverdue: 45, hasSuspendedOpen: true, overdueAmount: 1000 }),
      "Revisar bloqueio de pagamento"
    );
  });

  it("escala faixas de atraso", () => {
    assert.equal(
      buildSupplierSuggestedAction({ maxDaysOverdue: 3, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Priorizar conferência"
    );
    assert.equal(
      buildSupplierSuggestedAction({ maxDaysOverdue: 10, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Avaliar multa/juros"
    );
    assert.equal(
      buildSupplierSuggestedAction({ maxDaysOverdue: 20, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Negociar fornecedor"
    );
    assert.equal(
      buildSupplierSuggestedAction({ maxDaysOverdue: 60, hasSuspendedOpen: false, overdueAmount: 50 }),
      "Escalonar financeiro/diretoria"
    );
  });
});
