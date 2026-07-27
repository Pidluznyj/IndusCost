/**
 * Repository somente leitura — títulos oficiais Nomus (CR/CP).
 * Delega ao adapter; não persiste cópia Tesouraria.
 */

import type { PrismaClient } from "@prisma/client";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";

export type TreasuryOfficialTitlesRepository = TreasuryOfficialTitlesAdapter;

export function createTreasuryOfficialTitlesRepository(
  prisma: PrismaClient
): TreasuryOfficialTitlesRepository {
  return createTreasuryOfficialTitlesAdapter(prisma);
}
