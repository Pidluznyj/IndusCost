/**
 * Chaves de advisory lock PostgreSQL para execução de projeção.
 * Escopo: empresa + cenário (evita concorrência).
 */

import { createHash } from "node:crypto";

function readInt32BE(buf: Buffer, offset: number): number {
  const n = buf.readUInt32BE(offset);
  return n > 0x7fffffff ? n - 0x100000000 : n;
}

/**
 * Deriva dois int32 assinados para pg_try_advisory_lock(key1, key2).
 */
export function buildTreasuryProjectionAdvisoryLockKeys(
  companyCode: string,
  scenario: string
): { key1: number; key2: number; lockName: string } {
  const lockName = `treasury:projection:${companyCode.trim()}|${scenario.trim()}`;
  const digest = createHash("sha256").update(lockName).digest();
  return {
    key1: readInt32BE(digest, 0),
    key2: readInt32BE(digest, 4),
    lockName,
  };
}
