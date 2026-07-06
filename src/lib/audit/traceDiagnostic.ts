/**
 * Diagnóstico unificado para rastreabilidade Cost-to-Cash.
 */
export type TraceDiagnosticSeverity = "info" | "warning" | "error";

export type TraceDiagnostic = {
  code: string;
  severity: TraceDiagnosticSeverity;
  status: string;
  message: string;
  source: string;
  context?: string | null;
};

export function createTraceDiagnostic(input: {
  code: string;
  severity: TraceDiagnosticSeverity;
  status?: string;
  message: string;
  source: string;
  context?: string | null;
}): TraceDiagnostic {
  return {
    code: input.code,
    severity: input.severity,
    status: input.status ?? input.code,
    message: input.message,
    source: input.source,
    context: input.context ?? null,
  };
}

export function mapAlertToDiagnostic(
  alert: {
    code: string;
    severity: string;
    message: string;
    context?: string | null;
  },
  source: string,
  status?: string
): TraceDiagnostic {
  const severity: TraceDiagnosticSeverity =
    alert.severity === "error"
      ? "error"
      : alert.severity === "info"
        ? "info"
        : "warning";
  return createTraceDiagnostic({
    code: alert.code,
    severity,
    status: status ?? alert.code,
    message: alert.message,
    source,
    context: alert.context ?? null,
  });
}

export function mergeTraceDiagnostics(
  ...groups: Array<TraceDiagnostic[] | undefined | null>
): TraceDiagnostic[] {
  const seen = new Set<string>();
  const out: TraceDiagnostic[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const item of group) {
      const key = `${item.source}|${item.code}|${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
