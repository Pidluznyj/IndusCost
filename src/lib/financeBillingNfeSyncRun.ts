/** Interpretação da resposta POST nfes-run (Faturamento + Admin). */

export type FinanceBillingNfeSyncRunResult =
  | { ok: true; message: string }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict: false; message: string };

export function interpretFinanceBillingNfeSyncRunResponse(
  status: number,
  body: { message?: string; error?: string } | null | undefined
): FinanceBillingNfeSyncRunResult {
  const fallbackError = "Não foi possível iniciar a sincronização de NF-e.";
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
      message: body?.message ?? "Sincronização de NF-e iniciada. Acompanhe o status abaixo.",
    };
  }
  return {
    ok: false,
    conflict: false,
    message: body?.error ?? fallbackError,
  };
}
