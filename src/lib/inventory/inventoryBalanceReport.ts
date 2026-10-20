/**
 * Relatório de saldos de estoque para análise de compra — puro (sem Prisma).
 * Uma linha por item, com o saldo físico somado entre almoxarifados/locais e as
 * datas da última contagem e da última movimentação. Ordenado do maior saldo
 * para o menor. Os mesmos números alimentam a planilha e o PDF.
 */
import type { InventoryBalanceReportZeroMode } from "./inventoryListQuery.js";
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

const INVENTORY_BALANCE_REPORT_NOTES_SHARED = [
  "O saldo é o saldo físico do item, somado entre os almoxarifados e locais dentro do filtro.",
  "A lista vai do maior saldo para o menor; itens zerados e negativos ficam no fim.",
  "Última contagem é a data em que o item foi contado pela última vez em um inventário não cancelado.",
  "Última movimentação é a data do movimento mais recente que alterou o saldo do item.",
] as const;

export function inventoryBalanceReportNotes(mode: InventoryBalanceReportZeroMode = "legacy"): string[] {
  if (mode === "including_zero") {
    return [
      ...INVENTORY_BALANCE_REPORT_NOTES_SHARED,
      "Inclui itens com saldo físico zero e itens cadastrados sem registro de saldo, apresentados como zero.",
      "Não cria registro de saldo. Itens sem movimento no almoxarifado filtrado entram quando o cadastro aponta esse almoxarifado padrão.",
    ];
  }
  if (mode === "nonzero") {
    return [
      ...INVENTORY_BALANCE_REPORT_NOTES_SHARED,
      "Somente itens com saldo físico consolidado diferente de zero (positivos e negativos).",
    ];
  }
  return [
    ...INVENTORY_BALANCE_REPORT_NOTES_SHARED,
    "Itens sem nenhum saldo registrado no estoque não aparecem.",
  ];
}

/** Notas do contrato legado (API sem `zeroBalanceMode`). */
export const INVENTORY_BALANCE_REPORT_NOTES = inventoryBalanceReportNotes("legacy");

export function inventoryBalanceReportZeroFilter(
  mode: InventoryBalanceReportZeroMode
): InventoryBalanceReportFilter | null {
  if (mode === "including_zero") return { label: "Saldos", value: "incluindo itens zerados" };
  if (mode === "nonzero") return { label: "Saldos", value: "somente itens com saldo" };
  return null;
}

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
  zeroBalanceMode?: InventoryBalanceReportZeroMode;
}): InventoryBalanceReport {
  const zeroBalanceMode = input.zeroBalanceMode ?? "legacy";
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
    .filter((row) => (zeroBalanceMode === "nonzero" ? row.physicalQuantity !== 0 : true))
    .sort(
      (a, b) =>
        b.physicalQuantity - a.physicalQuantity ||
        a.itemCode.localeCompare(b.itemCode, "pt-BR", { numeric: true, sensitivity: "base" })
    );

  const zeroFilter = inventoryBalanceReportZeroFilter(zeroBalanceMode);
  const filters = [...(input.filters ?? [])];
  if (zeroFilter) filters.push(zeroFilter);

  return {
    title: INVENTORY_BALANCE_REPORT_TITLE,
    purpose: INVENTORY_BALANCE_REPORT_PURPOSE,
    generatedAt: input.generatedAt.toISOString(),
    filters: filters.length > 0 ? filters : [NO_FILTER],
    notes: inventoryBalanceReportNotes(zeroBalanceMode),
    rows,
    itemCount: rows.length,
    zeroItems: rows.filter((row) => row.physicalQuantity === 0).length,
    negativeItems: rows.filter((row) => row.physicalQuantity < 0).length,
  };
}

export function inventoryBalanceReportFilename(generatedAtIso: string): string {
  return `saldos-estoque-${generatedAtIso.slice(0, 10)}.xlsx`;
}
