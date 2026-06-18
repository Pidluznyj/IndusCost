/**
 * Auditoria arquitetural de inventário de fontes do IndusCost.
 * Read-only — não altera regra de negócio nem remove arquivos.
 *
 * Integra:
 * - systemDataLineageAudit (rastreabilidade de dados)
 * - hardcodedBusinessDataAudit (hardcode de negócio)
 * - printPdfAudit (prints/PDFs)
 */
import { SYSTEM_DATA_LINEAGE } from "./systemDataLineageAudit.js";
import { PRINT_PDF_AUDIT_ENTRIES } from "./printPdfAudit.js";
import {
  assertModuleSummariesFinite,
  buildProjectSourceInventory,
  buildRefactorCandidates,
  getTopReviewCandidates,
  summarizeInventoryRecommendations,
  summarizeInventoryStatus,
  type BackendEndpointAudit,
  type FrontendRouteAudit,
  type ProjectModuleAuditSummary,
  type ProjectSourceInventoryEntry,
  type RefactorCandidateItem,
  type SourceDependencyAuditEntry,
} from "./projectSourceInventoryScanner.js";

export type {
  SourceFileKind,
  SourceLifecycleStatus,
  ProjectSourceAuditRisk,
  ProjectSourceAuditRecommendation,
  ProjectSourceInventoryEntry,
  SourceDependencyAuditEntry,
  FrontendRouteAudit,
  BackendEndpointAudit,
  ProjectModuleAuditSummary,
  RefactorCandidateItem,
} from "./projectSourceInventoryScanner.js";

export {
  CURATED_SOURCE_OVERRIDES,
  listAuditedSourceFiles,
  buildProjectSourceInventory,
  buildModuleSummaries,
  buildRefactorCandidates,
  getTopReviewCandidates,
  summarizeInventoryStatus,
  summarizeInventoryRecommendations,
  assertModuleSummariesFinite,
} from "./projectSourceInventoryScanner.js";

const _scan = buildProjectSourceInventory();

/** Matriz principal de inventário — gerada por varredura estática + overrides curados. */
export const PROJECT_SOURCE_INVENTORY_AUDIT: ProjectSourceInventoryEntry[] = _scan.inventory;

/** Grafo de dependências por arquivo. */
export const PROJECT_SOURCE_DEPENDENCY_AUDIT: SourceDependencyAuditEntry[] = _scan.dependencies;

/** Resumo por módulo do sistema. */
export const PROJECT_MODULE_AUDIT_SUMMARY: ProjectModuleAuditSummary[] = _scan.moduleSummaries;

/** Rotas frontend detectadas em App.tsx. */
export const PROJECT_FRONTEND_ROUTES_AUDIT: FrontendRouteAudit[] = _scan.frontendRoutes;

/** Endpoints em arquivos *Routes.ts modulares. */
export const PROJECT_BACKEND_ENDPOINTS_AUDIT: BackendEndpointAudit[] = _scan.backendEndpoints;

/** Total de arquivos na varredura. */
export const PROJECT_SOURCE_AUDIT_FILE_COUNT = _scan.files.length;

/** Referências às auditorias existentes (não duplicar matrizes). */
export const PROJECT_AUDIT_CROSS_REFERENCES = {
  dataLineage: {
    module: "src/lib/systemDataLineageAudit.ts",
    entryCount: SYSTEM_DATA_LINEAGE.length,
    script: "npm run audit:data-lineage",
  },
  hardcodedBusinessData: {
    module: "src/lib/hardcodedBusinessDataAudit.ts",
    script: "npm run test:data-lineage-audit",
  },
  printPdf: {
    module: "src/lib/printPdfAudit.ts",
    entryCount: PRINT_PDF_AUDIT_ENTRIES.length,
    script: "npm run audit:print-pdf",
  },
} as const;

/** Candidatos de refatoração/limpeza futura — safeToRemoveNow sempre false. */
export const PROJECT_REFACTOR_CANDIDATES = buildRefactorCandidates(PROJECT_SOURCE_INVENTORY_AUDIT);

/** Arquivos críticos que não devem ser alterados sem cuidado extremo. */
export const PROJECT_CRITICAL_FILES = [
  "server.ts",
  "src/lib/prisma.ts",
  "src/lib/financeAccountsReceivableDashboard.ts",
  "src/lib/financeAccountsPayableDashboard.ts",
  "src/lib/financeCashFlowDashboard.ts",
  "src/lib/financeBillingDashboard.ts",
  "src/lib/financeExecutiveReport.ts",
  "src/lib/salesOrderLifecycleStatus.ts",
  "src/lib/salesOrderIntelligence.ts",
  "src/lib/nomusDailySyncRunner.ts",
  "scripts/nomusSyncOrchestrator.ts",
] as const;

export function summarizeProjectSourceAudit(): {
  fileCount: number;
  moduleCount: number;
  byStatus: Record<string, number>;
  byRecommendation: Record<string, number>;
  topReviewCandidates: ProjectSourceInventoryEntry[];
  criticalCount: number;
  crossReferences: typeof PROJECT_AUDIT_CROSS_REFERENCES;
} {
  return {
    fileCount: PROJECT_SOURCE_AUDIT_FILE_COUNT,
    moduleCount: PROJECT_MODULE_AUDIT_SUMMARY.length,
    byStatus: summarizeInventoryStatus(PROJECT_SOURCE_INVENTORY_AUDIT),
    byRecommendation: summarizeInventoryRecommendations(PROJECT_SOURCE_INVENTORY_AUDIT),
    topReviewCandidates: getTopReviewCandidates(PROJECT_SOURCE_INVENTORY_AUDIT, 15),
    criticalCount: PROJECT_CRITICAL_FILES.length,
    crossReferences: PROJECT_AUDIT_CROSS_REFERENCES,
  };
}

export function getModuleAuditSummary(moduleName: string): ProjectModuleAuditSummary | undefined {
  return PROJECT_MODULE_AUDIT_SUMMARY.find((m) => m.module === moduleName);
}

export function assertProjectSourceAuditIntegrity(): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (PROJECT_SOURCE_INVENTORY_AUDIT.length === 0) {
    errors.push("PROJECT_SOURCE_INVENTORY_AUDIT está vazio.");
  }
  for (const entry of PROJECT_SOURCE_INVENTORY_AUDIT) {
    if (!entry.module) errors.push(`${entry.file}: sem módulo`);
    if (!entry.lifecycleStatus) errors.push(`${entry.file}: sem lifecycleStatus`);
    if (!entry.recommendation) errors.push(`${entry.file}: sem recommendation`);
    if (
      entry.lifecycleStatus === "unknown" &&
      !entry.reason &&
      !entry.suggestedAction
    ) {
      errors.push(`${entry.file}: unknown sem nota`);
    }
    if (entry.recommendation === "candidate_for_removal" && entry.risk === "ok") {
      errors.push(`${entry.file}: candidate_for_removal sem risco classificado`);
    }
    if (
      entry.lifecycleStatus === "removal_candidate" &&
      entry.recommendation !== "review_before_removal"
    ) {
      errors.push(`${entry.file}: removal_candidate deve usar review_before_removal`);
    }
  }
  if (!assertModuleSummariesFinite(PROJECT_MODULE_AUDIT_SUMMARY)) {
    errors.push("Resumos de módulo contêm NaN/Infinity.");
  }
  const finance = getModuleAuditSummary("Financeiro");
  if (!finance || finance.filesCount === 0) errors.push("Financeiro sem resumo.");
  const sales = getModuleAuditSummary("Pedidos de Venda");
  if (!sales || sales.filesCount === 0) errors.push("Pedidos de Venda sem resumo.");
  const crm = getModuleAuditSummary("CRM / Clientes");
  if (!crm || crm.filesCount === 0) errors.push("CRM sem resumo.");
  const nomus = getModuleAuditSummary("Nomus Sync");
  if (!nomus || nomus.filesCount === 0) errors.push("Nomus Sync sem resumo.");
  const projects = getModuleAuditSummary("Projetos");
  if (!projects || projects.filesCount === 0) errors.push("Projetos sem resumo.");

  const mgmt = PROJECT_SOURCE_INVENTORY_AUDIT.find(
    (e) => e.file === "src/components/sales/SalesOrderManagementPage.tsx"
  );
  if (!mgmt) errors.push("Gestão de Pedidos não mapeada.");

  const execReport = PROJECT_SOURCE_INVENTORY_AUDIT.find(
    (e) => e.file === "src/lib/financeExecutiveReport.ts"
  );
  if (!execReport) errors.push("Relatório Presidencial não mapeado.");

  const fePrisma = PROJECT_SOURCE_DEPENDENCY_AUDIT.filter(
    (d) => d.hasFrontendBackendBoundaryRisk
  );
  if (fePrisma.length > 0) {
    // warning only — documented in audit
  }

  return { ok: errors.length === 0, errors };
}

export function formatProjectSourceAuditReport(): string {
  const s = summarizeProjectSourceAudit();
  const lines: string[] = [
    "=== IndusCost — Project Source Inventory Audit ===",
    "",
    `Arquivos auditados: ${s.fileCount}`,
    `Módulos: ${s.moduleCount}`,
    "",
    "Por status:",
  ];
  for (const [status, count] of Object.entries(s.byStatus).sort()) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push("", "Por recomendação:");
  for (const [rec, count] of Object.entries(s.byRecommendation).sort()) {
    lines.push(`- ${rec}: ${count}`);
  }
  lines.push("", "Top candidatos para revisão:");
  s.topReviewCandidates.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.file} [${e.lifecycleStatus}] — ${e.reason}`);
  });
  lines.push("", "Riscos / auditorias cruzadas:");
  lines.push(`- Data lineage: ${s.crossReferences.dataLineage.entryCount} entradas`);
  lines.push(`- Print/PDF audit: ${s.crossReferences.printPdf.entryCount} entradas`);
  lines.push(`- Arquivos críticos protegidos: ${s.criticalCount}`);
  lines.push("", "=== Fim da auditoria ===");
  return lines.join("\n");
}
