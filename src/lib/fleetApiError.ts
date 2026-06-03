/**
 * Mensagens de erro amigáveis no frontend — Gestão de Frota.
 */

export function formatFleetApiError(
  error: unknown,
  fallback = "Não foi possível concluir a operação."
): string {
  if (error instanceof Error) {
    const msg = error.message?.trim();
    if (!msg || msg === "undefined" || msg === "null" || msg.includes("NaN")) {
      return fallback;
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return "Falha de conexão. Verifique a rede e tente novamente.";
    }
    if (/^erro http 5\d\d/i.test(msg)) {
      return "Serviço temporariamente indisponível. Tente novamente em instantes.";
    }
    if (/^erro http 403/i.test(msg)) {
      return "Você não tem permissão para esta ação.";
    }
    return msg;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

export function isFleetRetryableMessage(message: string): boolean {
  return /tente novamente|temporariamente indisponível|falha de conexão/i.test(message);
}
