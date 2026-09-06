import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatNomusPurchaseOrderListInvoiceCell,
  formatNomusPurchaseOrderListSupplier,
} from "./nomusPurchaseOrderUi.js";

describe("NomusPurchaseOrder 360 UI", () => {
  it("grid formata fornecedor resolvido, fallback de ID e coluna NF", () => {
    assert.equal(
      formatNomusPurchaseOrderListSupplier({
        supplierResolvedName: "SULIFLEX IND. E COM. DE PLASTICOS LTDA",
        supplierExternalId: 215,
      }),
      "SULIFLEX IND. E COM. DE PLASTICOS LTDA"
    );
    assert.equal(
      formatNomusPurchaseOrderListSupplier({
        supplierResolvedName: null,
        supplierExternalId: 215,
      }),
      "Fornecedor Nomus #215"
    );
    const emptyNf = formatNomusPurchaseOrderListInvoiceCell({
      lastInvoiceNumber: null,
      invoiceCount: 0,
    });
    assert.equal(emptyNf.primary, "—");
    const multi = formatNomusPurchaseOrderListInvoiceCell({
      lastInvoiceNumber: "64924",
      invoiceCount: 3,
    });
    assert.equal(multi.primary, "64924");
    assert.equal(multi.extraCount, 2);
  });

  it("módulo abre modal in-place e preserva lista", () => {
    const moduleSrc = readFileSync("src/components/NomusPurchaseOrderModule.tsx", "utf8");
    const tableSrc = readFileSync("src/components/purchases/NomusPurchaseOrderListTable.tsx", "utf8");
    assert.match(moduleSrc, /NomusPurchaseOrderListTable/);
    assert.match(moduleSrc, /NomusPurchaseOrderDetailDialog/);
    assert.match(moduleSrc, /data-testid="nomus-purchase-order-list"/);
    assert.match(tableSrc, /npo-list-open-detail/);
    assert.match(tableSrc, /sales-order-list-table/);
    assert.match(tableSrc, /onClick=\{handleOpen\}/);
    assert.doesNotMatch(moduleSrc, /navigate\(`\/purchases\/nomus-orders\/\$\{/);
    assert.doesNotMatch(moduleSrc, /PurchaseRequest/);
    assert.match(moduleSrc, /fiscalStatus/);
    assert.match(moduleSrc, /financialStatus/);
  });

  it("modal segue o padrão do PV: portal, Esc, backdrop, abas e raw gated", () => {
    const dialog = readFileSync(
      "src/components/purchases/NomusPurchaseOrderDetailDialog.tsx",
      "utf8"
    );
    assert.match(dialog, /createPortal/);
    assert.match(dialog, /document\.body/);
    assert.match(dialog, /role="dialog"/);
    assert.match(dialog, /max-w-\[1400px\]/);
    assert.match(dialog, /Escape/);
    assert.match(dialog, /e\.target === e\.currentTarget/);
    assert.match(dialog, /npo-tab-\$\{tab\.id\}/);
    assert.match(dialog, /id: "geral"/);
    assert.match(dialog, /id: "itens"/);
    assert.match(dialog, /id: "fiscal"/);
    assert.match(dialog, /id: "financeiro"/);
    assert.match(dialog, /id: "nomus"/);
    assert.match(dialog, /includeRaw=1/);
    assert.match(dialog, /settings\.nomus\.view/);
    assert.match(dialog, /Nenhuma NF-e vinculada foi identificada/);
    assert.match(dialog, /Total das parcelas planejadas/);
    assert.match(dialog, /npo-detail-loading/);
    assert.match(dialog, /npo-detail-error/);
    assert.match(dialog, /npo-raw-gated/);
    assert.match(dialog, /NomusPurchaseOrderPrintDocument/);
    assert.match(dialog, /triggerBrowserPrint/);
    assert.match(dialog, /npo-detail-print-route/);
    assert.doesNotMatch(dialog, /NOMUS_TOKEN|Authorization|password|secret/i);
    assert.doesNotMatch(dialog, /Boleto disponível/);
  });

  it("impressão do detalhe usa A4 retrato e cabeçalho institucional com logo", () => {
    const printCss = readFileSync(
      "src/components/purchases/nomus-purchase-order-detail-print.css",
      "utf8"
    );
    const printDoc = readFileSync(
      "src/components/purchases/NomusPurchaseOrderPrintDocument.tsx",
      "utf8"
    );
    assert.match(printCss, /size:\s*A4 portrait/);
    assert.match(printCss, /npo-detail-print-root/);
    assert.match(printCss, /print-doc-header-grid/);
    assert.match(printCss, /print-doc-logo/);
    assert.match(printCss, /max-height:\s*24mm/);
    assert.match(printDoc, /PrintHeader/);
    assert.match(printDoc, /PrintDocumentShell/);
    assert.match(printDoc, /documentTitle="PEDIDO DE COMPRA"/);
    assert.match(printDoc, /sales-order-print-document/);
    assert.match(printDoc, /proposal-compact-document/);
    assert.match(printDoc, /proposal-compact-header/);
    assert.match(printDoc, /Documento gerado pelo IndusCost/);
    assert.doesNotMatch(printDoc, /unitPrice \* orderedQuantity/);
    assert.doesNotMatch(printDoc, /rawPayload/);
    const reportsCss = readFileSync("src/reports-print.css", "utf8");
    assert.match(reportsCss, /npo-detail-print-route/);
    assert.match(reportsCss, /#npo-detail-print-root/);
  });

  it("rotas não escrevem no Nomus e não misturam PurchaseOrder interno", () => {
    const routes = readFileSync("src/lib/nomusPurchaseOrderRoutes.ts", "utf8");
    assert.match(routes, /GET/);
    assert.doesNotMatch(routes, /app\.(post|put|patch|delete)\(\s*["']\/api\/nomus\/purchase-orders/i);
    assert.doesNotMatch(routes, /PurchaseRequest/);
    assert.match(routes, /includeRaw/);
    assert.match(routes, /settings\.nomus\.view/);
    assert.match(routes, /enrichNomusPurchaseOrderListRows/);
  });
});
