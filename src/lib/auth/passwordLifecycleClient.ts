/**
 * Cliente das rotas do ciclo de senha.
 *
 * Browser-safe: só `fetch` e tipos. A senha existe apenas como variável local
 * do formulário e do corpo da requisição — nunca vai para localStorage,
 * sessionStorage, contexto persistente, URL ou query string.
 *
 * O tratamento de erro é por CÓDIGO (`HttpError.code`), nunca por texto da
 * mensagem: mudar uma frase em pt-BR não pode quebrar a UI.
 */

import { fetchJsonOk } from "@/src/lib/http";

export const PASSWORD_ERROR_CODES = {
  INVALID_CURRENT_PASSWORD: "INVALID_CURRENT_PASSWORD",
  PASSWORD_POLICY_VIOLATION: "PASSWORD_POLICY_VIOLATION",
  PASSWORD_REUSED: "PASSWORD_REUSED",
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  PASSWORD_CHANGE_NOT_REQUIRED: "PASSWORD_CHANGE_NOT_REQUIRED",
  PASSWORD_STATE_CHANGED: "PASSWORD_STATE_CHANGED",
  RATE_LIMITED: "RATE_LIMITED",
  FORBIDDEN: "FORBIDDEN",
} as const;

export type PasswordErrorCode =
  (typeof PASSWORD_ERROR_CODES)[keyof typeof PASSWORD_ERROR_CODES];

export type PasswordChangeResponse = {
  success: true;
  mustChangePassword: false;
  sessionsRevoked: number;
};

export type AdminResetPasswordResponse = {
  success: true;
  /** Exibida UMA vez ao SUPER_ADMIN; não há rota para reconsultar. */
  temporaryPassword: string;
  mustChangePassword: true;
  sessionsRevoked: number;
};

/** Troca voluntária — exige a senha atual. */
export async function requestChangeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<PasswordChangeResponse> {
  return fetchJsonOk<PasswordChangeResponse>("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Troca obrigatória — a posse já foi provada pelo login com a senha temporária. */
export async function requestCompletePasswordChange(input: {
  newPassword: string;
}): Promise<PasswordChangeResponse> {
  return fetchJsonOk<PasswordChangeResponse>("/api/auth/complete-password-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Reset administrativo — o backend é quem gera a senha temporária. */
export async function requestAdminResetPassword(
  userId: string
): Promise<AdminResetPasswordResponse> {
  return fetchJsonOk<AdminResetPasswordResponse>(
    `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
}

/** Mensagem em pt-BR a partir do código estável devolvido pela API. */
export function describePasswordError(
  code: string | undefined,
  fallback: string
): string {
  switch (code) {
    case PASSWORD_ERROR_CODES.INVALID_CURRENT_PASSWORD:
      return "Senha atual incorreta.";
    case PASSWORD_ERROR_CODES.PASSWORD_REUSED:
      return "A nova senha precisa ser diferente da atual.";
    case PASSWORD_ERROR_CODES.PASSWORD_STATE_CHANGED:
      return "A senha foi alterada em outro lugar. Recarregue a página e tente de novo.";
    case PASSWORD_ERROR_CODES.PASSWORD_CHANGE_NOT_REQUIRED:
      return "Não há troca pendente. Use a alteração normal de senha.";
    case PASSWORD_ERROR_CODES.RATE_LIMITED:
      return "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.";
    case PASSWORD_ERROR_CODES.FORBIDDEN:
      return "Você não tem permissão para esta operação.";
    default:
      return fallback;
  }
}
