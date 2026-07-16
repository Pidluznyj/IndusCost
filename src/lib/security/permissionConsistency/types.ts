/**
 * Validador de consistência de permissões (P02).
 * Detecta divergências entre contrato, seed, FE, sidebar, rotas e catálogo legado.
 * Não altera runtime de auth.
 */

export type PermissionConsistencySeverity = "error" | "warn" | "info";

export type PermissionConsistencyCode =
  | "CONTRACT_ISSUE"
  | "CONTRACT_INVALID_PARENT"
  | "CONTRACT_CYCLE"
  | "CONTRACT_INVALID_ACTION"
  | "RESOURCE_USED_NOT_REGISTERED"
  | "RESOURCE_REGISTERED_NEVER_USED"
  | "FE_RESOURCE_MISSING_FROM_SEED"
  | "FE_RESOURCE_MISSING_FROM_CONTRACT"
  | "SEED_RESOURCE_MISSING_FROM_CONTRACT"
  | "CONTRACT_RELATIONAL_MISSING_FROM_SEED"
  | "SIDEBAR_RESOURCE_MISSING_FROM_SEED"
  | "SIDEBAR_RESOURCE_MISSING_FROM_CONTRACT"
  | "SIDEBAR_MODULE_WITHOUT_RESOURCE"
  | "TAB_WITHOUT_RESOURCE"
  | "PRIVATE_ROUTE_WITHOUT_RESOURCE"
  | "ALIAS_DUPLICATE"
  | "ALIAS_WIDE"
  | "MEGA_KEY_AS_FINAL_ALIAS"
  | "FE_BE_KEY_MISMATCH"
  | "PERMISSIVE_FALLBACK"
  | "MUTATION_WITHOUT_PERMISSION_GUARD"
  | "AUDIT_ACTIONABLE_ERROR"
  | "BASELINE_STALE";

export type PermissionConsistencyMode = "report" | "strict";

export type PermissionConsistencyFinding = {
  code: PermissionConsistencyCode;
  severity: PermissionConsistencySeverity;
  message: string;
  /** Chave estável para baseline (code+subject). */
  subject: string;
  evidence?: string[];
  /** Presente no baseline histórico — não falha strict. */
  baselined?: boolean;
  /** Entrada de baseline sem finding atual. */
  staleBaseline?: boolean;
};

export type PermissionConsistencySourceCounts = {
  contractResources: number;
  seedResources: number;
  frontendResources: number;
  catalogLegacyKeys: number;
  sidebarModulesMapped: number;
  tabResources: number;
};

export type PermissionConsistencySummary = {
  mode: PermissionConsistencyMode;
  sources: PermissionConsistencySourceCounts;
  findingCounts: Record<PermissionConsistencySeverity, number>;
  baselinedCount: number;
  newFindingCount: number;
  staleBaselineCount: number;
  /** strict: newFindingCount === 0; report: sempre true */
  ok: boolean;
};

export type PermissionConsistencyReport = {
  generatedAt: string;
  summary: PermissionConsistencySummary;
  findings: PermissionConsistencyFinding[];
  newFindings: PermissionConsistencyFinding[];
  baselinedFindings: PermissionConsistencyFinding[];
  staleBaselineEntries: PermissionConsistencyFinding[];
  limitations: string[];
};

export type PermissionConsistencyBaselineEntry = {
  code: PermissionConsistencyCode;
  subject: string;
  reason: string;
};
