import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowAuditSections,
  buildFinanceSanitizationAuditRows,
  countFinanceDataAuditWarnings,
} from "./financeDataAudit.js";
import { FINANCE_MANAGEMENT_SANITIZATION_SCOPE } from "./financeFilterScope.js";
import { createDefaultFinanceCashFlowUiFilters } from "./financeCashFlowDashboardTypes.js";

describe("financeDataAudit", () => {
  it("seções de auditoria incluem fonte, sync, filtros e regras", () => {
    const sections = buildFinanceCashFlowAuditSections(null, createDefaultFinanceCashFlowUiFilters(2026));
    const ids = sections.map((s) => s.id);
    assert.ok(ids.includes("sources"));
    assert.ok(ids.includes("sync"));
    assert.ok(ids.includes("filters"));
    assert.ok(ids.includes("rules"));
  });

  it("regras gerenciais usam linguagem executiva, não texto técnico longo do banner", () => {
    const sections = buildFinanceCashFlowAuditSections(null, createDefaultFinanceCashFlowUiFilters(2026));
    const rules = sections.find((s) => s.id === "rules");
    assert.equal(rules?.kind, "paragraphs");
    if (rules?.kind === "paragraphs") {
      assert.equal(rules.paragraphs.includes(FINANCE_MANAGEMENT_SANITIZATION_SCOPE), false);
      assert.ok(rules.paragraphs.some((p) => p.includes("movimentos internos do grupo")));
    }
  });

  it("conta avisos de saneamento e conciliação", () => {
    const warnings = countFinanceDataAuditWarnings({
      dataSanitization: {
        ignoredInternalGroupReceivables: 2,
        ignoredInternalGroupPayables: 0,
        ignoredGhostReceivables: 1,
        ignoredStaleReceivables: 0,
        ignoredStalePayables: 0,
        ignoredPurchaseOrderAgendaPayables: 0,
        ignoredOverdueWithoutFiscalDocumentReceivables: 0,
        supersededPreInvoiceReceivables: 0,
        supersededPreInvoiceAmount: 0,
      },
    });
    assert.equal(warnings, 2);
  });

  it("linhas de saneamento listam apenas categorias com contagem > 0", () => {
    const rows = buildFinanceSanitizationAuditRows({
      ignoredInternalGroupReceivables: 0,
      ignoredInternalGroupPayables: 3,
      ignoredGhostReceivables: 0,
      ignoredStaleReceivables: 0,
      ignoredStalePayables: 0,
      ignoredPurchaseOrderAgendaPayables: 0,
      ignoredOverdueWithoutFiscalDocumentReceivables: 0,
      supersededPreInvoiceReceivables: 0,
      supersededPreInvoiceAmount: 0,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 3);
  });

  it("Fluxo de Caixa não exibe banner de saneamento no topo", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.equal(page.includes("FinanceManagementSanitizationNote"), false);
    assert.equal(page.includes("FinanceFilterScopeBanner"), false);
    assert.ok(page.includes("FinanceDataAuditDrawer"));
    assert.ok(page.includes("FinanceDataAuditButton"));
  });

  it("texto técnico de intercompany fica no drawer, não no header", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.equal(page.includes("Movimentos intercompany"), false);
    assert.ok(page.includes("buildFinanceCashFlowAuditSections"));
  });
});
