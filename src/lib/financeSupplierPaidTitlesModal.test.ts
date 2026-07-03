import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("FinanceSupplierPaidTitlesModal", () => {
  it("modal lista títulos pagos com coluna descritiva", () => {
    const modal = read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx");
    assert.match(modal, /finance-supplier-paid-titles-modal/);
    assert.match(modal, /Títulos pagos —/);
    assert.match(modal, /supplier-payment-titles/);
    assert.match(modal, /supplierKey/);
    assert.match(modal, /Descrição \/ comentário/);
    assert.match(modal, /descriptiveText/);
    assert.match(modal, /Nenhum título pago encontrado para este fornecedor no filtro atual/);
  });

  it("modal é somente leitura e não altera classificação", () => {
    const modal = read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx");
    assert.doesNotMatch(modal, /POST/);
    assert.doesNotMatch(modal, /PATCH/);
    assert.doesNotMatch(modal, /supplier-cost-center-rules/);
    assert.match(modal, /buildFinanceCostCentersDashboardQuery/);
  });
});
