/**
 * Mensagens de consulta paga QUOD/IEPTB para API e UI.
 * Nunca devolver só "Erro HTTP 409".
 */

export type PaidConsultationUserCode =
  | "OK"
  | "DISABLED"
  | "TOKEN_MISSING"
  | "CONSENT_REQUIRED"
  | "INVALID_CNPJ"
  | "CACHE_VALID"
  | "IN_FLIGHT"
  | "UNKNOWN_BILLING"
  | "INSUFFICIENT_BALANCE"
  | "AUTH"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "HTTP_ERROR"
  | "NETWORK"
  | "INVALID_INPUT"
  | "PARTIAL"
  | "PERSISTENCE_FAILED";

export const PAID_CONSULTATION_MESSAGES: Record<PaidConsultationUserCode, string> = {
  OK: "Consulta concluída.",
  DISABLED: "A consulta paga está desligada neste ambiente.",
  TOKEN_MISSING: "Token da Direct Data não configurado. A consulta não foi enviada.",
  CONSENT_REQUIRED: "Confirme o consentimento para autorizar a consulta paga.",
  INVALID_CNPJ: "CNPJ inválido. A consulta não foi enviada ao provedor.",
  CACHE_VALID: "A consulta em cache ainda é válida. Nenhuma nova cobrança foi feita.",
  IN_FLIGHT: "Já existe uma consulta em andamento para este CNPJ. Aguarde a conclusão.",
  UNKNOWN_BILLING:
    "Há uma cobrança anterior indeterminada neste CNPJ. Não reenvie até conciliar com a Direct Data.",
  INSUFFICIENT_BALANCE:
    "Saldo insuficiente na Direct Data. Recarregue créditos no provedor e tente de novo. Nenhuma cobrança foi lançada nesta tentativa.",
  AUTH: "A Direct Data recusou a autenticação (token inválido ou IP não liberado). A consulta não foi cobrada.",
  UNAVAILABLE: "A Direct Data ou a fonte consultada está indisponível no momento. Tente mais tarde. Esta tentativa não foi cobrada.",
  TIMEOUT:
    "A consulta excedeu o tempo limite. Se a cobrança ficou indeterminada, não reenvie até conciliar com a Direct Data.",
  RATE_LIMIT: "Limite de tentativas atingido. Aguarde antes de uma nova consulta.",
  HTTP_ERROR: "A Direct Data retornou um erro. Verifique o histórico da consulta antes de tentar de novo.",
  NETWORK:
    "Falha de rede ao falar com a Direct Data. Se a cobrança ficou indeterminada, não reenvie até conciliar.",
  INVALID_INPUT: "A Direct Data recusou os parâmetros da consulta. Nada foi cobrado.",
  PARTIAL: "O provedor devolveu um retorno incompleto. A cobrança ficou indeterminada; não reenvie até conciliar.",
  PERSISTENCE_FAILED:
    "A consulta pode ter sido cobrada, mas o resultado não foi gravado. Não reenvie até conciliar.",
};

export function paidConsultationMessage(
  code: string,
  providerMessage?: string | null
): string {
  const mapped = PAID_CONSULTATION_MESSAGES[code as PaidConsultationUserCode];
  const base = mapped ?? "Não foi possível concluir a consulta paga.";
  const extra = providerMessage?.trim();
  if (extra && extra.toLocaleLowerCase("pt-BR") !== base.toLocaleLowerCase("pt-BR")) {
    return `${base} ${extra}`;
  }
  return base;
}

export function paidConsultationHttpStatus(code: string): number {
  if (code === "OK" || code === "CACHE_VALID") return 200;
  if (code === "CONSENT_REQUIRED") return 422;
  if (code === "INSUFFICIENT_BALANCE") return 402;
  if (code === "IN_FLIGHT" || code === "UNKNOWN_BILLING" || code === "DISABLED" || code === "PARTIAL") {
    return 409;
  }
  if (
    code === "AUTH" ||
    code === "UNAVAILABLE" ||
    code === "TIMEOUT" ||
    code === "RATE_LIMIT" ||
    code === "HTTP_ERROR" ||
    code === "NETWORK" ||
    code === "PERSISTENCE_FAILED"
  ) {
    return 502;
  }
  return 400;
}
