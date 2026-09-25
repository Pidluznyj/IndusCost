/**
 * Valorização gerencial do estoque.
 *
 * Quantidade: saldo físico já agregado por item (InventoryBalance).
 * Preço: somente a tabela comercial publicada de código VAREJO_1.
 * Custo: somente o custo industrial publicado vigente (ProductionCostTableItem.unitProductionCost).
 *
 * Não grava saldo, não lê descrição e não trata ausência de preço/custo como zero.
 */
import { Prisma } from "@prisma/client";

/** Código oficial da tabela na Formação de Preço / Tabela comercial. Único em PriceTable.code. */
export const INVENTORY_VAREJO_1_TABLE_CODE = "VAREJO_1" as const;

/**
 * Só produto acabado e componente entram na população.
 * Matéria-prima e demais tipos não recebem preço Varejo 1 nem custo industrial de produto.
 */
export const INVENTORY_VALUATION_ITEM_TYPES = ["FINISHED_PRODUCT", "COMPONENT"] as const;

export type InventoryValuationItemType = (typeof INVENTORY_VALUATION_ITEM_TYPES)[number];

export const INVENTORY_RETAIL_VALUATION_UNAVAILABLE =
  "Tabela Comercial Varejo 1 não está publicada.";

export const INVENTORY_INDUSTRIAL_COST_UNAVAILABLE =
  "Não existe custo industrial vigente publicado.";

export type InventoryValuationLine = {
  itemId: string;
  itemType: string;
  productId: string | null;
  physicalQuantity: Prisma.Decimal;
};

export type InventoryValuationMetric = {
  available: boolean;
  unavailableReason: string | null;
  /** Soma arredondada a centavos. Null quando a fonte oficial não está publicada. */
  value: number | null;
  coveredItems: number;
  uncoveredItems: number;
  coveredPhysicalQuantity: string;
  uncoveredPhysicalQuantity: string;
  /** Null quando não há população (saldo zero não entra). */
  coveragePercent: number | null;
  /** Saldo físico negativo da população: não entra na soma nem na cobertura. */
  negativePhysicalItems: number;
};

export type InventoryManagerialValuation = {
  salesPotential: InventoryValuationMetric;
  industrialCost: InventoryValuationMetric;
  /** Itens FINISHED_PRODUCT/COMPONENT com saldo físico positivo. */
  populationItemCount: number;
  /** Itens de outros tipos com saldo físico positivo, fora dos dois cards. */
  excludedPositiveItems: number;
};

export type InventoryValuationBalanceRow = {
  itemId: string;
  itemType: string;
  productId: string | null;
  physicalQuantity: unknown;
};

const ZERO = new Prisma.Decimal(0);

function toDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value == null || value === "") return ZERO;
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    return ZERO;
  }
}

function moneyNumber(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

function percentNumber(covered: number, population: number): number | null {
  if (population <= 0) return null;
  return new Prisma.Decimal(covered)
    .div(population)
    .mul(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function isInventoryValuationItemType(itemType: string): itemType is InventoryValuationItemType {
  return (INVENTORY_VALUATION_ITEM_TYPES as readonly string[]).includes(itemType);
}

/** Soma o saldo físico por item. Vários almoxarifados do mesmo item viram uma linha. */
export function aggregateInventoryPhysicalBalances(
  rows: readonly InventoryValuationBalanceRow[]
): InventoryValuationLine[] {
  const byItem = new Map<
    string,
    { itemType: string; productId: string | null; physicalQuantity: Prisma.Decimal }
  >();
  for (const row of rows) {
    const current = byItem.get(row.itemId);
    const qty = toDecimal(row.physicalQuantity);
    if (!current) {
      byItem.set(row.itemId, {
        itemType: row.itemType,
        productId: row.productId,
        physicalQuantity: qty,
      });
      continue;
    }
    current.physicalQuantity = current.physicalQuantity.add(qty);
  }
  return [...byItem.entries()].map(([itemId, row]) => ({
    itemId,
    itemType: row.itemType,
    productId: row.productId,
    physicalQuantity: row.physicalQuantity,
  }));
}

type MetricDraft = {
  value: Prisma.Decimal;
  coveredItems: number;
  uncoveredItems: number;
  coveredPhysicalQuantity: Prisma.Decimal;
  uncoveredPhysicalQuantity: Prisma.Decimal;
  negativePhysicalItems: number;
};

function emptyDraft(): MetricDraft {
  return {
    value: ZERO,
    coveredItems: 0,
    uncoveredItems: 0,
    coveredPhysicalQuantity: ZERO,
    uncoveredPhysicalQuantity: ZERO,
    negativePhysicalItems: 0,
  };
}

function finishMetric(draft: MetricDraft, available: boolean, unavailableReason: string | null): InventoryValuationMetric {
  const population = draft.coveredItems + draft.uncoveredItems;
  return {
    available,
    unavailableReason: available ? null : unavailableReason,
    value: available ? moneyNumber(draft.value) : null,
    coveredItems: draft.coveredItems,
    uncoveredItems: draft.uncoveredItems,
    coveredPhysicalQuantity: draft.coveredPhysicalQuantity.toString(),
    uncoveredPhysicalQuantity: draft.uncoveredPhysicalQuantity.toString(),
    coveragePercent: percentNumber(draft.coveredItems, population),
    negativePhysicalItems: draft.negativePhysicalItems,
  };
}

/**
 * `unitByProductId === null` significa fonte oficial indisponível (fail-closed).
 * Chave ausente ou valor null = dado ausente, fora da soma.
 * Zero presente no mapa é dado oficial publicado.
 */
function applyUnitPrice(
  draft: MetricDraft,
  quantity: Prisma.Decimal,
  productId: string | null,
  unitByProductId: ReadonlyMap<string, Prisma.Decimal | null> | null
): void {
  if (unitByProductId == null || !productId) {
    draft.uncoveredItems += 1;
    draft.uncoveredPhysicalQuantity = draft.uncoveredPhysicalQuantity.add(quantity);
    return;
  }
  if (!unitByProductId.has(productId)) {
    draft.uncoveredItems += 1;
    draft.uncoveredPhysicalQuantity = draft.uncoveredPhysicalQuantity.add(quantity);
    return;
  }
  const unit = unitByProductId.get(productId);
  if (unit == null) {
    draft.uncoveredItems += 1;
    draft.uncoveredPhysicalQuantity = draft.uncoveredPhysicalQuantity.add(quantity);
    return;
  }
  draft.coveredItems += 1;
  draft.coveredPhysicalQuantity = draft.coveredPhysicalQuantity.add(quantity);
  draft.value = draft.value.add(quantity.mul(unit));
}

export function computeInventoryManagerialValuation(input: {
  lines: readonly InventoryValuationLine[];
  /** Null = tabela Varejo 1 inexistente ou sem versão publicada vigente. */
  retailPriceByProductId: ReadonlyMap<string, Prisma.Decimal | null> | null;
  /** Null = nenhuma versão de custo industrial publicada vigente. */
  industrialCostByProductId: ReadonlyMap<string, Prisma.Decimal | null> | null;
  retailUnavailableReason?: string | null;
  industrialUnavailableReason?: string | null;
}): InventoryManagerialValuation {
  const sales = emptyDraft();
  const cost = emptyDraft();
  let excludedPositiveItems = 0;

  for (const line of input.lines) {
    const quantity = line.physicalQuantity;
    if (quantity.eq(ZERO)) continue;

    if (!isInventoryValuationItemType(line.itemType)) {
      if (quantity.gt(ZERO)) excludedPositiveItems += 1;
      continue;
    }

    if (quantity.lt(ZERO)) {
      sales.negativePhysicalItems += 1;
      cost.negativePhysicalItems += 1;
      continue;
    }

    applyUnitPrice(sales, quantity, line.productId, input.retailPriceByProductId);
    applyUnitPrice(cost, quantity, line.productId, input.industrialCostByProductId);
  }

  const retailAvailable = input.retailPriceByProductId != null;
  const costAvailable = input.industrialCostByProductId != null;

  return {
    salesPotential: finishMetric(
      sales,
      retailAvailable,
      input.retailUnavailableReason ?? INVENTORY_RETAIL_VALUATION_UNAVAILABLE
    ),
    industrialCost: finishMetric(
      cost,
      costAvailable,
      input.industrialUnavailableReason ?? INVENTORY_INDUSTRIAL_COST_UNAVAILABLE
    ),
    populationItemCount: sales.coveredItems + sales.uncoveredItems,
    excludedPositiveItems,
  };
}

export function emptyInventoryManagerialValuation(): InventoryManagerialValuation {
  return computeInventoryManagerialValuation({
    lines: [],
    retailPriceByProductId: new Map(),
    industrialCostByProductId: new Map(),
  });
}

/**
 * Preço/custo duplicado para o mesmo productId na mesma versão publicada:
 * o item fica sem dado (fail-closed), em vez de escolher uma linha.
 */
export function indexUnitAmountByProductId(
  rows: readonly { productId: string; amount: unknown }[]
): Map<string, Prisma.Decimal | null> {
  const map = new Map<string, Prisma.Decimal | null>();
  for (const row of rows) {
    if (map.has(row.productId)) {
      map.set(row.productId, null);
      continue;
    }
    if (row.amount == null || row.amount === "") {
      map.set(row.productId, null);
      continue;
    }
    map.set(row.productId, toDecimal(row.amount));
  }
  return map;
}
