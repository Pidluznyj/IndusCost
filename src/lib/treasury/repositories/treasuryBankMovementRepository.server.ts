/**
 * Repository mínimo de movimentos bancários — lookups de dedupe (server-only).
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export type TreasuryBankMovementDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryBankMovementRepository = {
  findExistingFingerprints(
    accountId: string,
    fingerprints: readonly string[],
    db?: TreasuryBankMovementDb
  ): Promise<Set<string>>;
  findBatchIdByFileSha256(
    accountId: string,
    fileSha256: string,
    db?: TreasuryBankMovementDb
  ): Promise<string | null>;
};

export function createTreasuryBankMovementRepository(
  prisma: PrismaClient
): TreasuryBankMovementRepository {
  return {
    async findExistingFingerprints(accountId, fingerprints, db = prisma) {
      const unique = [...new Set(fingerprints.map((f) => f.trim()).filter(Boolean))];
      if (unique.length === 0) return new Set();
      const rows = await db.treasuryBankMovement.findMany({
        where: { accountId, fingerprint: { in: unique } },
        select: { fingerprint: true },
      });
      return new Set(rows.map((r) => r.fingerprint));
    },

    async findBatchIdByFileSha256(accountId, fileSha256, db = prisma) {
      const row = await db.treasuryBankImportBatch.findUnique({
        where: {
          accountId_fileSha256: {
            accountId,
            fileSha256: fileSha256.trim(),
          },
        },
        select: { id: true },
      });
      return row?.id ?? null;
    },
  };
}
