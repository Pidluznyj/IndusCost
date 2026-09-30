/**
 * Matriz de comissão lida da Formação de Preço para a auditoria da política.
 *
 * Fonte: a versão PUBLICADA e vigente de cada tabela comercial (Atacado,
 * Varejo 1–3) — a mesma seleção que o motor de comissão usa
 * (`loadCommercialPriceTiersForProduct`). Margem = `targetMarginPercent` da
 * versão (ou a margem padrão da tabela); comissão = `commissionPerc` da versão
 * (ou o percentual único dos itens). Somente leitura: nada é recalculado.
 */
import type { PrismaClient } from "@prisma/client";
import { COMMERCIAL_PRICE_TIER_CODES } from "@/src/lib/commissions/commission-commercial-tier.js";
import { OUT_OF_TABLE_COMMISSION_PERCENT } from "@/src/lib/commissions/commissionOutOfTable.js";
import type { CommissionMatrixInput, SystemCommissionTier } from "./commercialPolicyNormative.js";

type MatrixDb = Pick<PrismaClient, "priceTable" | "priceTableVersion" | "priceTableItem" | "commissionRule">;

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Nulo quando alguma tabela não está publicada ou não tem margem/comissão únicas. */
export async function loadCommissionMatrixFromPriceTables(db: MatrixDb, at: Date): Promise<CommissionMatrixInput | null> {
  const tables = await db.priceTable.findMany({
    where: { code: { in: [...COMMERCIAL_PRICE_TIER_CODES] }, status: "ACTIVE" },
    select: { id: true, code: true, name: true, defaultMarginPct: true },
  });
  const tiers: SystemCommissionTier[] = [];
  for (const code of COMMERCIAL_PRICE_TIER_CODES) {
    const table = tables.find((row) => row.code === code);
    if (!table) return null;
    const version = await db.priceTableVersion.findFirst({
      where: {
        priceTableId: table.id,
        status: "PUBLISHED",
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        ],
      },
      orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }, { versionNumber: "desc" }],
      select: { id: true, targetMarginPercent: true, commissionPerc: true },
    });
    if (!version) return null;
    const marginPercent = toNumber(version.targetMarginPercent) ?? toNumber(table.defaultMarginPct);
    let commissionPercent = toNumber(version.commissionPerc);
    if (commissionPercent === null) {
      // Versão gerada sem comissão única: só vale como matriz se todos os itens pagarem o mesmo percentual.
      const distinct = await db.priceTableItem.findMany({
        where: { priceTableVersionId: version.id },
        distinct: ["commissionPerc"],
        select: { commissionPerc: true },
        take: 2,
      });
      commissionPercent = distinct.length === 1 ? toNumber(distinct[0].commissionPerc) : null;
    }
    if (marginPercent === null || commissionPercent === null) return null;
    tiers.push({ code, name: table.name, marginPercent, commissionPercent });
  }
  const tierRules = await db.commissionRule.count({
    where: {
      active: true,
      calculationType: "COMMERCIAL_PRICE_TIER",
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
        { OR: [{ validTo: null }, { validTo: { gte: at } }] },
      ],
    },
  });
  return { tiers, outOfTableCommissionPercent: OUT_OF_TABLE_COMMISSION_PERCENT, engineRuleActive: tierRules > 0 };
}
