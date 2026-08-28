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

describe("One Page — fonte canônica (gates eliminatórios)", () => {
  const service = readFileSync(
    join(ROOT, "src/lib/finance/onePageService.server.ts"),
    "utf8"
  );
  const salesMetrics = readFileSync(
    join(ROOT, "src/lib/salesOrdersDashboardMetrics.ts"),
    "utf8"
  );

  it("F — Faturamento usa o MESMO motor NF-e da tela oficial (emissao), nunca a variante de pedidos", () => {
    assert.match(service, /buildBillingDashboardFromNfes/);
    assert.match(service, /buildBillingDashboardFromNfes\(period\.yearCtx,\s*"emissao"\)/);
    assert.equal(service.includes("buildBillingDashboardTab"), false);
  });

  it("Pedidos usam o motor canônico buildSalesOrdersDashboardTab", () => {
    assert.match(service, /buildSalesOrdersDashboardTab/);
  });

  it("sem IDs fantasmas de billing no serviço", () => {
    for (const ghost of [
      "billing_net_found",
      "billing_ytd_current",
      "billing_ytd_previous",
      "billing_delta_prev_year_month_percent",
    ]) {
      assert.equal(service.includes(ghost), false, ghost);
    }
  });

  it("sem hack do dia 28 no serviço e no motor de pedidos", () => {
    assert.doesNotMatch(service, /28,\s*23,\s*59/);
    assert.doesNotMatch(salesMetrics, /Math\.min\(ref\.getDate\(\),\s*28\)/);
    assert.match(salesMetrics, /resolveComparablePreviousYearReference/);
  });

  it("motor de pedidos expõe o YTD anterior comparável (corte simétrico)", () => {
    assert.match(salesMetrics, /previousYearComparableYtd/);
  });

  it("margem delega ao agregado ponderado canônico (nunca média simples), com exclusão intercompany", () => {
    assert.match(service, /aggregateCommercialMarginSummaries/);
    assert.match(service, /getSalesOrdersCommercialMargins/);
    assert.match(service, /isIntercompanySalesOrder/);
    assert.match(service, /buildSalesOrderListWhere/);
  });

  it("código morto removido (pedPrevYearFullNet) e mapper puro em uso", () => {
    assert.equal(service.includes("pedPrevYearFullNet"), false);
    assert.match(service, /buildOnePagePayload/);
    assert.match(service, /resolveOnePagePeriod/);
  });

  it("resumo DRE vem EXCLUSIVAMENTE do snapshot — sem motor live no One Page", () => {
    assert.match(service, /getFinanceDreOnePageSummaryFromSnapshot/);
    for (const heavy of [
      "buildFinanceDreReport(",
      "loadFinanceDreRawSourceSeries",
      "queryMonthlyFiscalNfe",
      "queryMonthlyFiscalNfeDeductions",
      "loadMonthlyCmvFromNfeProductCosts",
      "buildFinanceCostCenterDashboardDefault(",
    ]) {
      // buildFinanceCostCenterDashboardDefault é permitido apenas via os
      // motores próprios do One Page? Não — o One Page não o usa diretamente.
      if (heavy === "buildFinanceCostCenterDashboardDefault(") {
        assert.equal(service.includes(heavy), false, heavy);
        continue;
      }
      assert.equal(service.includes(heavy), false, heavy);
    }
  });

  it("seção DRE na UI: rótulo canônico de Deduções, nunca 'imposto pago', presente na superfície compartilhada", () => {
    const page = readFileSync(
      join(ROOT, "src/components/finance/FinanceOnePage.tsx"),
      "utf8"
    );
    assert.match(page, /DRE Gerencial — Resumo do Período/);
    assert.match(page, /Deduções sobre Vendas/);
    assert.equal(/imposto pago/i.test(page), false);
    // Cascata narrativa completa, na ordem da DRE, com explicação para leigos.
    const cascadeLabels = [
      "Receita Bruta",
      "Deduções sobre Vendas",
      "Receita Líquida",
      '"Custos"',
      "Lucro Bruto",
      "Despesas Operacionais",
      "Resultado Operacional",
    ];
    let cursor = -1;
    for (const label of cascadeLabels) {
      const idx = page.indexOf(label, cursor + 1);
      assert.ok(idx > cursor, `cascata fora de ordem ou ausente: ${label}`);
      cursor = idx;
    }
    // Redação por competência (faturamento), nunca linguagem de caixa.
    assert.match(page, /Tudo o que foi faturado em vendas/);
    assert.match(page, /Impostos e tributos considerados pela DRE/);
    assert.equal(page.includes("entrou em vendas"), false);
    assert.equal(page.includes("Impostos destacados nas notas"), false);
    assert.match(page, /DreFlowRow/);
    // Renderizada dentro do OnePageReportBody (tela + impressão A4/JPEG).
    const bodyIdx = page.indexOf("function OnePageReportBody");
    const sectionIdx = page.indexOf("OnePageDreSummarySection");
    assert.ok(bodyIdx > 0 && sectionIdx > bodyIdx);
    assert.match(page, /Atualização pendente/);
    assert.match(page, /Dados da DRE em preparação/);
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
