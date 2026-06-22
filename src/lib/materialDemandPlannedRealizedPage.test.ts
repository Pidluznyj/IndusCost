import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readPanel(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialDemandPlannedRealizedPanel.tsx"),
    "utf8"
  );
}

function readDrawer(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialUsageAuditDrawer.tsx"),
    "utf8"
  );
}

test("painel usa drawer lateral — sanfona inline removida", () => {
  const panel = readPanel();
  assert.match(panel, /MaterialUsageAuditDrawer/);
  assert.match(panel, /enableIntelligence/);
  assert.doesNotMatch(panel, /MaterialPlannedRealizedDrillDown/);
  assert.doesNotMatch(panel, /expandedMaterialId/);
});

test("tabela principal exibe Ped. não fat. e % faturado", () => {
  const panel = readPanel();
  assert.match(panel, /Ped\. não fat\./);
  assert.match(panel, /% faturado/);
  assert.match(panel, /notInvoicedOrdersCount/);
  assert.match(panel, /invoicedPercent/);
});

test("clique em Dif. R$, Saldo e Auditar abrem drawer", () => {
  const panel = readPanel();
  assert.match(panel, /data-testid="material-usage-audit-cost-diff-button"/);
  assert.match(panel, /data-testid="material-usage-audit-balance-button"/);
  assert.match(panel, /data-testid="material-usage-audit-button"/);
  assert.match(panel, /openAudit\(row\)/);
});

test("drawer mostra resumo comparativo e ponte da diferença", () => {
  const drawer = readDrawer();
  assert.match(drawer, /data-testid="material-usage-audit-drawer"/);
  assert.match(drawer, /data-testid="material-usage-audit-summary-equation"/);
  assert.match(drawer, /data-testid="material-usage-audit-cost-equation"/);
  assert.match(drawer, /data-testid="material-usage-audit-difference-bridge"/);
  assert.match(drawer, /MATERIAL_USAGE_AUDIT_DIFFERENCE_BRIDGE_TITLE/);
  assert.match(drawer, /A faturar/);
  assert.match(drawer, /Faturado/);
});

test("drawer lista comparativo, não faturados, parciais e faturados", () => {
  const drawer = readDrawer();
  assert.match(drawer, /testId="material-usage-audit-products-table"/);
  assert.match(drawer, /testId="material-usage-audit-not-invoiced-orders"/);
  assert.match(drawer, /testId="material-usage-audit-partial-orders"/);
  assert.match(drawer, /testId="material-usage-audit-realized-orders"/);
  assert.match(drawer, /notInvoicedOrders/);
  assert.match(drawer, /partiallyInvoicedOrders/);
});

test("drawer carrega endpoint sob demanda com filtros", () => {
  const drawer = readDrawer();
  assert.match(drawer, /planned-vs-realized\/materials/);
  assert.match(drawer, /materialDemandUiFiltersToQueryParams/);
  assert.match(drawer, /res\.audit/);
});
