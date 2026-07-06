/**
 * Source refs e helpers de rastreabilidade para diagnostic bundle.
 * Sanitização centralizada em sanitizeDiagnosticPayload.server.ts.
 */
import type {
  DiagnosticSourceRef,
  DiagnosticSourceType,
  DiagnosticSourcedValue,
} from "./chatgptDiagnosticTypes.js";

export {
  createRedactionReport,
  sanitizeDiagnosticError,
  sanitizeDiagnosticHeaders,
  sanitizeDiagnosticPayload,
  sanitizeDiagnosticText,
} from "./sanitizeDiagnosticPayload.server.js";

export function createDiagnosticSourceRef(input: {
  type: DiagnosticSourceType;
  name: string;
  path: string;
  table?: string | null;
  recordId?: string | null;
  field?: string | null;
  versionId?: string | null;
}): DiagnosticSourceRef {
  return {
    type: input.type,
    name: input.name,
    path: input.path,
    table: input.table ?? null,
    recordId: input.recordId ?? null,
    field: input.field ?? null,
    versionId: input.versionId ?? null,
  };
}

export function createSourcedValue<T>(
  value: T,
  source: Omit<DiagnosticSourceRef, "path"> & { path: string }
): DiagnosticSourcedValue<T> {
  return {
    value,
    source: createDiagnosticSourceRef(source),
  };
}

export function truncateJsonPayload(
  payload: unknown,
  maxBytes: number
): { payload: unknown; truncated: boolean; originalSizeBytes: number } {
  const json = JSON.stringify(payload);
  const originalSizeBytes = Buffer.byteLength(json, "utf8");
  if (originalSizeBytes <= maxBytes) {
    return { payload, truncated: false, originalSizeBytes };
  }
  return {
    payload: {
      truncated: true,
      originalSizeBytes,
      preview: json.slice(0, Math.max(0, maxBytes - 200)),
      note: "Payload truncado para respeitar limite do pacote diagnóstico.",
    },
    truncated: true,
    originalSizeBytes,
  };
}

export function auditTraceEvidenceRef(scope: string, field: string): string {
  return `evidence.${scope}.${field}`;
}

export const DEFAULT_CODE_REFERENCES = [
  {
    path: "src/lib/audit/costToCashTrace.server.ts",
    reason: "Orquestrador read-only Cost-to-Cash",
    symbols: ["buildCostToCashTrace", "buildProductCostTrace"],
  },
  {
    path: "src/lib/diagnostics/diagnosticBundleBuilder.server.ts",
    reason: "Montagem do pacote diagnóstico analisável",
    symbols: ["buildChatGptDiagnosticBundle"],
  },
  {
    path: "scripts/audit-product-cost-trace.ts",
    reason: "CLI rastreabilidade de custo",
  },
  {
    path: "scripts/audit-published-price-trace.ts",
    reason: "CLI rastreabilidade de preço publicado",
  },
  {
    path: "scripts/audit-sales-order-trace.ts",
    reason: "CLI rastreabilidade de venda/margem",
  },
  {
    path: "scripts/audit-commission-trace.ts",
    reason: "CLI rastreabilidade de comissão",
  },
] as const;
