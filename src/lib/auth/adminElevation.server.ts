/**
 * Step-up administrativo — server-only (HMAC).
 * Não importar no bundle frontend.
 */

import crypto from "crypto";
import {
  ADMIN_ELEVATION_PURPOSE,
  ADMIN_ELEVATION_TTL_MS,
  type AdminElevationStatus,
} from "./adminElevation.shared.js";

export type AdminElevationPayload = {
  userId: string;
  sessionId: string;
  purpose: typeof ADMIN_ELEVATION_PURPOSE;
  exp: number;
  nonce: string;
};

function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function encodeAdminElevationToken(
  payload: AdminElevationPayload,
  secret: string
): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function decodeAdminElevationToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): AdminElevationPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = signPayload(encodedPayload, secret);
  if (!safeEqualString(signature, expected)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<AdminElevationPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.purpose !== ADMIN_ELEVATION_PURPOSE) return null;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.nonce !== "string"
    ) {
      return null;
    }
    if (!Number.isFinite(parsed.exp) || parsed.exp <= nowMs) return null;
    return {
      userId: parsed.userId,
      sessionId: parsed.sessionId,
      purpose: ADMIN_ELEVATION_PURPOSE,
      exp: parsed.exp,
      nonce: parsed.nonce,
    };
  } catch {
    return null;
  }
}

export function createAdminElevationPayload(args: {
  userId: string;
  sessionId: string;
  ttlMs?: number;
  nowMs?: number;
}): AdminElevationPayload {
  const nowMs = args.nowMs ?? Date.now();
  const ttlMs = args.ttlMs ?? ADMIN_ELEVATION_TTL_MS;
  return {
    userId: args.userId,
    sessionId: args.sessionId,
    purpose: ADMIN_ELEVATION_PURPOSE,
    exp: nowMs + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };
}

export function isAdminElevationBoundToSession(
  payload: AdminElevationPayload | null,
  args: { userId: string; sessionId: string; nowMs?: number }
): payload is AdminElevationPayload {
  if (!payload) return false;
  const nowMs = args.nowMs ?? Date.now();
  if (payload.exp <= nowMs) return false;
  if (payload.purpose !== ADMIN_ELEVATION_PURPOSE) return false;
  return (
    safeEqualString(payload.userId, args.userId) &&
    safeEqualString(payload.sessionId, args.sessionId)
  );
}

export function toAdminElevationStatus(
  payload: AdminElevationPayload | null
): AdminElevationStatus {
  if (!payload) {
    return { active: false, expiresAt: null, ttlMs: ADMIN_ELEVATION_TTL_MS };
  }
  return {
    active: true,
    expiresAt: new Date(payload.exp).toISOString(),
    ttlMs: ADMIN_ELEVATION_TTL_MS,
  };
}

export function resolveAdminElevationSecret(envSecret: string | undefined, fallback: string): string {
  const trimmed = String(envSecret ?? "").trim();
  if (trimmed) return `induscost-admin-elevation:${trimmed}`;
  return fallback;
}
