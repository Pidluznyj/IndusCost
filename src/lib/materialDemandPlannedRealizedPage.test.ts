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

test("painel usa MaterialUsageAuditDrawer lateral", () => {
  const panel = readPanel();
  assert.match(panel, /MaterialUsageAuditDrawer/);
  assert.doesNotMatch(panel, /MaterialPlannedRealizedDrillDown/);
  assert.doesNotMatch(panel, /expandedMaterialId/);
});

test("coluna Dif. R$ e botão Auditar abrem drawer", () => {
  const panel = readPanel();
  assert.match(panel, /data-testid="material-usage-audit-cost-diff-button"/);
  assert.match(panel, /data-testid="material-usage-audit-button"/);
  assert.match(panel, /openAudit\(row\)/);
  assert.match(panel, /cursor-pointer/);
});

test("drawer mostra resumo, equações e abas", () => {
  const drawer = readDrawer();
  assert.match(drawer, /data-testid="material-usage-audit-drawer"/);
  assert.match(drawer, /data-testid="material-usage-audit-summary-equation"/);
  assert.match(drawer, /data-testid="material-usage-audit-cost-equation"/);
  assert.match(drawer, /testId="material-usage-audit-products-table"/);
  assert.match(drawer, /testId="material-usage-audit-planned-orders"/);
  assert.match(drawer, /testId="material-usage-audit-realized-orders"/);
  assert.match(drawer, /data-testid="material-usage-audit-loading"/);
  assert.match(drawer, /data-testid="material-usage-audit-close"/);
  assert.match(drawer, /MATERIAL_USAGE_AUDIT_FISCAL_NOTE/);
});

test("drawer carrega endpoint details com filtros", () => {
  const drawer = readDrawer();
  assert.match(drawer, /planned-vs-realized\/materials/);
  assert.match(drawer, /materialDemandUiFiltersToQueryParams/);
  assert.match(drawer, /res\.audit/);
});
