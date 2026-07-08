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
