import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("commissionReceiptClosingUi", () => {
  it("resumo por vendedor filtra detalhamento com chip e destaque", () => {
    const page = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
    assert.match(page, /sellerFilterKey/);
    assert.match(page, /filterReceiptClosingLinesBySellerKey/);
    assert.match(page, /handleSellerRowClick/);
    assert.match(page, /commissions-receipt-closing-seller-filter-chip/);
    assert.match(page, /commissions-receipt-closing-seller-filter-clear/);
    assert.match(page, /aria-selected/);
    assert.match(page, /filteredDetailLines\.length/);
  });

  it("exportação oferece filtrado e tudo quando há filtro ativo", () => {
    const page = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
    assert.match(page, /exportDetailXlsxFiltered/);
    assert.match(page, /exportDetailXlsxAll/);
    assert.match(page, /commissions-receipt-closing-export-detail-all/);
    assert.match(page, /buildReceiptClosingDetailExportArrayBuffer/);
  });

  it("detalhamento exibe totais filtrados no rodapé", () => {
    const page = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
    assert.match(page, /computeReceiptClosingDetailTotals/);
    assert.match(page, /commissions-receipt-closing-detail-totals/);
  });
});
