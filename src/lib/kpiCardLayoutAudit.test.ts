import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getKpiLayoutAuditFixedEntries,
  getKpiLayoutAuditById,
  KPI_CARD_LAYOUT_AUDIT,
  KPI_LAYOUT_FORBIDDEN_PATTERNS,
} from "./kpiCardLayoutAudit.js";

describe("kpiCardLayoutAudit", () => {
  it("lista telas obrigatórias da varredura", () => {
    assert.ok(KPI_CARD_LAYOUT_AUDIT.length >= 14);
    const ids = KPI_CARD_LAYOUT_AUDIT.map((e) => e.id);
    assert.ok(ids.includes("sold-product-customers"));
    assert.ok(ids.includes("finance-executive-report"));
    assert.ok(ids.includes("customer-intelligence"));
    assert.ok(ids.includes("finance-cash-flow-ytd"));
  });

  it("telas prioritárias marcadas como fixed", () => {
    const fixed = getKpiLayoutAuditFixedEntries();
    const fixedIds = fixed.map((e) => e.id);
    for (const id of [
      "sold-product-customers",
      "sold-products-report",
      "finance-ar",
      "finance-ap",
      "finance-ar-overdue",
      "finance-cash-flow-ytd",
      "finance-executive-report",
      "customer-intelligence",
    ]) {
      assert.ok(fixedIds.includes(id), `expected fixed: ${id}`);
    }
  });

  it("CSS global usa grid auto-fit minmax 220px", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/indus-kpi-grid.css"), "utf8");
    assert.match(css, /repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/);
    assert.match(css, /indus-kpi-value/);
    assert.match(css, /text-overflow:\s*ellipsis/);
  });

  it("telas corrigidas não usam grid fixo 7 ou 8 colunas em KPIs", () => {
    const checks: Array<{ file: string; forbidden: RegExp }> = [
      {
        file: "src/components/commercial/SoldProductCustomersPage.tsx",
        forbidden: /xl:grid-cols-8/,
      },
      {
        file: "src/components/finance/cash-flow/FinanceCashFlowYtdSummary.tsx",
        forbidden: /xl:grid-cols-6/,
      },
      {
        file: "src/components/finance/shared/FinanceHorizonSection.tsx",
        forbidden: /2xl:grid-cols-6/,
      },
    ];
    for (const { file, forbidden } of checks) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.equal(forbidden.test(src), false, `${file} still has forbidden KPI grid`);
    }
  });

  it("FinanceBiKpiCard suporta amountFormat currency/number/percent", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/finance/bi/FinanceBiKpiCard.tsx"),
      "utf8"
    );
    assert.ok(src.includes("amountFormat"));
    assert.ok(src.includes("formatKpiCompactCurrency"));
    assert.ok(src.includes("MetricCard"));
  });

  it("padrões proibidos documentados para KPI grids", () => {
    assert.ok(KPI_LAYOUT_FORBIDDEN_PATTERNS.includes("xl:grid-cols-8"));
    assert.ok(KPI_LAYOUT_FORBIDDEN_PATTERNS.includes("grid-cols-7"));
  });

  it("getKpiLayoutAuditById retorna entrada conhecida", () => {
    const entry = getKpiLayoutAuditById("sold-product-customers");
    assert.equal(entry?.status, "fixed");
    assert.match(entry?.fix ?? "", /indus-kpi-grid/);
  });
});
