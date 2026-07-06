/**
 * Source refs, sanitização e helpers de rastreabilidade para diagnostic bundle.
 */
import type {
  DiagnosticRedactionReport,
  DiagnosticSourceRef,
  DiagnosticSourceType,
  DiagnosticSourcedValue,
} from "./chatgptDiagnosticTypes.js";

const SECRET_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|api[_-]?key|DATABASE_URL|connectionString|private[_-]?key)/i;

const SECRET_VALUE_PATTERNS = [
  /^Bearer\s+.+/i,
  /^postgresql:\/\/.+/i,
  /^mongodb(\+srv)?:\/\/.+/i,
  /^sk-[a-zA-Z0-9]{10,}/,
];

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

export function sanitizeDiagnosticPayload<T>(
  input: T,
  report: DiagnosticRedactionReport = emptyRedactionReport()
): T {
  return sanitizeValue(input, report, []) as T;
}

function emptyRedactionReport(): DiagnosticRedactionReport {
  return {
    redactedFieldCount: 0,
    patternsMatched: [],
    redactedKeys: [],
    notes: [],
  };
}

function sanitizeValue(value: unknown, report: DiagnosticRedactionReport, path: string[]): unknown {
  if (value == null) return value;

  if (typeof value === "string") {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        report.redactedFieldCount += 1;
        if (!report.patternsMatched.includes(pattern.source)) {
          report.patternsMatched.push(pattern.source);
        }
        report.redactedKeys.push(path.join(".") || "(root)");
        return "[REDACTED]";
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, report, [...path, String(index)]));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = [...path, key];
      if (SECRET_KEY_PATTERN.test(key)) {
        report.redactedFieldCount += 1;
        report.redactedKeys.push(nextPath.join("."));
        if (!report.patternsMatched.includes(SECRET_KEY_PATTERN.source)) {
          report.patternsMatched.push(SECRET_KEY_PATTERN.source);
        }
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = sanitizeValue(child, report, nextPath);
    }
    return out;
  }

  return value;
}

export function buildRedactionReportFromPayload(payload: unknown): DiagnosticRedactionReport {
  const report = emptyRedactionReport();
  sanitizeValue(payload, report, []);
  report.notes.push("Segredos, tokens e connection strings são substituídos por [REDACTED].");
  return report;
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
