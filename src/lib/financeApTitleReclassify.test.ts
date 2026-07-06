import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("reclassificação manual de título — UI e rotas", () => {
  it("endpoint de reclassificação registrado com permissão de alocação", () => {
    const routes = read("src/lib/financeAccountsPayableCostCenterAllocationRoutes.ts");
    assert.match(routes, /cost-center-reclassification/);
    assert.match(routes, /reclassifyAccountsPayableAllocationDefault/);
    assert.match(routes, /finance\.ap_allocations\.manage/);
  });

  it("modal de reclassificação exige motivo e novo centro de custo", () => {
    const modal = read("src/components/finance/cost-centers/FinanceApTitleReclassifyModal.tsx");
    assert.match(modal, /Reclassificar título/);
    assert.match(modal, /cost-center-reclassification/);
    assert.match(modal, /finance-ap-title-reclassify-reason/);
    assert.match(
      modal,
      /A correção manual prevalece sobre regras automáticas futuras/
    );
  });

  it("lista de títulos pagos expõe ação Reclassificar e badge Manual", () => {
    const modal = read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx");
    assert.match(modal, /finance-supplier-paid-title-reclassify-button/);
    assert.match(modal, /Reclassificar/);
    assert.match(modal, /isManualClassification/);
    assert.match(modal, /FinanceApTitleReclassifyModal/);
    assert.match(modal, /canReclassify/);
  });

  it("auditoria resume evento MANUAL_RECLASSIFICATION", () => {
    const integration = read("src/lib/financeAccountsPayableCostCenterIntegration.ts");
    assert.match(integration, /MANUAL_RECLASSIFICATION/);
    assert.match(integration, /Reclassificação manual de centro de custo/);
  });
});
