/**
 * Token do link público de Satisfação.
 *
 * Regras:
 *  - 256 bits de entropia (`crypto.randomBytes(32)`), codificado base64url.
 *  - O banco guarda SOMENTE `sha256(token)`. O texto em claro existe uma única
 *    vez, no retorno da geração, e nunca é persistido nem logado.
 *  - O token viaja no FRAGMENTO da URL (`/r#TOKEN`), que o navegador não envia
 *    no request HTTP — logo não aparece em log de Cloudflare, nginx ou origin.
 *  - Nenhum id sequencial ou interno participa da autorização.
 */

import crypto from "crypto";

/** Bytes de entropia do token público. */
export const SATISFACTION_TOKEN_BYTES = 32;

/** Caracteres do prefixo NÃO sensível guardado para suporte identificar o link. */
export const SATISFACTION_TOKEN_PREFIX_LENGTH = 8;

/** Path do formulário público. O token vai no fragmento, nunca no path. */
export const SATISFACTION_PUBLIC_FORM_PATH = "/r";

export type SatisfactionGeneratedToken = {
  /** Texto em claro — entregue UMA vez ao operador; nunca persistido. */
  token: string;
  /** O que vai para o banco. */
  tokenHash: string;
  /** Trecho não sensível, só para suporte casar um link a um convite. */
  tokenPrefix: string;
};

export function hashSatisfactionToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildTokenPrefix(token: string): string {
  return token.slice(0, SATISFACTION_TOKEN_PREFIX_LENGTH);
}

export function generateSatisfactionToken(): SatisfactionGeneratedToken {
  const token = crypto.randomBytes(SATISFACTION_TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashSatisfactionToken(token),
    tokenPrefix: buildTokenPrefix(token),
  };
}

/** Comparação em tempo constante — evita distinguir hashes por timing. */
export function safeEqualHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Formato aceito na troca token→sessão. Rejeita cedo o que nem parece token,
 * sem custo de banco.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isWellFormedSatisfactionToken(raw: unknown): raw is string {
  return typeof raw === "string" && TOKEN_PATTERN.test(raw);
}

/** Sessão pública: mesmo padrão de segredo, hash no banco. */
export function generatePublicSessionToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(SATISFACTION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashSatisfactionToken(token) };
}

// ─── Montagem do link ───────────────────────────────────────────────────────

function normalizeBaseUrl(baseUrl: string | null | undefined): string | null {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

/**
 * Link que vai para o cliente. O token fica após `#` justamente para não ser
 * transmitido ao servidor nem registrado em nenhum log de acesso.
 */
export function buildSatisfactionPublicUrl(
  token: string,
  baseUrl?: string | null
): string {
  const base = normalizeBaseUrl(baseUrl);
  const path = `${SATISFACTION_PUBLIC_FORM_PATH}#${token}`;
  return base ? `${base}${path}` : path;
}

/** Lê o token do fragmento (`#TOKEN` ou `#token=TOKEN`). Usado no browser. */
export function parseTokenFromFragment(fragment: string | null | undefined): string | null {
  if (typeof fragment !== "string") return null;
  const raw = fragment.replace(/^#/, "").trim();
  if (!raw) return null;
  const candidate = raw.startsWith("token=") ? raw.slice("token=".length) : raw;
  return isWellFormedSatisfactionToken(candidate) ? candidate : null;
}

// ─── Estado do token ────────────────────────────────────────────────────────

export type SatisfactionTokenState = {
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type SatisfactionTokenUsability =
  | { usable: true }
  | { usable: false; reason: "REVOKED" | "EXPIRED" | "INVALID" };

/**
 * Um token só serve se estiver ACTIVE, não revogado e dentro da validade.
 * `expiresAt` no passado vale como expirado mesmo que o status ainda diga
 * ACTIVE — o relógio decide, não o campo desatualizado.
 */
export function evaluateTokenUsability(
  state: SatisfactionTokenState | null | undefined,
  now: Date
): SatisfactionTokenUsability {
  if (!state) return { usable: false, reason: "INVALID" };
  if (state.status === "REVOKED" || state.revokedAt != null) {
    return { usable: false, reason: "REVOKED" };
  }
  if (state.status === "EXPIRED") return { usable: false, reason: "EXPIRED" };
  if (state.expiresAt != null && now > state.expiresAt) {
    return { usable: false, reason: "EXPIRED" };
  }
  if (state.status !== "ACTIVE") return { usable: false, reason: "INVALID" };
  return { usable: true };
}
