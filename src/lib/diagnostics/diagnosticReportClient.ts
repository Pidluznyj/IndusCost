/**
 * Cliente browser-safe — Gerar Relatório Analisável (ZIP ChatGPT).
 */
import type { DiagnosticScope } from "./chatgptDiagnosticTypes.js";

export type DiagnosticReportScope = DiagnosticScope;

export type DiagnosticReportOptions = {
  includeScreenContext: boolean;
  includeCalculationTrace: boolean;
  includeAutoDiagnostics: boolean;
  includeSanitizedLogs: boolean;
  includeRecentApiCalls: boolean;
};

export const DEFAULT_DIAGNOSTIC_REPORT_OPTIONS: DiagnosticReportOptions = {
  includeScreenContext: true,
  includeCalculationTrace: true,
  includeAutoDiagnostics: true,
  includeSanitizedLogs: true,
  includeRecentApiCalls: true,
};

export type DiagnosticReportRequestBody = {
  scope: DiagnosticReportScope;
  context: Record<string, unknown>;
  options?: Partial<DiagnosticReportOptions>;
};

export type DiagnosticReportResponse = {
  ok: true;
  scope: DiagnosticReportScope;
  bundleId: string;
  generatedAt: string;
  filename: string;
  fileCount: number;
  executiveSummary: string;
  zipBase64: string;
};

export function buildDiagnosticReportRequest(
  scope: DiagnosticReportScope,
  context: Record<string, unknown>,
  options: Partial<DiagnosticReportOptions> = {}
): DiagnosticReportRequestBody {
  return {
    scope,
    context,
    options: { ...DEFAULT_DIAGNOSTIC_REPORT_OPTIONS, ...options },
  };
}

export function downloadZipFromBase64(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function postDiagnosticReport(
  body: DiagnosticReportRequestBody
): Promise<DiagnosticReportResponse> {
  const res = await fetch("/api/diagnostics/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  } & Partial<DiagnosticReportResponse>;
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error ?? "Não foi possível gerar o relatório analisável.");
  }
  return payload as DiagnosticReportResponse;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}
