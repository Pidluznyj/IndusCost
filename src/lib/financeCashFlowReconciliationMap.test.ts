import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_CASH_FLOW_CONCEPT_EQUIVALENCES,
  FINANCE_CASH_FLOW_OFFICIAL_AP_BASE,
  FINANCE_CASH_FLOW_OFFICIAL_AR_BASE,
  FINANCE_CASH_FLOW_RECONCILIATION_MAP,
  FINANCE_CASH_FLOW_RECONCILIATION_RISKS,
  FINANCE_CASH_FLOW_REQUIRED_UI_BLOCKS,
  FINANCE_CASH_FLOW_TIMELINE_ORACLE,
  getReconciliationEntryById,
  listApOfficialEntries,
  listArOfficialEntries,
  listReconciliationEntriesWithAlternatePath,
  listReconciliationEntriesWithConceptualException,
  validateReconciliationMapCoverage,
} from "./financeCashFlowReconciliationMap.js";

describe("financeCashFlowReconciliationMap", () => {
  it("mapa cobre todos os blocos obrigatórios da auditoria", () => {
    const coverage = validateReconciliationMapCoverage();
    assert.equal(
      coverage.missingRequiredBlocks.length,
      0,
      `Blocos faltando: ${coverage.missingRequiredBlocks.join(", ")}`
    );
    assert.equal(coverage.duplicateIds.length, 0);
    assert.equal(coverage.entriesWithoutSource.length, 0);
    assert.equal(coverage.ok, true);
    assert.equal(
      FINANCE_CASH_FLOW_REQUIRED_UI_BLOCKS.length,
      18,
      "Lista de blocos obrigatórios deve ter 18 itens"
    );
  });

  it("cada entrada tem id, payloadPath, sourceModule e sourceFunction", () => {
    for (const entry of FINANCE_CASH_FLOW_RECONCILIATION_MAP) {
      assert.ok(entry.id.length > 0, `id vazio em ${entry.label}`);
      assert.ok(entry.payloadPath.length > 0, `payloadPath vazio em ${entry.id}`);
      assert.ok(entry.sourceModule.endsWith(".ts"), entry.id);
      assert.ok(entry.sourceFunction.length > 5, entry.id);
      assert.ok(entry.uiBlock.length > 0, entry.id);
    }
  });

  it("oráculo interno documenta linha do tempo executiva e série mensal", () => {
    assert.equal(
      FINANCE_CASH_FLOW_TIMELINE_ORACLE.executiveMonthlyTimeline.builder,
      "buildExecutiveMonthlyTimeline"
    );
    assert.equal(
      FINANCE_CASH_FLOW_TIMELINE_ORACLE.periodMonthlySeries.builder,
      "buildFinanceCashFlowMonthlySeries"
    );
    assert.match(
      FINANCE_CASH_FLOW_TIMELINE_ORACLE.executiveMonthlyTimeline.rowFilter,
      /filterFinanceArManagementReportRows/
    );
    assert.match(
      FINANCE_CASH_FLOW_TIMELINE_ORACLE.periodMonthlySeries.rowFilter,
      /filterCashFlowArRowsScoped/
    );

    const timelineEntry = getReconciliationEntryById("monthly_timeline_chart")!;
    assert.equal(timelineEntry.usesExecutiveTimeline, true);
    assert.equal(timelineEntry.rowScope, "executive_timeline");

    const seriesEntry = getReconciliationEntryById("monthly_series")!;
    assert.equal(seriesEntry.usesMonthlyTimeline, true);
    assert.equal(seriesEntry.rowScope, "period");
  });

  it("equivalências AR/AP documentam vencidos, carteira e período", () => {
    const concepts = FINANCE_CASH_FLOW_CONCEPT_EQUIVALENCES.map((c) => c.cashFlowConcept);
    assert.ok(concepts.some((c) => c.includes("overdueReceivables")));
    assert.ok(concepts.some((c) => c.includes("totalReceivableOpen")));
    assert.ok(concepts.some((c) => c.includes("totalPayableOpen")));
    assert.ok(concepts.some((c) => c.includes("inflowAmount")));
    assert.ok(concepts.some((c) => c.includes("outflowAmount")));
  });

  it("bases oficiais AR/AP referenciam funções de management", () => {
    assert.match(FINANCE_CASH_FLOW_OFFICIAL_AR_BASE, /filterFinanceArManagementReportRows/);
    assert.match(FINANCE_CASH_FLOW_OFFICIAL_AR_BASE, /isFinanceArAllowedInManagementReport/);
    assert.match(FINANCE_CASH_FLOW_OFFICIAL_AP_BASE, /filterFinanceApManagementReportRows/);
  });

  it("entradas AR oficiais aplicam freshness e regra NF para vencidos", () => {
    const arEntries = listArOfficialEntries().filter((e) => e.rowScope !== "load_only");
    assert.ok(arEntries.length >= 10);
    for (const entry of arEntries) {
      assert.equal(entry.freshnessExcluded, true, entry.id);
      assert.notEqual(entry.arOverdueNfRule, "n/a", entry.id);
    }
  });

  it("entradas AP oficiais aplicam intercompany, PO e data operacional quando aberto", () => {
    const apOpenEntries = listApOfficialEntries().filter(
      (e) =>
        e.apOperationalDate === true ||
        e.label.toLowerCase().includes("a pagar") ||
        e.label.toLowerCase().includes("saída")
    );
    assert.ok(apOpenEntries.length >= 5);
    for (const entry of apOpenEntries) {
      assert.equal(entry.apIntercompanyExcluded, true, entry.id);
      assert.equal(entry.apPurchaseOrderExcluded, true, entry.id);
    }
  });

  it("exceções conceituais estão explicitamente documentadas", () => {
    const exceptions = listReconciliationEntriesWithConceptualException();
    assert.ok(exceptions.length >= 5);
    const ids = exceptions.map((e) => e.id);
    assert.ok(ids.includes("exec_received_ytd"));
    assert.ok(ids.includes("exec_paid_ytd"));
    assert.ok(ids.includes("monthly_timeline_chart"));
    assert.ok(ids.includes("conservative_scenario"));
  });

  it("riscos identificam blocos com motor alternativo", () => {
    assert.ok(FINANCE_CASH_FLOW_RECONCILIATION_RISKS.length >= 6);
    const r1 = FINANCE_CASH_FLOW_RECONCILIATION_RISKS.find(
      (r) => r.id === "R1_executive_timeline_vs_period_series"
    )!;
    assert.ok(r1.affectedBlocks.includes("executiveSummary.monthlyTimeline"));
    assert.equal(r1.severity, "high");

    const alternates = listReconciliationEntriesWithAlternatePath();
    assert.ok(alternates.length >= 8);
  });

  it("vencidos a receber mapeiam para isFinanceArOverdueRow e AR Atrasados", () => {
    const overdue = getReconciliationEntryById("overdue_receivables_list")!;
    assert.match(overdue.sourceFunction, /isFinanceArOverdueRow/);
    assert.equal(overdue.arOverdueNfRule, true);
    assert.match(overdue.arEquivalent!, /Overdue/);
    assert.equal(overdue.rowScope, "portfolio");
  });

  it("pagamentos vencidos mapeiam para AP gerencial com data operacional", () => {
    const overdueAp = getReconciliationEntryById("overdue_payables_list")!;
    assert.match(overdueAp.sourceFunction, /isFinanceCashFlowApOverdueRow/);
    assert.equal(overdueAp.apOperationalDate, true);
    assert.equal(overdueAp.apIntercompanyExcluded, true);
  });

  it("exportação e auditoria técnica estão no mapa", () => {
    assert.ok(getReconciliationEntryById("export_csv"));
    assert.ok(getReconciliationEntryById("audit_payload"));
    assert.equal(getReconciliationEntryById("export_csv")!.respectsAppliedFilters, true);
    assert.equal(getReconciliationEntryById("audit_payload")!.uiTab, "audit");
  });

  it("blocos críticos vivos vêm de buildBlocksFromPortfolio via dataset", () => {
    const inflows = getReconciliationEntryById("largest_projected_inflows")!;
    assert.match(inflows.sourceFunction, /buildBlocksFromPortfolio/);

    const dashboardSrc = readFileSync(
      join(process.cwd(), "src/lib/financeCashFlowDashboard.ts"),
      "utf8"
    );
    const datasetSrc = readFileSync(
      join(process.cwd(), "src/lib/financeCashFlowDataset.ts"),
      "utf8"
    );
    assert.match(datasetSrc, /buildBlocksFromPortfolio/);
    assert.match(dashboardSrc, /buildFinanceCashFlowDataset\(/);
    assert.doesNotMatch(
      dashboardSrc,
      /buildCriticalMovements\(\s*arPortfolio/
    );
  });

  it("UI ativa referencia payload paths mapeados", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const riskSrc = readFileSync(
      join(process.cwd(), "src/components/finance/cash-flow/FinanceCashFlowRiskTab.tsx"),
      "utf8"
    );
    const pagePaths = [
      "executiveSummary",
      "reconciliation",
      "executiveYtd",
      "largestProjectedInflows",
      "overdueReceivables",
      "overduePayables",
      "topCustomers",
      "topSuppliers",
      "calendar",
    ];
    for (const path of pagePaths) {
      assert.match(pageSrc, new RegExp(path), `FinanceCashFlowPage deve usar ${path}`);
    }
    const riskPaths = ["cashHealthScore", "conservativeScenario", "stressScenario", "cashForecast"];
    for (const path of riskPaths) {
      assert.match(riskSrc, new RegExp(path), `FinanceCashFlowRiskTab deve usar ${path}`);
    }
  });

  it("reconciliação expõe paridade com dashboards AR/AP oficiais", () => {
    const recon = getReconciliationEntryById("reconciliation_ledger")!;
    assert.match(recon.arEquivalent!, /buildFinanceAccountsReceivableDashboard/);
    assert.match(recon.apEquivalent!, /buildFinanceAccountsPayableDashboard/);
    assert.match(recon.sourceFunction, /buildCashFlowReconciliation/);
  });
});
