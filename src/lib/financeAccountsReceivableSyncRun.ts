/** Interpretação da resposta POST accounts-receivable-run (reuso Admin + dashboard). */

export type FinanceArSyncRunResult =
  | { ok: true; message: string }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict: false; message: string };

export function interpretFinanceArSyncRunResponse(
  status: number,
  body: { message?: string; error?: string } | null | undefined
): FinanceArSyncRunResult {
  const fallbackError = "Não foi possível iniciar a sincronização de Contas a Receber.";
  if (status === 409) {
    return {
      ok: false,
      conflict: true,
      message:
        body?.message ??
        body?.error ??
        "Já existe uma execução em andamento. Aguarde finalizar.",
    };
  }
  if (status >= 200 && status < 300) {
    return {
      ok: true,
      message:
        body?.message ??
        "Sincronização de Contas a Receber iniciada. Acompanhe o status abaixo.",
    };
  }
  return {
    ok: false,
    conflict: false,
    message: body?.error ?? fallbackError,
  };
}

export function formatFinanceArSyncDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  if (hh > 0) return `${hh}h ${mm}m`;
  return `${mm}m ${ss}s`;
}
