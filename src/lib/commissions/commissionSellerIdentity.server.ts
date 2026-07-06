import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import type {
  CommissionPersonAliasRow,
  CommissionSellerIdentityContext,
} from "./commissionSellerIdentity.js";

export async function loadCommissionSellerIdentityContext(
  db: Pick<PrismaClient, "commissionPerson" | "commissionPersonAlias">
): Promise<CommissionSellerIdentityContext> {
  const [persons, aliases] = await Promise.all([
    db.commissionPerson.findMany({
      where: { type: "SELLER" },
      select: {
        id: true,
        nomusPersonId: true,
        name: true,
        type: true,
        source: true,
        active: true,
        createdAt: true,
        _count: { select: { commissionRecords: true } },
      },
    }),
    db.commissionPersonAlias.findMany({
      select: {
        id: true,
        commissionedPersonId: true,
        source: true,
        rawSellerId: true,
        rawSellerName: true,
        normalizedSellerName: true,
        status: true,
        confidence: true,
      },
    }),
  ]);

  return {
    persons: persons.map((row) => ({
      id: row.id,
      nomusPersonId: row.nomusPersonId,
      name: row.name,
      type: row.type,
      source: row.source,
      active: row.active,
      createdAt: row.createdAt,
      linkedRecordCount: row._count.commissionRecords,
    })),
    aliases: aliases.map(
      (row): CommissionPersonAliasRow => ({
        id: row.id,
        commissionedPersonId: row.commissionedPersonId,
        source: row.source,
        rawSellerId: row.rawSellerId,
        rawSellerName: row.rawSellerName,
        normalizedSellerName: row.normalizedSellerName,
        status: row.status,
        confidence: row.confidence != null ? decimalToNumber(row.confidence) : null,
      })
    ),
  };
}
