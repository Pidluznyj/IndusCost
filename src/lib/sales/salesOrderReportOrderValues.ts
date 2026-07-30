/**
 * Resolução de valores monetários do Relatório de Pedidos de Venda.
 *
 * Regra oficial:
 * - `totalNetValue` do pedido = valor líquido (após desconto comercial).
 * - Soma qty × valorUnitario das linhas Nomus costuma ser BRUTA (antes do desconto).
 * - Nunca promover o bruto a "valor ativo": isso faz o desconto aparecer como "A faturar".
 *
 * Frontend-safe: sem Prisma.
 */

export type SalesOrderReportRawItemValueInput = {
  quantityOrdered: number;
  unitPrice: number;
  statusNormalized: string | null | undefined;
  quantityCut?: number | null;
};

export type SalesOrderReportOrderValues = {
  originalValue: number;
  canceledValue: number;
  cutValue: number;
  activeValue: number;
  /** Bruto ativo (qty × unitário) quando detectável; senão = activeValue. */
  grossActiveValue: number;
  /** Desconto comercial efetivo = bruto ativo − líquido ativo. */
  discountValue: number;
  itemsCount: number;
  activeItemsCount: number;
  canceledItemsCount: number;
  cutItemsCount: number;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Aceita linhas quase iguais ao líquido (±2%) como mesma base. */
const NEAR_NET_RATIO_MIN = 0.98;
const NEAR_NET_RATIO_MAX = 1.02;
/** Acima disso e até 2×: trata linhas como BRUTAS (desconto embutido). */
const GROSS_RATIO_MAX = 2;

/**
 * Resolve valores do pedido para o relatório analítico / PDF / XLSX.
 */
export function resolveSalesOrderReportOrderValues(input: {
  officialOrderNetValue: number;
  orderStatus: string | null | undefined;
  itemsCountFallback?: number | null;
  rawItems: readonly SalesOrderReportRawItemValueInput[];
}): SalesOrderReportOrderValues {
  const officialOrderNetValue = Math.max(0, roundMoney(input.officialOrderNetValue));
  let itemsCount = Math.max(0, Math.floor(input.itemsCountFallback ?? 0));
  let activeItemsCount = 0;
  let canceledItemsCount = 0;
  let cutItemsCount = 0;
  let originalValue = officialOrderNetValue;
  let canceledValue = 0;
  let cutValue = 0;
  let discountValue = 0;
  let grossActiveValue = 0;

  const rawItems = input.rawItems ?? [];

  if (rawItems.length > 0) {
    itemsCount = rawItems.length;
    let originalFromItems = 0;
    let canceledFromItems = 0;
    let cutFromItems = 0;

    for (const raw of rawItems) {
      const qtyOrdered = Math.max(0, Number(raw.quantityOrdered) || 0);
      const unitPrice = Math.max(0, Number(raw.unitPrice) || 0);
      const totalItemValue = roundMoney(qtyOrdered * unitPrice);
      originalFromItems = roundMoney(originalFromItems + totalItemValue);

      if (raw.statusNormalized === "CANCELED") {
        canceledItemsCount += 1;
        canceledFromItems = roundMoney(canceledFromItems + totalItemValue);
      } else if (raw.statusNormalized === "FULFILLED_WITH_CUT") {
        cutItemsCount += 1;
        const cutQty = Math.max(0, Number(raw.quantityCut) || 0);
        cutFromItems = roundMoney(cutFromItems + cutQty * unitPrice);
        activeItemsCount += 1;
      } else {
        activeItemsCount += 1;
      }
    }

    canceledValue = canceledFromItems;
    cutValue = cutFromItems;

    if (originalFromItems > 0) {
      if (officialOrderNetValue <= 0) {
        originalValue = originalFromItems;
        grossActiveValue = Math.max(0, roundMoney(originalFromItems - canceledValue - cutValue));
      } else {
        const ratio = originalFromItems / officialOrderNetValue;
        if (ratio >= NEAR_NET_RATIO_MIN && ratio <= NEAR_NET_RATIO_MAX) {
          // Linhas na mesma base do líquido oficial — preserva o total oficial.
          // Diferença de arredondamento (±2%) não é desconto comercial.
          originalValue = officialOrderNetValue;
          if (Math.abs(originalFromItems - officialOrderNetValue) > 0.009) {
            const scale = officialOrderNetValue / originalFromItems;
            canceledValue = roundMoney(canceledFromItems * scale);
            cutValue = roundMoney(cutFromItems * scale);
          }
          grossActiveValue = Math.max(0, roundMoney(originalValue - canceledValue - cutValue));
          discountValue = 0;
        } else if (ratio > NEAR_NET_RATIO_MAX && ratio <= GROSS_RATIO_MAX) {
          // Linhas brutas vs total líquido oficial → desconto comercial.
          originalValue = officialOrderNetValue;
          const scale = officialOrderNetValue / originalFromItems;
          canceledValue = roundMoney(canceledFromItems * scale);
          cutValue = roundMoney(cutFromItems * scale);
          const grossActive = Math.max(
            0,
            roundMoney(originalFromItems - canceledFromItems - cutFromItems)
          );
          const netActive = Math.max(0, roundMoney(originalValue - canceledValue - cutValue));
          grossActiveValue = grossActive;
          discountValue = roundMoney(Math.max(0, grossActive - netActive));
        } else {
          // Escala corrompida (unitário zerado/incompleto) — descarta cancel/corte das linhas.
          canceledValue = 0;
          cutValue = 0;
          originalValue = officialOrderNetValue;
          if (input.orderStatus === "CANCELLED") {
            canceledValue = officialOrderNetValue;
            canceledItemsCount = itemsCount;
            activeItemsCount = 0;
            cutItemsCount = 0;
          }
          grossActiveValue = Math.max(0, roundMoney(originalValue - canceledValue - cutValue));
        }
      }
    }
  } else if (input.orderStatus === "CANCELLED") {
    canceledItemsCount = itemsCount;
    canceledValue = originalValue;
  } else {
    activeItemsCount = itemsCount;
  }

  const activeValue = Math.max(0, roundMoney(originalValue - canceledValue - cutValue));
  if (grossActiveValue <= 0) {
    grossActiveValue = activeValue;
  }
  if (discountValue <= 0 && grossActiveValue > activeValue + 0.009) {
    discountValue = roundMoney(grossActiveValue - activeValue);
  }

  return {
    originalValue: roundMoney(originalValue),
    canceledValue: roundMoney(canceledValue),
    cutValue: roundMoney(cutValue),
    activeValue,
    grossActiveValue: roundMoney(grossActiveValue),
    discountValue: roundMoney(discountValue),
    itemsCount,
    activeItemsCount,
    canceledItemsCount,
    cutItemsCount,
  };
}
