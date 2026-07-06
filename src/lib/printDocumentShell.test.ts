import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("printDocumentShell", () => {
  it("PrintHeader usa grid de 3 colunas (logo, empresa, documento)", () => {
    const header = read("src/components/print/PrintHeader.tsx");
    assert.ok(header.includes("print-doc-header-grid"));
    assert.ok(header.includes("print-doc-logo-wrap"));
    assert.ok(header.includes("print-doc-company-text"));
    assert.ok(header.includes("print-doc-meta"));
    assert.ok(header.includes("print-doc-header-rule"));
  });

  it("proposta print contém logo, PROPOSTA, data e vendedor", () => {
    const proposal = read("src/components/proposal/ProposalClientDocument.tsx");
    const printView = read("src/components/proposal/ProposalPrintView.tsx");
    assert.ok(proposal.includes("PrintHeader"));
    assert.ok(proposal.includes('documentTitle="PROPOSTA"'));
    assert.ok(proposal.includes("Vendedor"));
    assert.ok(printView.includes("proposal-print-route"));
    assert.ok(printView.includes("proposal-print-no-print"));
  });

  it("pedido print contém logo, PEDIDO e rota dedicada", () => {
    const orderDoc = read("src/components/sales/SalesOrderClientDocument.tsx");
    const orderPrint = read("src/components/sales/SalesOrderPrintView.tsx");
    const app = read("src/App.tsx");
    assert.ok(orderDoc.includes('documentTitle="PEDIDO"'));
    assert.ok(orderDoc.includes("PrintHeader"));
    assert.ok(orderPrint.includes("sales-order-print-route"));
    assert.ok(app.includes("/sales-orders/:id/print"));
  });

  it("produtos vendidos print contém cabeçalho institucional RELATÓRIO PRODUTOS VENDIDOS", () => {
    const doc = read("src/components/commercial/SoldProductsPrintDocument.tsx");
    const css = read("src/components/commercial/sold-products-print.css");
    assert.ok(doc.includes("PrintHeader"));
    assert.ok(doc.includes('documentHighlight="PRODUTOS VENDIDOS"'));
    assert.ok(!doc.includes('documentKind="Relatório gerencial"'));
    assert.ok(doc.includes("PrintTable"));
    assert.ok(doc.includes("Período"));
    assert.ok(doc.includes("Resumo executivo"));
    assert.ok(doc.includes("Documento gerado pelo IndusCost"));
    assert.ok(css.includes("A4 landscape"));
    assert.ok(css.includes("overflow: visible"));
    assert.ok(css.includes("print-doc-header-grid"));
    assert.ok(css.includes("col-rank"));
    assert.ok(css.includes("8mm"));
    assert.ok(css.includes("white-space: nowrap"));
    assert.ok(!css.includes(".print-doc-header *"));
    assert.ok(css.includes("table-header-group"));
  });

  it("CSS AR overdue não oculta header global fora da rota de impressão", () => {
    const css = read("src/components/finance/finance-ar-overdue-print.css");
    assert.ok(!css.includes("header:not(.finance-ar-overdue-print-doc-header)"));
    assert.ok(css.includes("body.ar-overdue-print-route"));
  });

  it("print-document.css define thead table-header-group e oculta botões", () => {
    const css = read("src/components/print/print-document.css");
    assert.ok(css.includes("table-header-group"));
    assert.ok(css.includes(".print-no-print"));
    assert.ok(css.includes(".print-doc-header"));
  });

  it("proposta usa A4 portrait", () => {
    const css = read("src/proposal-print.css");
    assert.ok(css.includes("A4 portrait"));
  });
});
