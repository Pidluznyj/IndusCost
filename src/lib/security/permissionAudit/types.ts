/**
 * Tipos do auditor de permissões (Prompt 03).
 * Análise estática — não altera runtime de auth.
 */

export type PermissionAuditSeverity = "error" | "warn" | "info";

export type PermissionAuditCode =
  | "USED_NOT_IN_CATALOG"
  | "CATALOG_NEVER_USED"
  | "CONTRACT_INVALID_PARENT"
  | "CONTRACT_ISSUE"
  | "ALIAS_MISSING_FROM_CATALOG"
  | "ALIAS_DUPLICATE_ON_CONTRACT"
  | "RELATIONAL_ALIAS_CONFLICT"
  | "SIDEBAR_WITHOUT_CONTRACT"
  | "TAB_WITHOUT_CONTRACT"
  | "PRIVATE_ROUTE_WITHOUT_CONTRACT"
  | "MUTATION_WITHOUT_PERMISSION_GUARD"
  | "MUTATION_AUTH_ONLY"
  | "CONTRACT_ACTION_UNUSED"
  | "FE_BE_GUARD_STYLE_MISMATCH"
  | "SCAN_LIMITATION";

export type PermissionAuditFinding = {
  code: PermissionAuditCode;
  severity: PermissionAuditSeverity;
  message: string;
  /** Chave legada, resourceKey ou rota. */
  subject?: string;
  evidence?: string[];
  /** Se true, gap histórico conhecido (não falha modo estrito). */
  knownGap?: boolean;
};

export type PermissionAuditOccurrence = {
  file: string;
  line: number;
  kind: "frontend" | "backend" | "catalog" | "contract" | "other";
  snippet?: string;
};

export type PermissionAuditMode = "report" | "strict" | "full";

export type PermissionAuditSummary = {
  mode: PermissionAuditMode;
  catalogKeyCount: number;
  contractResourceCount: number;
  relationalSeedCount: number;
  frontendUsageCount: number;
  backendUsageCount: number;
  routeScanCount: number;
  findingCounts: Record<PermissionAuditSeverity, number>;
  knownGapCount: number;
  actionableErrorCount: number;
  ok: boolean;
};

export type PermissionAuditReport = {
  generatedAt: string;
  summary: PermissionAuditSummary;
  findings: PermissionAuditFinding[];
  unusedCatalogKeys: string[];
  phantomKeys: string[];
  limitations: string[];
};
