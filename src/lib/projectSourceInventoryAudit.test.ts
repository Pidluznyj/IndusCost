import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findFrontendPrismaImports } from "./hardcodedBusinessDataAudit.js";
import { SYSTEM_DATA_LINEAGE } from "./systemDataLineageAudit.js";
import { PRINT_PDF_AUDIT_ENTRIES } from "./printPdfAudit.js";
import {
  assertModuleSummariesFinite,
  assertProjectSourceAuditIntegrity,
  formatProjectSourceAuditReport,
  getModuleAuditSummary,
  PROJECT_AUDIT_CROSS_REFERENCES,
  PROJECT_BACKEND_ENDPOINTS_AUDIT,
  PROJECT_CRITICAL_FILES,
  PROJECT_FRONTEND_ROUTES_AUDIT,
  PROJECT_MODULE_AUDIT_SUMMARY,
  PROJECT_REFACTOR_CANDIDATES,
  PROJECT_SOURCE_INVENTORY_AUDIT,
  PROJECT_SOURCE_DEPENDENCY_AUDIT,
  summarizeProjectSourceAudit,
} from "./projectSourceInventoryAudit.js";

describe("projectSourceInventoryAudit", () => {
  it("auditoria existe e não está vazia", () => {
    assert.ok(PROJECT_SOURCE_INVENTORY_AUDIT.length > 100);
    assert.ok(PROJECT_MODULE_AUDIT_SUMMARY.length >= 5);
    assert.ok(PROJECT_SOURCE_DEPENDENCY_AUDIT.length === PROJECT_SOURCE_INVENTORY_AUDIT.length);
  });

  it("todo arquivo crítico tem módulo", () => {
    for (const entry of PROJECT_SOURCE_INVENTORY_AUDIT) {
      assert.ok(entry.module, `${entry.file} sem módulo`);
    }
  });

  it("todo item tem lifecycleStatus e recommendation", () => {
    for (const entry of PROJECT_SOURCE_INVENTORY_AUDIT) {
      assert.ok(entry.lifecycleStatus);
      assert.ok(entry.recommendation);
    }
  });

  it("nenhum item crítico unknown sem nota", () => {
    const critical = PROJECT_SOURCE_INVENTORY_AUDIT.filter(
      (e) =>
        PROJECT_CRITICAL_FILES.includes(e.file as (typeof PROJECT_CRITICAL_FILES)[number]) ||
        e.risk === "risk"
    );
    for (const e of critical) {
      if (e.lifecycleStatus === "unknown") {
        assert.ok(e.reason || e.suggestedAction, `${e.file} unknown sem nota`);
      }
    }
  });

  it("Financeiro possui resumo", () => {
    const m = getModuleAuditSummary("Financeiro");
    assert.ok(m);
    assert.ok(m!.filesCount > 50);
    assert.ok(m!.activeCount > 0);
  });

  it("Pedidos de Venda possui resumo", () => {
    const m = getModuleAuditSummary("Pedidos de Venda");
    assert.ok(m);
    assert.ok(m!.filesCount > 10);
  });

  it("CRM possui resumo", () => {
    const m = getModuleAuditSummary("CRM / Clientes");
    assert.ok(m);
    assert.ok(m!.filesCount > 20);
  });

  it("Nomus Sync possui resumo", () => {
    const m = getModuleAuditSummary("Nomus Sync");
    assert.ok(m);
    assert.ok(m!.filesCount > 30);
  });

  it("Projetos possui resumo", () => {
    const m = getModuleAuditSummary("Projetos");
    assert.ok(m);
    assert.ok(m!.filesCount > 30);
  });

  it("Relatório Presidencial está mapeado", () => {
    const entry = PROJECT_SOURCE_INVENTORY_AUDIT.find(
      (e) => e.file === "src/lib/financeExecutiveReport.ts"
    );
    assert.ok(entry);
    assert.equal(entry!.module, "Financeiro");
    assert.ok(entry!.routes?.includes("/finance/executive-report") || entry!.reason.includes("Presidencial"));
    const lineage = SYSTEM_DATA_LINEAGE.find((l) => l.id === "finance-executive-report");
    assert.ok(lineage);
  });

  it("Gestão de Pedidos de Venda está mapeada", () => {
    const entry = PROJECT_SOURCE_INVENTORY_AUDIT.find(
      (e) => e.file === "src/components/sales/SalesOrderManagementPage.tsx"
    );
    assert.ok(entry);
    assert.equal(entry!.module, "Pedidos de Venda");
    assert.ok(entry!.routes?.includes("/sales-orders/management"));
  });

  it("auditoria de PDFs/prints é referenciada", () => {
    assert.ok(PROJECT_AUDIT_CROSS_REFERENCES.printPdf.entryCount > 0);
    assert.ok(PRINT_PDF_AUDIT_ENTRIES.length > 0);
    assert.equal(PROJECT_AUDIT_CROSS_REFERENCES.printPdf.module, "src/lib/printPdfAudit.ts");
  });

  it("auditoria de hardcode/data lineage é referenciada", () => {
    assert.ok(PROJECT_AUDIT_CROSS_REFERENCES.dataLineage.entryCount > 0);
    assert.ok(SYSTEM_DATA_LINEAGE.length > 10);
    assert.ok(PROJECT_AUDIT_CROSS_REFERENCES.hardcodedBusinessData.module.includes("hardcoded"));
  });

  it("frontend não importa Prisma na varredura de hardcode", () => {
    const findings = findFrontendPrismaImports();
    assert.equal(findings.length, 0, `Prisma no frontend: ${findings.join(", ")}`);
  });

  it("endpoints críticos aparecem mapeados", () => {
    const paths = PROJECT_BACKEND_ENDPOINTS_AUDIT.map((e) => e.path);
    assert.ok(paths.some((p) => p.includes("/api/finance/accounts-receivable")));
    assert.ok(paths.some((p) => p.includes("/api/sales-orders/management")));
    assert.ok(paths.some((p) => p.includes("/api/finance/executive-report")));
  });

  it("rotas críticas aparecem mapeadas", () => {
    const routes = PROJECT_FRONTEND_ROUTES_AUDIT.map((r) => r.route);
    assert.ok(routes.some((r) => r.includes("sales-orders")));
    assert.ok(routes.some((r) => r.includes("finance") || routes.some((x) => x.startsWith("/finance"))));
    assert.ok(routes.some((r) => r.includes("customers") || r.includes("crm")));
  });

  it("arquivos test-only não são candidatos a remoção só por não serem importados", () => {
    const tests = PROJECT_SOURCE_INVENTORY_AUDIT.filter((e) => e.lifecycleStatus === "test_only");
    assert.ok(tests.length > 50);
    for (const t of tests) {
      assert.notEqual(t.recommendation, "candidate_for_removal");
      assert.notEqual(t.lifecycleStatus, "removal_candidate");
    }
  });

  it("arquivos legacy/deprecated não são marcados para remoção automática", () => {
    const leg = PROJECT_SOURCE_INVENTORY_AUDIT.filter(
      (e) => e.lifecycleStatus === "legacy" || e.lifecycleStatus === "deprecated"
    );
    for (const e of leg) {
      assert.notEqual(e.recommendation, "candidate_for_removal");
      assert.equal(
        (PROJECT_REFACTOR_CANDIDATES.removalCandidates.find((c) => c.file === e.file)?.safeToRemoveNow ??
          false) as boolean,
        false
      );
    }
  });

  it("removal_candidate usa review_before_removal", () => {
    const rem = PROJECT_SOURCE_INVENTORY_AUDIT.filter(
      (e) => e.lifecycleStatus === "removal_candidate"
    );
    assert.ok(rem.length > 0);
    for (const e of rem.slice(0, 20)) {
      assert.equal(e.recommendation, "review_before_removal");
    }
  });

  it("não há NaN/Infinity nos resumos", () => {
    assert.ok(assertModuleSummariesFinite(PROJECT_MODULE_AUDIT_SUMMARY));
    const s = summarizeProjectSourceAudit();
    for (const v of Object.values(s.byStatus)) assert.ok(Number.isFinite(v));
    for (const v of Object.values(s.byRecommendation)) assert.ok(Number.isFinite(v));
  });

  it("script report imprime contagens por status", () => {
    const report = formatProjectSourceAuditReport();
    assert.match(report, /Arquivos auditados:/);
    assert.match(report, /Por status:/);
    assert.match(report, /active/);
    assert.match(report, /Top candidatos para revisão/);
  });

  it("candidatos de refatoração têm safeToRemoveNow false", () => {
    const all = [
      ...PROJECT_REFACTOR_CANDIDATES.replaceCandidates,
      ...PROJECT_REFACTOR_CANDIDATES.duplicateCandidates,
      ...PROJECT_REFACTOR_CANDIDATES.removalCandidates,
      ...PROJECT_REFACTOR_CANDIDATES.needsOwnerDecision,
    ];
    assert.ok(all.length > 0);
    for (const c of all) {
      assert.equal(c.safeToRemoveNow, false);
    }
  });

  it("integridade da auditoria passa", () => {
    const result = assertProjectSourceAuditIntegrity();
    assert.ok(result.ok, result.errors.join("\n"));
  });

  it("auditoria não altera regra de negócio — somente leitura", () => {
    const before = PROJECT_SOURCE_INVENTORY_AUDIT.length;
    const report = formatProjectSourceAuditReport();
    assert.ok(report.length > 100);
    assert.equal(PROJECT_SOURCE_INVENTORY_AUDIT.length, before);
  });
});
