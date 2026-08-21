/**
 * Predicados canônicos do setor RAW_MATERIAL (Collector / estoque logístico).
 *
 * Contagem e warehouse resolution usam InventoryItem ACTIVE + RAW_MATERIAL +
 * materialId + controlsStock — alinhado ao gate de movimentos.
 * Materiais elegíveis a vínculo: ACTIVE com código/descrição/unidade (OP-08).
 */
import type { Prisma } from "@prisma/client";

/** Where Prisma para item logístico de MP controlado em estoque. */
export const RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE = {
  status: "ACTIVE" as const,
  itemType: "RAW_MATERIAL" as const,
  materialId: { not: null } as const,
  controlsStock: true,
};

export type RawMaterialStockControlledItemWhere =
  typeof RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE;

/** Material oficial elegível a vínculo de estoque (mesma regra OP-08). */
export function isOfficialMaterialEligibleForStockLink(material: {
  status: string | null;
  code: string;
  description: string;
  unit: string;
}): boolean {
  const status = (material.status ?? "ACTIVE").trim().toUpperCase();
  if (status && status !== "ACTIVE") return false;
  return Boolean(
    material.code.trim() && material.description.trim() && material.unit.trim()
  );
}

export const ACTIVE_MATERIAL_WHERE: Prisma.MaterialWhereInput = {
  status: "ACTIVE",
};
