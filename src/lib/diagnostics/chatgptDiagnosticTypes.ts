/**
 * ChatGPT Analyzable Diagnostic Bundle — tipos e contrato do pacote ZIP.
 * Read-only; não altera dados produtivos.
 */

export const CHATGPT_DIAGNOSTIC_BUNDLE_VERSION = "1.0.0";

export const DIAGNOSTIC_BUNDLE_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const DIAGNOSTIC_BUNDLE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const DIAGNOSTIC_BUNDLE_MAX_FINDINGS = 500;
export const DIAGNOSTIC_BUNDLE_MAX_LOG_LINES = 2_000;

export type DiagnosticScope =
  | "PRODUCT_ENGINEERING"
  | "PUBLISHED_PRICE"
  | "SALES_ORDER"
  | "COMMISSION_RECEIPT_CLOSING"
  | "COST_TO_CASH"
  | "SYSTEM";

export type DiagnosticFindingSeverity = "info" | "warning" | "error" | "critical";

export type DiagnosticSourceType =
  | "database"
  | "api"
  | "frontend"
  | "service"
  | "log"
  | "code";

export type DiagnosticSourceRef = {
  type: DiagnosticSourceType;
  name: string;
  path: string;
  table?: string | null;
  recordId?: string | null;
  field?: string | null;
  versionId?: string | null;
};

export type DiagnosticSourcedValue<T = unknown> = {
  value: T;
  source: DiagnosticSourceRef;
};

export type DiagnosticFinding = {
  id: string;
  severity: DiagnosticFindingSeverity;
  code: string;
  title: string;
  message: string;
  businessImpact: string;
  technicalImpact: string;
  evidenceRefs: string[];
  sourceRefs: DiagnosticSourceRef[];
  suggestedNextSteps: string[];
};

export type DiagnosticEvidence = {
  id: string;
  scope: DiagnosticScope;
  label: string;
  bundlePath: string;
  payload: unknown;
};

export type DiagnosticReproductionCommand = {
  label: string;
  command: string;
  note?: string | null;
};

export type DiagnosticCodeReference = {
  path: string;
  reason: string;
  symbols?: string[];
};

export type DiagnosticRedactionReport = {
  redactedFieldsCount: number;
  redactedPatterns: string[];
  filesSanitized: string[];
  warnings: string[];
  /** Detalhe interno opcional para auditoria */
  redactedKeys?: string[];
};

export type DiagnosticScopeContext = {
  scope: DiagnosticScope;
  screenRoute?: string | null;
  screenTitle?: string | null;
  filters?: Record<string, unknown> | null;
  userId?: string | null;
  userEmail?: string | null;
  permissions?: string[] | null;
  apiCalls?: Array<{
    method: string;
    path: string;
    status?: number | null;
    durationMs?: number | null;
  }> | null;
  errorMessage?: string | null;
  notes?: string | null;
};

export type DiagnosticManifestFile = {
  path: string;
  sizeBytes: number;
  mediaType: string;
  sha256: string;
};

export type DiagnosticManifest = {
  bundleVersion: typeof CHATGPT_DIAGNOSTIC_BUNDLE_VERSION;
  bundleId: string;
  generatedAt: string;
  scope: DiagnosticScope;
  functionalName: "Gerar Relatório Analisável";
  technicalName: "ChatGPT Analyzable Diagnostic Bundle";
  readOnly: true;
  files: DiagnosticManifestFile[];
};

export type DiagnosticBundle = {
  manifest: DiagnosticManifest;
  /** Relative paths inside the ZIP root */
  entries: Record<string, string>;
};

/** Paths obrigatórios na raiz do ZIP (exceto subpastas dinâmicas). */
export const REQUIRED_BUNDLE_ROOT_FILES = [
  "00_README_FOR_CHATGPT.md",
  "CHATGPT_ANALYSIS_PROMPT.md",
  "01_EXECUTIVE_SUMMARY.md",
  "02_PROBLEM_CONTEXT.md",
  "03_DIAGNOSTIC_INDEX.json",
  "04_DIAGNOSTICS.json",
  "05_REPRODUCTION_STEPS.md",
  "06_SYSTEM_SNAPSHOT.json",
  "07_SCREEN_CONTEXT.json",
  "08_API_TRACE.json",
  "09_DATABASE_EVIDENCE.json",
  "10_CALCULATION_TRACE.json",
  "11_BUSINESS_RULES_APPLIED.md",
  "12_LOGS_SANITIZED.log",
  "13_CODE_REFERENCES.json",
  "14_WARNINGS_AND_ERRORS.json",
  "15_REDACTION_REPORT.json",
  "manifest.json",
] as const;

export const REQUIRED_BUNDLE_DIRECTORIES = ["evidence", "exports", "evidence/raw-limited"] as const;

export const DEFAULT_EVIDENCE_PATHS = [
  "evidence/product-cost-trace.json",
  "evidence/published-price-trace.json",
  "evidence/sales-order-trace.json",
  "evidence/commission-trace.json",
] as const;

export const DEFAULT_EXPORT_PATHS = ["exports/summary.csv", "exports/diagnostics.csv"] as const;

export function isDiagnosticFindingSeverity(value: string): value is DiagnosticFindingSeverity {
  return value === "info" || value === "warning" || value === "error" || value === "critical";
}

export function assertValidFinding(finding: DiagnosticFinding): void {
  if (!finding.id?.trim()) throw new Error("Finding id obrigatório.");
  if (!isDiagnosticFindingSeverity(finding.severity)) {
    throw new Error(`Finding severity inválida: ${finding.severity}`);
  }
  if (!finding.code?.trim()) throw new Error("Finding code obrigatório.");
  if (!finding.message?.trim()) throw new Error("Finding message obrigatório.");
  if (!Array.isArray(finding.sourceRefs)) throw new Error("Finding sourceRefs obrigatório.");
}
