/**
 * Token de preview OFX — opaco, temporário e server-side.
 * Não persiste movimentos em Prisma; só memória com TTL.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TREASURY_OFX_PREVIEW_TOKEN_TTL_SECONDS } from "../contracts/treasuryConstants.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type { TreasuryOfxPreviewMovementRow } from "../domain/treasuryOfxPreviewRules.js";
import type { TreasuryBankOfxFormat } from "../contracts/treasuryEnums.js";

export type TreasuryOfxPreviewTokenPayload = {
  userId: string;
  accountId: string;
  companyCode: string;
  fileSha256: string;
  originalFileName: string;
  format: TreasuryBankOfxFormat;
  byteLength: number;
  contentHash: string;
  movements: TreasuryOfxPreviewMovementRow[];
};

type StoredPreview = TreasuryOfxPreviewTokenPayload & {
  expiresAtMs: number;
  createdAtIso: string;
};

const store = new Map<string, StoredPreview>();

function previewSecret(): string {
  return (
    process.env.TREASURY_OFX_PREVIEW_TOKEN_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "induscost-treasury-ofx-preview-dev-secret"
  );
}

function signTokenId(tokenId: string, expiresAtMs: number, contentHash: string): string {
  return createHmac("sha256", previewSecret())
    .update(`${tokenId}|${expiresAtMs}|${contentHash}`)
    .digest("base64url");
}

function splitToken(token: string): { tokenId: string; signature: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [tokenId, signature] = parts;
  if (!tokenId || !signature) return null;
  return { tokenId, signature };
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function purgeExpired(nowMs: number): void {
  for (const [tokenId, row] of store) {
    if (row.expiresAtMs <= nowMs) store.delete(tokenId);
  }
}

export function clearTreasuryOfxPreviewTokenStoreForTests(): void {
  store.clear();
}

export function hashTreasuryOfxPreviewContent(
  movements: readonly TreasuryOfxPreviewMovementRow[]
): string {
  const material = JSON.stringify(
    movements.map((m) => ({
      status: m.status,
      fingerprint: m.fingerprint,
      fitId: m.fitId,
      amount: m.amount,
      postedCivilDate: m.postedCivilDate,
      direction: m.direction,
      invalidReason: m.invalidReason,
    }))
  );
  return createHmac("sha256", "treasury-ofx-preview-content")
    .update(material)
    .digest("hex");
}

export function issueTreasuryOfxPreviewToken(
  payload: TreasuryOfxPreviewTokenPayload,
  options?: { ttlSeconds?: number; nowMs?: number }
): { previewToken: string; expiresAt: string; contentHash: string } {
  const nowMs = options?.nowMs ?? Date.now();
  purgeExpired(nowMs);
  const ttlSeconds =
    options?.ttlSeconds ?? TREASURY_OFX_PREVIEW_TOKEN_TTL_SECONDS;
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const contentHash =
    payload.contentHash || hashTreasuryOfxPreviewContent(payload.movements);
  const tokenId = randomBytes(24).toString("base64url");
  const signature = signTokenId(tokenId, expiresAtMs, contentHash);
  store.set(tokenId, {
    ...payload,
    contentHash,
    expiresAtMs,
    createdAtIso: formatTreasuryTimestampIso(new Date(nowMs)),
  });
  return {
    previewToken: `${tokenId}.${signature}`,
    expiresAt: formatTreasuryTimestampIso(new Date(expiresAtMs)),
    contentHash,
  };
}

export function peekTreasuryOfxPreviewToken(
  previewToken: string,
  options?: { nowMs?: number; expectedUserId?: string }
): StoredPreview | null {
  const nowMs = options?.nowMs ?? Date.now();
  purgeExpired(nowMs);
  const parts = splitToken(previewToken.trim());
  if (!parts) return null;
  const row = store.get(parts.tokenId);
  if (!row) return null;
  if (row.expiresAtMs <= nowMs) {
    store.delete(parts.tokenId);
    return null;
  }
  const expectedSig = signTokenId(
    parts.tokenId,
    row.expiresAtMs,
    row.contentHash
  );
  if (!signaturesEqual(parts.signature, expectedSig)) return null;
  if (
    options?.expectedUserId &&
    options.expectedUserId !== row.userId
  ) {
    return null;
  }
  return row;
}

/** Consome (lê + remove) o token — uso no apply após validação. */
export function consumeTreasuryOfxPreviewToken(
  previewToken: string,
  options?: { nowMs?: number; expectedUserId?: string }
): StoredPreview | null {
  const row = peekTreasuryOfxPreviewToken(previewToken, options);
  if (!row) return null;
  const parts = splitToken(previewToken.trim());
  if (parts) store.delete(parts.tokenId);
  return row;
}
