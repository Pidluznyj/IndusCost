/**
 * Relatório de saldos de estoque para análise de compra — puro (sem Prisma).
 * Uma linha por item, com o saldo físico somado entre almoxarifados/locais e as
 * datas da última contagem e da última movimentação. Ordenado do maior saldo
 * para o menor. Os mesmos números alimentam a planilha e o PDF.
 */
import { INVENTORY_ITEM_TYPE_LABELS } from "./inventoryItemTypeLabels.js";
import type { InventoryItemType } from "./inventoryTypes.js";

export const INVENTORY_BALANCE_REPORT_TITLE = "Saldos de estoque";

export const INVENTORY_BALANCE_REPORT_PURPOSE =
  "Saldo físico por item, do maior para o menor, com a data da última contagem e da última movimentação, para apoiar a análise do que precisa ser comprado.";

export type InventoryBalanceReportSourceLine = {
  itemId: string;
  code: string;
  description: string;
  unit: string;
  itemType: string;
  physicalQuantity: number;
  lastMovementAt: Date | null;
};

export type InventoryBalanceReportFilter = {
  label: string;
  value: string;
};

export type InventoryBalanceReportRow = {
  itemCode: string;
  description: string;
  itemTypeLabel: string;
  unit: string;
  physicalQuantity: number;
  /** ISO; `null` quando o item nunca foi contado. */
  lastCountAt: string | null;
  /** ISO; `null` quando o saldo não tem movimentação registrada. */
  lastMovementAt: string | null;
};

export type InventoryBalanceReport = {
  title: string;
  purpose: string;
  generatedAt: string;
  filters: InventoryBalanceReportFilter[];
  notes: string[];
  rows: InventoryBalanceReportRow[];
  itemCount: number;
  zeroItems: number;
  negativeItems: number;
};

export const INVENTORY_BALANCE_REPORT_NOTES = [
  "O saldo é o saldo físico do item, somado entre os almoxarifados e locais dentro do filtro.",
  "A lista vai do maior saldo para o menor; itens zerados e negativos ficam no fim.",
  "Última contagem é a data em que o item foi contado pela última vez em um inventário não cancelado.",
  "Última movimentação é a data do movimento mais recente que alterou o saldo do item.",
  "Itens sem nenhum saldo registrado no estoque não aparecem.",
];

const NO_FILTER: InventoryBalanceReportFilter = {
  label: "Filtros",
  value: "Nenhum. Todos os itens com saldo registrado.",
};

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** Saldos têm 6 casas no banco; a soma em ponto flutuante volta para 6 casas. */
function roundQuantity(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function buildInventoryBalanceReport(input: {
  lines: readonly InventoryBalanceReportSourceLine[];
  lastCountAtByItemId: ReadonlyMap<string, Date>;
  filters?: readonly InventoryBalanceReportFilter[];
  generatedAt: Date;
}): InventoryBalanceReport {
  const byItem = new Map<
    string,
    Omit<InventoryBalanceReportSourceLine, "itemId"> & { itemId: string }
  >();
  for (const line of input.lines) {
    const current = byItem.get(line.itemId);
    if (!current) {
      byItem.set(line.itemId, { ...line });
      continue;
    }
    current.physicalQuantity += line.physicalQuantity;
    current.lastMovementAt = latest(current.lastMovementAt, line.lastMovementAt);
  }

  const rows = [...byItem.values()]
    .map((item): InventoryBalanceReportRow => ({
      itemCode: item.code,
      description: item.description,
      itemTypeLabel: INVENTORY_ITEM_TYPE_LABELS[item.itemType as InventoryItemType] ?? item.itemType,
      unit: item.unit,
      physicalQuantity: roundQuantity(item.physicalQuantity),
      lastCountAt: input.lastCountAtByItemId.get(item.itemId)?.toISOString() ?? null,
      lastMovementAt: item.lastMovementAt?.toISOString() ?? null,
    }))
    .sort(
      (a, b) =>
        b.physicalQuantity - a.physicalQuantity ||
        a.itemCode.localeCompare(b.itemCode, "pt-BR", { numeric: true, sensitivity: "base" })
    );

  return {
    title: INVENTORY_BALANCE_REPORT_TITLE,
    purpose: INVENTORY_BALANCE_REPORT_PURPOSE,
    generatedAt: input.generatedAt.toISOString(),
    filters: input.filters && input.filters.length > 0 ? [...input.filters] : [NO_FILTER],
    notes: [...INVENTORY_BALANCE_REPORT_NOTES],
    rows,
    itemCount: rows.length,
    zeroItems: rows.filter((row) => row.physicalQuantity === 0).length,
    negativeItems: rows.filter((row) => row.physicalQuantity < 0).length,
  };
}

export function inventoryBalanceReportFilename(generatedAtIso: string): string {
  return `saldos-estoque-${generatedAtIso.slice(0, 10)}.xlsx`;
}
