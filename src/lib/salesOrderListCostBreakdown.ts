/**
 * Discriminação do custo industrial da listagem de Pedidos de Venda.
 * Agrega MP / HH / HM / demais a partir do breakdown unitário × quantidade.
 */

import {
  formatSalesOrderMarginMoney,
  formatSalesOrderMarginPercent,
} from "./salesOrderMarginDisplay.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

type OrderWithItemResults = {
  itemResults?: readonly SalesOrderMarginItemResult[] | null;
};

export type SalesOrderListCostBreakdown = {
  materialCost: number;
  laborCost: number;
  machineCost: number;
  otherIndustrialCost: number;
  taxAmount: number;
  totalIndustrialCost: number;
  /** totalIndustrial − (MP+HH+HM+demais); arredondamento / itens sem breakdown */
  residualCost: number;
  hasIndustrialBreakdown: boolean;
  itemsWithBreakdown: number;
  itemsWithoutBreakdown: number;
};

export const EMPTY_SALES_ORDER_LIST_COST_BREAKDOWN: SalesOrderListCostBreakdown = {
  materialCost: 0,
  laborCost: 0,
  machineCost: 0,
  otherIndustrialCost: 0,
  taxAmount: 0,
  totalIndustrialCost: 0,
  residualCost: 0,
  hasIndustrialBreakdown: false,
  itemsWithBreakdown: 0,
  itemsWithoutBreakdown: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function accumulateItem(
  acc: {
    material: number;
    labor: number;
    machine: number;
    other: number;
    withBreakdown: number;
    withoutBreakdown: number;
  },
  item: SalesOrderMarginItemResult
): void {
  const qty = item.quantity;
  const breakdown = item.productionCost?.unitBreakdown;
  if (
    !breakdown ||
    !Number.isFinite(qty) ||
    qty <= 0 ||
    item.totalCost == null ||
    !Number.isFinite(item.totalCost)
  ) {
    if (item.totalCost != null && Number.isFinite(item.totalCost) && item.totalCost > 0) {
      acc.withoutBreakdown += 1;
    }
    return;
  }
  acc.withBreakdown += 1;
  acc.material += breakdown.materialCost * qty;
  acc.labor += breakdown.laborCost * qty;
  acc.machine += breakdown.machineCost * qty;
  acc.other += breakdown.otherCost * qty;
}

export function aggregateSalesOrderListCostBreakdown(input: {
  marginByOrder: Iterable<OrderWithItemResults>;
  totalIndustrialCost: number;
  taxAmount: number;
}): SalesOrderListCostBreakdown {
  const acc = {
    material: 0,
    labor: 0,
    machine: 0,
    other: 0,
    withBreakdown: 0,
    withoutBreakdown: 0,
  };
  for (const order of input.marginByOrder) {
    for (const item of order.itemResults ?? []) {
      accumulateItem(acc, item);
    }
  }

  const materialCost = round2(acc.material);
  const laborCost = round2(acc.labor);
  const machineCost = round2(acc.machine);
  const otherIndustrialCost = round2(acc.other);
  const partsSum = round2(
    materialCost + laborCost + machineCost + otherIndustrialCost
  );
  const totalIndustrialCost = round2(
    Number.isFinite(input.totalIndustrialCost) ? Math.max(0, input.totalIndustrialCost) : 0
  );
  const taxAmount = round2(
    Number.isFinite(input.taxAmount) ? Math.max(0, input.taxAmount) : 0
  );
  const residualCost = round2(Math.max(0, totalIndustrialCost - partsSum));
  const hasIndustrialBreakdown = acc.withBreakdown > 0 && partsSum > 0;

  return {
    materialCost,
    laborCost,
    machineCost,
    otherIndustrialCost,
    taxAmount,
    totalIndustrialCost,
    residualCost,
    hasIndustrialBreakdown,
    itemsWithBreakdown: acc.withBreakdown,
    itemsWithoutBreakdown: acc.withoutBreakdown,
  };
}

/** Parte ÷ total × 100 (ex.: custo industrial ÷ valor vendido). */
export function shareOfSoldValuePercent(
  part: number,
  soldValue: number
): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(soldValue) || soldValue <= 0) {
    return null;
  }
  return round2((Math.max(0, part) / soldValue) * 100);
}

/** Texto do tooltip do card Custo estimado (hover). */
export function buildSalesOrderListCostBreakdownTooltipText(
  breakdown: SalesOrderListCostBreakdown | null | undefined,
  options?: { soldValue?: number | null }
): string {
  if (!breakdown) {
    return "Custo industrial indisponível para o filtro atual.";
  }
  const soldValue =
    options?.soldValue != null && Number.isFinite(options.soldValue)
      ? options.soldValue
      : null;
  const costShare = shareOfSoldValuePercent(
    breakdown.totalIndustrialCost,
    soldValue ?? 0
  );
  const taxShare = shareOfSoldValuePercent(breakdown.taxAmount, soldValue ?? 0);

  const lines: string[] = [
    "Custo considerado na margem",
    "",
    `Custo industrial total: ${formatSalesOrderMarginMoney(breakdown.totalIndustrialCost)}${
      costShare != null ? ` (${formatSalesOrderMarginPercent(costShare)} do valor vendido)` : ""
    }`,
  ];

  if (breakdown.hasIndustrialBreakdown) {
    lines.push(`MP (materiais): ${formatSalesOrderMarginMoney(breakdown.materialCost)}`);
    lines.push(`HH (mão de obra): ${formatSalesOrderMarginMoney(breakdown.laborCost)}`);
    lines.push(`HM (máquina): ${formatSalesOrderMarginMoney(breakdown.machineCost)}`);
    lines.push(
      `Demais (processo/CIF/outros): ${formatSalesOrderMarginMoney(breakdown.otherIndustrialCost)}`
    );
    if (breakdown.residualCost > 0.009) {
      lines.push(
        `Residual sem discriminação: ${formatSalesOrderMarginMoney(breakdown.residualCost)}`
      );
    }
  } else {
    lines.push("Discriminação MP/HH/HM indisponível na tabela vigente dos itens.");
  }

  lines.push("");
  lines.push(
    `Impostos (dedução da margem): ${formatSalesOrderMarginMoney(breakdown.taxAmount)}${
      taxShare != null ? ` (${formatSalesOrderMarginPercent(taxShare)} do valor vendido)` : ""
    }`
  );
  lines.push("Fonte: tabela de custo de produção vigente (mesmo CIU da margem).");

  if (breakdown.itemsWithoutBreakdown > 0) {
    lines.push("");
    lines.push(
      `Itens sem breakdown unitário: ${breakdown.itemsWithoutBreakdown}`
    );
  }

  return lines.join("\n");
}
