import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Copy, Download, Loader2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { AppAlert } from "@/src/components/shared/AppAlert";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  DEFAULT_DIAGNOSTIC_REPORT_OPTIONS,
  type DiagnosticReportOptions,
  type DiagnosticReportScope,
  buildDiagnosticReportRequest,
  copyTextToClipboard,
  downloadZipFromBase64,
  postDiagnosticReport,
  type DiagnosticReportResponse,
} from "@/src/lib/diagnostics/diagnosticReportClient";
import { canGenerateDiagnosticReport } from "@/src/lib/diagnostics/diagnosticReportPermissions";

export type DiagnosticReportButtonProps = {
  scope: DiagnosticReportScope;
  context: Record<string, unknown>;
  label?: string;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
};

const OPTION_LABELS: Array<{ key: keyof DiagnosticReportOptions; label: string }> = [
  { key: "includeScreenContext", label: "Incluir contexto da tela" },
  { key: "includeCalculationTrace", label: "Incluir rastreabilidade de cálculo" },
  { key: "includeAutoDiagnostics", label: "Incluir diagnósticos automáticos" },
  { key: "includeSanitizedLogs", label: "Incluir logs sanitizados" },
  { key: "includeRecentApiCalls", label: "Incluir chamadas de API recentes, se disponíveis" },
];

function buttonClass(variant: DiagnosticReportButtonProps["variant"], size: DiagnosticReportButtonProps["size"]): string {
  const sizing = size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  if (variant === "primary") {
    return cn(
      "inline-flex items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50",
      sizing
    );
  }
  if (variant === "ghost") {
    return cn(
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50",
      sizing
    );
  }
  return cn(financeBiButtonOutlineClass, sizing);
}

export function DiagnosticReportButton({
  scope,
  context,
  label = "Gerar Relatório Analisável",
  variant = "outline",
  size = "md",
  className,
  disabled = false,
  "data-testid": testId = "diagnostic-report-button",
}: DiagnosticReportButtonProps) {
  const auth = useAuth();
  const allowed = canGenerateDiagnosticReport(auth, scope);

  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DiagnosticReportOptions>({
    ...DEFAULT_DIAGNOSTIC_REPORT_OPTIONS,
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosticReportResponse | null>(null);

  const mergedContext = useMemo(
    () => ({
      ...context,
      screenRoute: typeof context.screenRoute === "string" ? context.screenRoute : window.location.pathname,
      userId: auth.authUser?.id ?? null,
      userEmail: auth.authUser?.email ?? null,
    }),
    [context, auth.authUser?.email, auth.authUser?.id]
  );

  const resetModalState = useCallback(() => {
    setError(null);
    setNotice(null);
    setResult(null);
    setOptions({ ...DEFAULT_DIAGNOSTIC_REPORT_OPTIONS });
  }, []);

  const handleOpen = () => {
    if (disabled || generating) return;
    resetModalState();
    setOpen(true);
  };

  const handleClose = () => {
    if (generating) return;
    setOpen(false);
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const body = buildDiagnosticReportRequest(scope, mergedContext, options);
      const response = await postDiagnosticReport(body);
      setResult(response);
      downloadZipFromBase64(response.zipBase64, response.filename);
      setNotice("ZIP gerado e download iniciado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar relatório analisável.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadAgain = () => {
    if (!result) return;
    downloadZipFromBase64(result.zipBase64, result.filename);
    setNotice("Download do ZIP reiniciado.");
  };

  const handleCopySummary = async () => {
    if (!result?.executiveSummary) {
      setError("Gere o ZIP antes de copiar o resumo.");
      return;
    }
    try {
      await copyTextToClipboard(result.executiveSummary);
      setNotice("Resumo executivo copiado — cole no ChatGPT.");
    } catch {
      setError("Não foi possível copiar o resumo para a área de transferência.");
    }
  };

  if (!allowed) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || generating}
        data-testid={testId}
        className={cn(buttonClass(variant, size), className)}
        title="Gera ZIP read-only otimizado para análise no ChatGPT"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Bot className="h-4 w-4 shrink-0" aria-hidden />
        )}
        {label}
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
                  role="presentation"
                  onClick={handleClose}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="diagnostic-report-modal-title"
                    className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                    data-testid="diagnostic-report-modal"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-border bg-accent/30 p-5">
                      <div>
                        <h3 id="diagnostic-report-modal-title" className="text-lg font-bold">
                          Gerar Relatório Analisável
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">Escopo: {scope}</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClose}
                        disabled={generating}
                        className="rounded-full p-2 transition-colors hover:bg-accent"
                        aria-label="Fechar"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="flex-1 space-y-4 overflow-y-auto p-5">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Este relatório será gerado em formato ZIP otimizado para análise no ChatGPT. Ele
                        inclui dados técnicos, contexto da tela, rastreabilidade de cálculos, diagnósticos
                        e logs sanitizados. Segredos e credenciais serão removidos.
                      </p>

                      <div className="space-y-2 rounded-xl border border-border bg-accent/20 p-3">
                        {OPTION_LABELS.map(({ key, label: optionLabel }) => (
                          <label
                            key={key}
                            className="flex cursor-pointer items-start gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-border text-primary focus:ring-primary/30"
                              checked={options[key]}
                              disabled={generating}
                              onChange={(e) =>
                                setOptions((prev) => ({ ...prev, [key]: e.target.checked }))
                              }
                            />
                            <span>{optionLabel}</span>
                          </label>
                        ))}
                      </div>

                      <AppAlert variant="warning" density="compact" title="Privacidade">
                        Nunca envie relatórios se você não confiar no destinatário. O sistema remove
                        segredos automaticamente, mas revise informações comerciais antes de compartilhar
                        externamente.
                      </AppAlert>

                      {error ? (
                        <AppAlert variant="destructive" density="compact" role="alert">
                          {error}
                        </AppAlert>
                      ) : null}
                      {notice ? (
                        <AppAlert variant="success" density="compact" role="status">
                          {notice}
                        </AppAlert>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-accent/10 p-4">
                      <button
                        type="button"
                        onClick={handleClose}
                        disabled={generating}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopySummary()}
                        disabled={generating || !result}
                        className={financeBiButtonOutlineClass}
                        data-testid="diagnostic-report-copy-summary"
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copiar resumo para ChatGPT
                      </button>
                      {result ? (
                        <button
                          type="button"
                          onClick={handleDownloadAgain}
                          disabled={generating}
                          className={financeBiButtonOutlineClass}
                          data-testid="diagnostic-report-download-again"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Baixar ZIP
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleGenerate()}
                        disabled={generating}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        data-testid="diagnostic-report-generate"
                      >
                        {generating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        Gerar ZIP
                      </button>
                    </div>
                  </motion.div>
                </div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </>
  );
}
