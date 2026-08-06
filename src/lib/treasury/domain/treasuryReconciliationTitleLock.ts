/**
 * Chaves de advisory lock PostgreSQL para o residual de um título oficial.
 *
 * Motivo (CASH-SUPPORT-P0-CONCURRENCY-001, resíduo "a"): o título é oficial do
 * Nomus e não tem linha local para bloquear com `FOR UPDATE`. Sem lock, dois
 * aceites concorrentes sobre o MESMO título usando movimentos DIFERENTES não
 * disputam nenhum recurso comum e podem, somados, exceder o saldo aberto.
 *
 * Mesmo padrão já usado pelo fechamento diário (`treasuryDailyClosingLock.ts`).
 * O escopo inclui a empresa e o lado (AR/AP) porque `externalId` só é único
 * dentro do lado no Nomus.
 */

import { createHash } from "node:crypto";

function readInt32BE(buf: Buffer, offset: number): number {
  const n = buf.readUInt32BE(offset);
  return n > 0x7fffffff ? n - 0x100000000 : n;
}

export function buildTreasuryReconciliationTitleAdvisoryLockKeys(
  companyCode: string,
  nomusSide: string,
  officialTitleId: string
): { key1: number; key2: number; lockName: string } {
  const lockName = `treasury:reconciliation-title:${companyCode.trim()}|${nomusSide.trim()}|${officialTitleId.trim()}`;
  const digest = createHash("sha256").update(lockName).digest();
  return {
    key1: readInt32BE(digest, 0),
    key2: readInt32BE(digest, 4),
    lockName,
  };
}
