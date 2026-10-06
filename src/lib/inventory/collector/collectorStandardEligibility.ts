/**
 * Elegibilidade de item em setor STANDARD (InventoryStockSector) — regra única,
 * sem I/O, compartilhada por população da contagem, retirada, contexto do
 * Collector e prévia do cadastro administrativo.
 *
 * Item elegível: ACTIVE + controla estoque + itemType do setor. Não exige
 * materialId nem productId — a identidade é o próprio InventoryItem.
 *
 * Pertence ao setor quando o almoxarifado do setor é o almoxarifado padrão do
 * item, ou quando já existe InventoryBalance do item nesse almoxarifado (fato
 * histórico já movimentado continua visível mesmo se o padrão do item mudou).
 * Como o itemType também é exigido, saldo de item de outro tipo no mesmo
 * almoxarifado nunca entra por acidente.
 */
import type { InventoryItemType } from "@prisma/client";

export type StandardSectorScope = {
  itemType: InventoryItemType;
  warehouseId: string;
};

/** Predicado do item elegível (sem o pertencimento ao almoxarifado). */
export function standardSectorStockControlledItemWhere(
  sector: Pick<StandardSectorScope, "itemType">
) {
  return {
    status: "ACTIVE" as const,
    itemType: sector.itemType,
    controlsStock: true,
  };
}

/** Predicado completo: elegível E pertencente ao almoxarifado do setor. */
export function standardSectorMemberItemWhere(sector: StandardSectorScope) {
  return {
    ...standardSectorStockControlledItemWhere(sector),
    OR: [
      { defaultWarehouseId: sector.warehouseId },
      { balances: { some: { warehouseId: sector.warehouseId } } },
    ],
  };
}
