/**
 * Política central de senha dos usuários humanos do IndusCost.
 *
 * Puro / browser-safe: sem crypto, sem Prisma, sem API Node. É a ÚNICA
 * autoridade sobre o que é uma senha aceitável — criação de usuário, reset
 * administrativo, troca voluntária e troca obrigatória consomem esta função.
 * Não espalhar `if (password.length ...)` por rota nenhuma.
 *
 * Decisão de produto (definitiva): senha de usuário humano NÃO expira
 * periodicamente. Não existe `passwordExpiresAt`, rotação por dias, alerta de
 * validade nem job de expiração. Sessão tem TTL próprio; senha não.
 *
 * Comprimento é medido em unidades UTF-16 (`String.length`) — o mesmo que o
 * `maxLength` de um `<input>` conta. Um emoji fora do BMP consome 2. O teto
 * também limita o custo do scrypt para entrada arbitrária.
 */

/** Mínimo obrigatório. Passphrase longa é preferível a composição forçada. */
export const PASSWORD_MIN_LENGTH = 12;

/** Teto explícito — acima disso a senha é REJEITADA, nunca truncada. */
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyViolation = "NOT_A_STRING" | "TOO_SHORT" | "TOO_LONG";

export type PasswordPolicyResult = {
  valid: boolean;
  /** Mensagens em pt-BR, prontas para exibição. */
  reasons: string[];
  /** Códigos estáveis — o cliente decide por código, nunca por texto. */
  codes: PasswordPolicyViolation[];
};

const REASON_BY_CODE: Record<PasswordPolicyViolation, string> = {
  NOT_A_STRING: "Informe a senha.",
  TOO_SHORT: `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`,
  TOO_LONG: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
};

/**
 * Regras: comprimento e nada mais.
 *
 * Deliberadamente NÃO exigimos maiúscula, minúscula, número ou símbolo:
 * composição obrigatória empurra o usuário para `Senha@2026` e piora a
 * entropia real. Espaços, acentos, Unicode, colar e gerenciador de senhas são
 * todos permitidos — a string chega ao hash exatamente como foi digitada.
 */
export function validatePasswordPolicy(password: unknown): PasswordPolicyResult {
  const codes: PasswordPolicyViolation[] = [];

  if (typeof password !== "string" || password.length === 0) {
    codes.push("NOT_A_STRING");
  } else {
    if (password.length < PASSWORD_MIN_LENGTH) codes.push("TOO_SHORT");
    if (password.length > PASSWORD_MAX_LENGTH) codes.push("TOO_LONG");
  }

  return {
    valid: codes.length === 0,
    reasons: codes.map((code) => REASON_BY_CODE[code]),
    codes,
  };
}

/** Primeira violação como texto, ou `null` quando a senha é aceitável. */
export function firstPasswordPolicyReason(password: unknown): string | null {
  const result = validatePasswordPolicy(password);
  return result.valid ? null : (result.reasons[0] ?? REASON_BY_CODE.NOT_A_STRING);
}

/** Texto de ajuda exibido ao lado dos campos de senha (pt-BR). */
export function describePasswordPolicy(): string {
  return (
    `Entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres. ` +
    "Pode usar frases, espaços e acentos — não exigimos maiúscula, número ou símbolo. " +
    "A senha não expira por tempo."
  );
}
