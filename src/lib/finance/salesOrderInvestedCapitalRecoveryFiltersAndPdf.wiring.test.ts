import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("Recuperação do Dinheiro Investido — filtros gated por Pesquisar + PDF", () => {
  it("página usa draft/applied — inputs não disparam fetch, só handleApplyFilters/mount", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, /draftFilters/);
    assert.match(page, /appliedFilters/);
    assert.match(page, /const query = useMemo\(\(\) => buildQuery\(appliedFilters\), \[appliedFilters\]\)/);
    assert.match(page, /const load = useCallback\(async \(\) => \{[\s\S]*?\}, \[query\]\)/);
    assert.doesNotMatch(page, /\[startDate, endDate, q, year, month, customerId\]/);
  });

  it("Status econômico é enviado ao backend (economicStatus), não só filtrado no cliente", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    const service = read(
      "src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts"
    );
    assert.match(page, /economicStatus/);
    assert.match(page, /params\.set\("economicStatus", filters\.economicStatus\)/);
    assert.match(service, /parseInvestedCapitalRecoveryStatusParam\(\s*input\.query\.economicStatus\s*\)/);
    assert.match(
      service,
      /economicStatusFilter\s*\n\s*\?\s*allRows\.filter\(\(r\) => r\.status === economicStatusFilter\)\s*\n\s*: allRows/
    );
  });

  it("filtro de status econômico é aplicado ANTES dos KPIs/aging/top clientes (mesma população em toda a tela)", () => {
    const service = read(
      "src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts"
    );
    const rowsIdx = service.indexOf("const rows = economicStatusFilter");
    const kpisIdx = service.indexOf("const withCapital = rows.filter");
    assert.ok(rowsIdx > 0 && kpisIdx > 0 && rowsIdx < kpisIdx);
  });

  it("PDF reutiliza o padrão sistêmico de Pedido de Venda (mesmo CSS, mesmo body class de print-route)", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    const doc = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx"
    );
    assert.match(page, /sales-order-report-print\.css/);
    assert.match(page, /sales-orders-print-route/);
    assert.match(page, /sales-orders-icr-print-route/);
    assert.match(doc, /id="sales-orders-print-root"/);
    assert.match(doc, /PrintHeader/);
    assert.match(doc, /sales-orders-print-summary-grid/);
    assert.match(doc, /sales-orders-icr-print-table/);
  });

  it("documento de impressão é portalizado para document.body (não renderizado inline na árvore) — sem isso o CSS de print-route esconde o #root e leva o print-root junto, gerando PDF em branco", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, /import \{ createPortal \} from "react-dom";/);
    assert.match(
      page,
      /createPortal\(\s*\n\s*<InvestedCapitalRecoveryPrintDocument[\s\S]{0,300}?,\s*\n\s*document\.body\s*\n\s*\)/
    );
  });

  it("botão Imprimir PDF busca com os filtros aplicados (não os rascunhos ainda não pesquisados)", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, /handleExportPdf = useCallback\(async \(\) => \{[\s\S]*?query[\s\S]*?\}, \[appliedFilters, ensureBranding, exportingPdf, query\]\)/);
  });
});
