import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("batch payable reclassification", () => {
  const paidTitles = read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx");
  const batchModal = read("src/components/finance/cost-centers/FinanceApTitleBatchReclassifyModal.tsx");
  const routes = read("src/lib/financeCostCentersRoutes.ts");
  const allocation = read("src/lib/financeAccountsPayableCostCenterAllocation.ts");

  it("modal de títulos pagos expõe seleção em lote", () => {
    assert.match(paidTitles, /finance-supplier-paid-title-select/);
    assert.match(paidTitles, /finance-supplier-paid-titles-select-all/);
    assert.match(paidTitles, /finance-supplier-paid-titles-batch-bar/);
    assert.match(paidTitles, /finance-supplier-paid-titles-batch-reclassify-button/);
    assert.match(paidTitles, /Reclassificar selecionados/);
    assert.match(paidTitles, /Limpar seleção/);
    assert.match(paidTitles, /FinanceApTitleBatchReclassifyModal/);
    assert.match(paidTitles, /clearSelection/);
  });

  it("modal de lote abre empilhado com campos obrigatórios", () => {
    assert.match(batchModal, /Reclassificar títulos selecionados/);
    assert.match(batchModal, /usePortalContainer/);
    assert.match(batchModal, /createPortal/);
    assert.match(batchModal, /stacked/);
    assert.match(batchModal, /payables\/reclassify-batch/);
    assert.match(batchModal, /finance-ap-title-batch-reclassify-cost-center/);
    assert.match(batchModal, /finance-ap-title-batch-reclassify-reason/);
    assert.match(batchModal, /Não altera o AP\/Nomus nem a regra do fornecedor/);
  });

  it("endpoint batch registrado com permissão de alocação", () => {
    assert.match(routes, /\/api\/finance\/cost-centers\/payables\/reclassify-batch/);
    assert.match(routes, /batchReclassifyAccountsPayableAllocationsDefault/);
    assert.match(routes, /FINANCE_AP_ALLOCATION_MANAGE_PERMISSIONS/);
  });

  it("serviço batch reutiliza reclassificação individual", () => {
    assert.match(allocation, /batchReclassifyAccountsPayableAllocations/);
    assert.match(allocation, /reclassifyAccountsPayableAllocation\(/);
    assert.match(allocation, /MANUAL_RECLASSIFICATION/);
    assert.match(allocation, /BATCH_VALIDATION_FAILED/);
  });
});
