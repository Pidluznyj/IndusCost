import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FINANCE_UI_SECTIONS } from "../internalSurfaceAccess.js";
import { FINANCE_SECTIONS, getFinanceSectionPath } from "../financeNavigation.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "../financeModulesAccess.js";
import { ResourceKeys } from "../permissionsClient.js";
import { resolveExecutiveDashboardYearContext } from "../executiveDashboardYear.js";
import {
  formatFinanceKpiCurrency,
  formatFinanceKpiVariationPercent,
} from "../financeKpiFormat.js";

const ROOT = process.cwd();

describe("Finance One Page — wiring", () => {
  it("rota, aba e contrato apontam para a mesma superfície", () => {
    assert.equal(getFinanceSectionPath("one-page"), "/finance/one-page");
    assert.equal(FINANCE_SECTIONS[0]?.id, "one-page");
    const tab = FINANCE_UI_SECTIONS.find((s) => s.id === "one-page");
    assert.ok(tab);
    assert.equal(tab?.path, "/finance/one-page");
    assert.equal(tab?.resourceKey, "finance.one_page");
    assert.equal(tab?.contractKey, "finance.one_page");
    assert.equal(ResourceKeys.FINANCE_ONE_PAGE, "finance.one_page");
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.onePage, "finance.one_page");
  });

  it("módulo e API registram One Page sem importar o app administrativo no bundle público", () => {
    const mod = readFileSync(join(ROOT, "src/components/FinanceModule.tsx"), "utf8");
    const server = readFileSync(join(ROOT, "server.ts"), "utf8");
    const page = readFileSync(join(ROOT, "src/components/finance/FinanceOnePage.tsx"), "utf8");
    assert.match(mod, /path="one-page"/);
    assert.match(mod, /FinanceOnePage/);
    assert.match(server, /\/api\/finance\/one-page/);
    assert.match(server, /FINANCE_MODULE_RESOURCE_KEYS\.onePage/);
    assert.match(page, /finance\.onePage\.view/);
    assert.equal(page.includes("onePageService.server"), false);
    assert.equal(page.includes("ytdGrowthPercentFormatted"), false);
  });
});

describe("One Page — formatadores reutilizados", () => {
  it("resolveExecutiveDashboardYearContext parses year context correctly", () => {
    const now = new Date("2026-08-27T09:15:00Z");
    const ctx = resolveExecutiveDashboardYearContext("2026", now);
    assert.equal(ctx.selectedYear, 2026);
    assert.equal(ctx.previousYear, 2025);
    assert.equal(ctx.isSelectedYearCurrent, true);
  });

  it("formatFinanceKpiCurrency formats millions and thousands correctly", () => {
    assert.equal(formatFinanceKpiCurrency(1250000), "R$\u00a01,25\u00a0Mi");
    assert.equal(formatFinanceKpiCurrency(15000), "R$\u00a015,0\u00a0mil");
    assert.equal(formatFinanceKpiCurrency(450), "R$\u00a0450,00");
  });

  it("formatFinanceKpiVariationPercent adds signs and formats decimals", () => {
    assert.equal(formatFinanceKpiVariationPercent(12.42), "+12,4%");
    assert.equal(formatFinanceKpiVariationPercent(-5.28), "-5,3%");
    assert.equal(formatFinanceKpiVariationPercent(0), "0,0%");
  });
});
