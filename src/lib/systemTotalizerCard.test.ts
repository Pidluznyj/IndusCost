import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  receiptClosingStatusBadgeLabel,
  receiptClosingStatusBadgeTone,
} from "../components/ui/SystemTotalizerCard";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("SystemTotalizerCard", () => {
  const COMPONENT = "src/components/ui/SystemTotalizerCard.tsx";
  const CSS = "src/components/ui/system-totalizer-card.css";

  it("componente padrão existe", () => {
    assert.ok(existsSync(join(ROOT, COMPONENT)));
    const src = read(COMPONENT);
    assert.match(src, /export function SystemTotalizerCard/);
    assert.match(src, /export const ExecutiveTotalizerCard/);
  });

  it("CSS executivo evita font-weight 800 e tamanhos gigantes", () => {
    assert.ok(existsSync(join(ROOT, CSS)));
    const css = read(CSS);
    assert.match(css, /font-weight:\s*600/);
    assert.doesNotMatch(css, /font-weight:\s*800/);
    assert.doesNotMatch(css, /text-4xl|text-5xl|font-black/);
    assert.match(css, /white-space:\s*nowrap/);
    assert.match(css, /text-overflow:\s*ellipsis/);
  });

  it("valores longos e logs usam wrap proporcional", () => {
    const css = read(CSS);
    assert.match(css, /metric-card-value--wrap/);
    assert.match(css, /metric-card-value--text/);
  });

  it("status de comissão renderiza como badge proporcional", () => {
    assert.equal(receiptClosingStatusBadgeLabel("PREVIEW"), "Prévia");
    assert.equal(receiptClosingStatusBadgeTone("PREVIEW"), "warning");
    assert.equal(receiptClosingStatusBadgeLabel("CLOSED"), "Fechado");
    assert.equal(receiptClosingStatusBadgeTone("CLOSED"), "success");
    const css = read(CSS);
    assert.match(css, /system-totalizer-badge/);
  });
});

describe("SystemTotalizerCard — telas migradas fase 1", () => {
  it("Financeiro Pedidos de Venda usa card padrão", () => {
    const src = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(src, /SystemTotalizerCard/);
    assert.match(src, /SYSTEM_TOTALIZER_GRID_CLASS/);
    assert.doesNotMatch(src, /FinanceKpiCard/);
    assert.match(src, /Meta não configurada/);
    assert.match(src, /valueSize=\{summary\.monthTargetConfigured \? "default" : "text"\}/);
  });

  it("Comercial Pedidos de Venda usa card padrão", () => {
    const src = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    assert.match(src, /SystemTotalizerCard/);
    assert.match(src, /SYSTEM_TOTALIZER_GRID_CLASS/);
    assert.doesNotMatch(src, /FinanceKpiCard|FinanceBiKpiCard/);
  });

  it("Comissões fechamento/liberação usa card padrão", () => {
    for (const file of [
      "src/components/commissions/pages/CommissionsReceiptClosingPage.tsx",
      "src/components/commissions/pages/CommissionsReleasesPage.tsx",
      "src/components/commissions/commissionsUi.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /SystemTotalizerCard/, `${file} deve usar SystemTotalizerCard`);
      assert.doesNotMatch(src, /FinanceKpiCard/, `${file} não deve usar FinanceKpiCard`);
    }
    const closing = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
    assert.match(closing, /receiptClosingStatusBadgeLabel/);
    assert.match(closing, /badge=\{/);
  });

  it("Logs Nomus usa card padrão via adminUi", () => {
    const adminUi = read("src/components/admin/adminUi.tsx");
    assert.match(adminUi, /SystemTotalizerCard/);
    assert.match(adminUi, /SYSTEM_TOTALIZER_GRID_CLASS/);
    for (const file of [
      "src/components/NomusDailySyncCard.tsx",
      "src/components/NomusAccountsPayableSyncCard.tsx",
      "src/components/NomusAccountsReceivableSyncCard.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /nomusSyncMetrics/, `${file} deve usar nomusSyncMetrics`);
    }
  });

  it("Fluxo de Caixa delega ao card padrão", () => {
    const src = read("src/components/finance/cash-flow/FinanceCashFlowExecutiveMetricCard.tsx");
    assert.match(src, /SystemTotalizerCard/);
  });
});

describe("SystemTotalizerCard — financeiro fase 2", () => {
  const FINANCE_MIGRATED = [
    "src/components/finance/FinanceAccountsReceivablePage.tsx",
    "src/components/finance/FinanceAccountsReceivableOverdueTab.tsx",
    "src/components/finance/FinanceAccountsPayablePage.tsx",
    "src/components/finance/FinanceBillingPage.tsx",
    "src/components/finance/FinanceArAnalyticalTitlesTab.tsx",
    "src/components/finance/shared/FinanceHorizonSection.tsx",
    "src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx",
    "src/components/finance/billing/FinanceBillingHorizonDrilldownSection.tsx",
    "src/components/finance/billing/FinanceBillingExecutiveCard.tsx",
    "src/components/finance/executive-report/ExecutiveKpiCard.tsx",
    "src/components/finance/executive-report/ExecutiveKpiGrid.tsx",
  ];

  const CC_PRESERVED = [
    "src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary.tsx",
    "src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx",
    "src/components/finance/cost-centers/FinanceCostCenterDetailPage.tsx",
    "src/components/finance/executive-report/ExecutiveCostCenterTopCardsGrid.tsx",
  ];

  it("telas financeiras migradas usam FinanceExecutiveTotalizerCard ou SystemTotalizerCard", () => {
    for (const file of FINANCE_MIGRATED) {
      const src = read(file);
      assert.match(
        src,
        /FinanceExecutiveTotalizerCard|SystemTotalizerCard/,
        `${file} deve usar card executivo`
      );
      assert.doesNotMatch(src, /FinanceBiKpiCard/, `${file} não deve usar FinanceBiKpiCard`);
      assert.doesNotMatch(src, /<FinanceKpiCard/, `${file} não deve usar FinanceKpiCard`);
    }
  });

  it("Centro de Custo aprovado permanece intacto", () => {
    for (const file of CC_PRESERVED) {
      const src = read(file);
      if (file.includes("ExpenseMapExecutiveSummary")) {
        assert.match(src, /MetricCard/);
      }
      if (file.includes("OverviewTab") || file.includes("DetailPage")) {
        assert.match(src, /FinanceKpiCard/);
      }
      if (file.includes("ExecutiveCostCenterTopCardsGrid")) {
        assert.match(src, /FinanceCostCenterExpenseMapExecutiveSummary/);
        assert.doesNotMatch(src, /SystemTotalizerCard/);
      }
    }
  });

  it("ponte FinanceExecutiveTotalizerCard existe", () => {
    const src = read("src/components/finance/shared/FinanceExecutiveTotalizerCard.tsx");
    assert.match(src, /SystemTotalizerCard/);
  });
});
