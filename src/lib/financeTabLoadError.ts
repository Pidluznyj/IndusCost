/** Mensagem amigável para falhas de carregamento nas abas Financeiro. */
export function buildFinanceTabLoadError(baseMessage: string, error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail ? `${baseMessage} ${detail}` : baseMessage;
}

/** Corpo JSON padrão para erros 500 das rotas financeiras. */
export function financeApiErrorJson(
  userMessage: string,
  error: unknown
): { error: string; message: string } {
  const message =
    error instanceof Error ? error.message : "Falha interna ao processar a solicitação.";
  return { error: userMessage, message };
}
