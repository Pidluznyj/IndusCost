import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("FinanceApTitleReclassifyModal stacking", () => {
  const reclassify = read("src/components/finance/cost-centers/FinanceApTitleReclassifyModal.tsx");
  const paidTitles = read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx");
  const dialog = read("src/components/finance/cost-centers/financeUnclassifiedModalUi.tsx");

  it("modal de reclassificação usa portal e z-index empilhado", () => {
    assert.match(reclassify, /usePortalContainer/);
    assert.match(reclassify, /createPortal/);
    assert.match(reclassify, /portalContainer/);
    assert.match(reclassify, /stacked/);
    assert.match(reclassify, /Reclassificar título/);
    assert.match(reclassify, /cost-center-reclassification/);
  });

  it("CostCenterDialog suporta stacked acima do modal de títulos pagos", () => {
    assert.match(dialog, /stacked\?: boolean/);
    assert.match(dialog, /stacked \? "z-\[85\]" : "z-50"/);
    assert.match(paidTitles, /z-\[75\]/);
  });

  it("modal pai abre reclassificação sem chamar API diretamente", () => {
    assert.match(paidTitles, /FinanceApTitleReclassifyModal/);
    assert.match(paidTitles, /setReclassifyTitle\(row\)/);
    assert.match(paidTitles, /onClose=\{\(\) => setReclassifyTitle\(null\)\}/);
    assert.match(paidTitles, /finance-supplier-paid-title-reclassify-button/);
  });

  it("cancelar fecha só o modal filho e salvar recarrega títulos", () => {
    assert.match(paidTitles, /onSaved=\{\(\) => \{/);
    assert.match(paidTitles, /void loadTitles\(page, search\)/);
    assert.match(reclassify, /onClose=\{onClose\}/);
    assert.match(reclassify, /finance-ap-title-reclassify-save-button/);
  });
});
