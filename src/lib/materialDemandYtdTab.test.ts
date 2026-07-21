import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  defaultMaterialDemandTab,
  MATERIAL_DEMAND_TABS,
  materialDemandTabNeedsRows,
  resolveMaterialDemandYtdPeriod,
} from "@/src/components/contextual/materialDemandDashboardUi";
import { buildDefaultMaterialDemandUiFilters } from "@/src/lib/materialDemandFilters";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("materialDemandYtdTab", () => {
  it("aba YTD é a padrão em Pedidos de venda e precisa de rows", () => {
    assert.equal(defaultMaterialDemandTab("sales-orders"), "ytd");
    assert.equal(defaultMaterialDemandTab("products"), "summary");
    assert.ok(MATERIAL_DEMAND_TABS.some((t) => t.id === "ytd" && t.label === "YTD por MP"));
    assert.equal(materialDemandTabNeedsRows("ytd"), true);
  });

  it("defaults de sales-orders usam emissão YTD", () => {
    const f = buildDefaultMaterialDemandUiFilters("sales-orders");
    const ytd = resolveMaterialDemandYtdPeriod();
    assert.equal(f.dateBasis, "issueDate");
    assert.equal(f.startDate, ytd.startDate);
    assert.equal(f.endDate, ytd.endDate);
  });

  it("UI expõe grid Código/Descrição/Qtde/Valor por quilo/Valor total e KPIs", () => {
    const panels = read("src/components/contextual/MaterialDemandDashboardPanels.tsx");
    const dash = read("src/components/contextual/ProductMaterialDemandDashboard.tsx");
    assert.match(panels, /MaterialDemandYtdKpiGrid/);
    assert.match(panels, /MaterialDemandYtdMaterialsTable/);
    assert.match(panels, /Valor total YTD/);
    assert.match(panels, /Valor por quilo/);
    assert.match(panels, />Código</);
    assert.match(panels, />Descrição</);
    assert.match(panels, />Qtde</);
    assert.match(panels, />Valor total</);
    assert.match(dash, /activeTab === "ytd"/);
    assert.match(dash, /material-demand-ytd-tab/);
    assert.match(dash, /resolveMaterialDemandYtdPeriod/);
  });

  it("paginação YTD usa contrato pagination/onPrev/onNext (evita crash totalPages)", () => {
    const dash = read("src/components/contextual/ProductMaterialDemandDashboard.tsx");
    const ytdIdx = dash.lastIndexOf("<MaterialDemandYtdMaterialsTable");
    assert.ok(ytdIdx >= 0);
    const ytdBlock = dash.slice(ytdIdx, ytdIdx + 600);
    assert.match(ytdBlock, /MaterialDemandTablePagination/);
    assert.match(ytdBlock, /pagination=\{pagination\}/);
    assert.match(ytdBlock, /onPrev=\{/);
    assert.match(ytdBlock, /onNext=\{/);
    assert.doesNotMatch(ytdBlock, /onPageChange=/);
    assert.doesNotMatch(ytdBlock, /totalPages=\{pagination\.totalPages\}/);

    const panels = read("src/components/contextual/MaterialDemandDashboardPanels.tsx");
    assert.match(panels, /if\s*\(\s*!pagination\s*\|\|\s*pagination\.totalPages\s*<=\s*1\s*\)/);
  });
});
