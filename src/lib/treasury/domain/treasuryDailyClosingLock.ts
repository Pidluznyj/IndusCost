/**
 * Chaves de advisory lock PostgreSQL para fechamento diário.
 * Escopo: empresa + data civil.
 */

import { createHash } from "node:crypto";

function readInt32BE(buf: Buffer, offset: number): number {
  const n = buf.readUInt32BE(offset);
  return n > 0x7fffffff ? n - 0x100000000 : n;
}

export function buildTreasuryDailyClosingAdvisoryLockKeys(
  companyCode: string,
  civilDate: string
): { key1: number; key2: number; lockName: string } {
  const lockName = `treasury:daily-closing:${companyCode.trim()}|${civilDate.trim()}`;
  const digest = createHash("sha256").update(lockName).digest();
  return {
    key1: readInt32BE(digest, 0),
    key2: readInt32BE(digest, 4),
    lockName,
  };
}
