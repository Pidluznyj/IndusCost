/**
 * Convite individual. O segredo em claro só existe na resposta de emissão.
 * Em repouso fica o SHA-256. O QR não carrega o código de confirmação.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const LINK_TOKEN_BYTES = 32;
export const OTP_ATTEMPT_LIMIT = 5;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function newLinkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString("base64url");
}

export function newSessionToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString("base64url");
}

/** Código curto, separado do link. A entrega operacional ainda não está homologada. */
export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function digestSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function secretsMatch(leftDigest: string, rightDigest: string): boolean {
  const left = Buffer.from(leftDigest, "hex");
  const right = Buffer.from(rightDigest, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type InviteGate =
  | { ok: true }
  | { ok: false; code: "INVALID" | "EXPIRED" | "REVOKED" | "LOCKED" | "SUBMITTED" };

export function gateInvite(input: {
  found: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  locked: boolean;
  submitted: boolean;
  now: Date;
}): InviteGate {
  if (!input.found) return { ok: false, code: "INVALID" };
  if (input.revokedAt) return { ok: false, code: "REVOKED" };
  if (input.locked) return { ok: false, code: "LOCKED" };
  if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) return { ok: false, code: "EXPIRED" };
  if (input.submitted) return { ok: false, code: "SUBMITTED" };
  return { ok: true };
}

export const PUBLIC_NEUTRAL_MESSAGE = "Não foi possível abrir esta pesquisa.";

export function publicFailureMessage(): string {
  return PUBLIC_NEUTRAL_MESSAGE;
}

/** O fragmento não vai no Referer. O token não fica na query. */
export function buildInviteHashUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/avaliacao#t=${encodeURIComponent(token)}`;
}
