/**
 * FIN-13 — Redistribuição da previsão residual em entregas parciais (staged).
 *
 * Não altera o fluxo de substituição integral (residual zero).
 * Sem I/O. Decimal oficial do Prisma.
 */

import { Prisma } from "@prisma/client";
import type { SalesOrderItemFinancialAmounts } from "./salesOrderItemFinancialAmounts.js";

const ZERO = new Prisma.Decimal(0);
const MONEY_DP = 2;
const ROUND = Prisma.Decimal.ROUND_HALF_UP;

/** Classificação central de materialização da agenda (FIN-13). */
export type EffectiveScheduleMaterializationMode =
  | "NO_MATERIALIZATION"
  | "FULL_SUBSTITUTION"
  | "STAGED_AUTOMATIC"
  | "STAGED_MANUAL"
  | "CLOSED_WITH_CUT"
  | "CANCELED"
  | "INCONCLUSIVE"
  /** Entrega parcial sem elegibilidade staged (ex.: 1 posição) — proporção legado. */
  | "PROPORTIONAL_FALLBACK";

export type StagedDeliveryBlock = {
  key: string;
  commercialAmount: Prisma.Decimal;
  sortDate: string | null;
  sortKey: string;
};

export type StagedDeliveryPositionInput = {
  installmentNumber: number;
  dueDate: string | null;
  originalAmount: Prisma.Decimal;
};

/** Subconjunto do Documento usado só para ordenar/contar blocos de entrega. */
export type StagedDeliveryDocumentInput = {
  documentKey: string;
  sourceInvoiceId?: number | null;
  isValid?: boolean;
  allocatedByOrderPrice: Prisma.Decimal | string;
  documentDate?: string | null;
  issuedAt?: string | null;
  provenInstallments?: readonly {
    installmentNumber: number;
    dueDate: string | null;
    amount: Prisma.Decimal | string;
  }[] | null;
};

export type StagedDeliveryReceivableInput = {
  externalId: number;
  sourceInvoiceId?: number | null;
  dueDate?: string | null;
  amountReceivable: Prisma.Decimal | string;
};

export type StagedDeliveryOriginalInstallmentInput = {
  installmentNumber: number;
  dueDate: string | null;
  amount: Prisma.Decimal | string;
};

export type AllocateStagedDeliveryResidualResult = {
  /** Residual por índice da posição original (mesma ordem de entrada). */
  residualParts: Prisma.Decimal[];
  occupiedPositionIndexes: number[];
  deliveryBlocks: StagedDeliveryBlock[];
  /** Residual ativo sem posição aberta (não inventa vencimento). */
  stagedResidualWithoutPosition: Prisma.Decimal;
};

export type ResolveMaterializationModeInput = {
  itemAmounts: readonly SalesOrderItemFinancialAmounts[];
  deliveryBlockCount: number;
  originalPositionCount: number;
  itemActiveResidualTotal: Prisma.Decimal;
  cutAmount: Prisma.Decimal;
  canceledAmount: Prisma.Decimal;
  unresolvedAmount: Prisma.Decimal;
  /** Agenda manual explícita — só quando houver evidência tipada no input. */
  hasExplicitManualResidualSchedule?: boolean;
};

function money(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (value == null || value === "") return ZERO;
  if (value instanceof Prisma.Decimal) {
    if (value.isNaN() || !value.isFinite()) return ZERO;
    return value.toDecimalPlaces(MONEY_DP, ROUND);
  }
  try {
    const d = new Prisma.Decimal(value);
    if (d.isNaN() || !d.isFinite()) return ZERO;
    return d.toDecimalPlaces(MONEY_DP, ROUND);
  } catch {
    return ZERO;
  }
}

function maxMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.gte(b) ? a : b;
}

function compareIsoDateNullLast(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

/**
 * Distribui residual nas posições restantes por peso relativo (centavos na última).
 * Índices fora de `remainingIndexes` recebem zero.
 */
export function allocateResidualAmongPositions(
  originalAmounts: readonly Prisma.Decimal[],
  remainingIndexes: readonly number[],
  residualTotal: Prisma.Decimal | string
): Prisma.Decimal[] {
  const residual = money(residualTotal);
  const out = originalAmounts.map(() => ZERO);
  if (remainingIndexes.length === 0 || residual.lte(0)) return out;

  const weights = remainingIndexes.map((i) =>
    maxMoney(ZERO, money(originalAmounts[i] ?? ZERO))
  );
  const weightSum = weights.reduce((s, w) => s.add(w), ZERO);

  if (weightSum.lte(0)) {
    out[remainingIndexes[remainingIndexes.length - 1]!] = residual;
    return out;
  }

  let allocated = ZERO;
  for (let k = 0; k < remainingIndexes.length; k += 1) {
    const idx = remainingIndexes[k]!;
    const isLast = k === remainingIndexes.length - 1;
    if (isLast) {
      out[idx] = residual.sub(allocated).toDecimalPlaces(MONEY_DP, ROUND);
    } else {
      const part = residual
        .mul(weights[k]!)
        .div(weightSum)
        .toDecimalPlaces(MONEY_DP, ROUND);
      out[idx] = part;
      allocated = allocated.add(part);
    }
  }
  return out;
}

/**
 * Monta blocos de entrega determinísticos (1 Documento = 1 bloco;
 * vários CRs da mesma NF sem Doc = 1 bloco).
 */
export function buildStagedDeliveryBlocks(input: {
  documents?: readonly StagedDeliveryDocumentInput[] | null;
  realReceivables?: readonly StagedDeliveryReceivableInput[] | null;
}): StagedDeliveryBlock[] {
  const blocks: StagedDeliveryBlock[] = [];
  const invoiceIdsWithDoc = new Set<number>();

  for (const doc of input.documents ?? []) {
    if (doc.isValid === false) continue;
    const allocated = money(doc.allocatedByOrderPrice);
    if (allocated.lte(0)) continue;
    const invoiceId = doc.sourceInvoiceId ?? null;
    if (invoiceId != null) invoiceIdsWithDoc.add(invoiceId);

    const sortDate =
      doc.documentDate?.trim() ||
      doc.issuedAt?.trim() ||
      doc.provenInstallments?.[0]?.dueDate ||
      null;

    blocks.push({
      key: `doc:${doc.documentKey}`,
      commercialAmount: allocated,
      sortDate,
      sortKey: doc.documentKey,
    });
  }

  const crGroups = new Map<
    string,
    { commercialHint: Prisma.Decimal; sortDate: string | null; sortKey: string }
  >();
  for (const cr of input.realReceivables ?? []) {
    const invoiceId = cr.sourceInvoiceId ?? null;
    if (invoiceId != null && invoiceIdsWithDoc.has(invoiceId)) continue;
    const groupKey =
      invoiceId != null ? `cr-inv:${invoiceId}` : `cr:${cr.externalId}`;
    const prev = crGroups.get(groupKey);
    const due = cr.dueDate ?? null;
    if (!prev) {
      crGroups.set(groupKey, {
        // Hint apenas para ordenação/auditoria — consumo comercial vem dos itens.
        commercialHint: money(cr.amountReceivable),
        sortDate: due,
        sortKey: groupKey,
      });
    } else {
      prev.commercialHint = prev.commercialHint.add(money(cr.amountReceivable));
      if (
        compareIsoDateNullLast(due, prev.sortDate) < 0 ||
        prev.sortDate == null
      ) {
        prev.sortDate = due;
      }
    }
  }

  for (const [key, g] of crGroups) {
    blocks.push({
      key,
      commercialAmount: g.commercialHint.toDecimalPlaces(MONEY_DP, ROUND),
      sortDate: g.sortDate,
      sortKey: g.sortKey,
    });
  }

  return blocks.sort((a, b) => {
    const byDate = compareIsoDateNullLast(a.sortDate, b.sortDate);
    if (byDate !== 0) return byDate;
    return a.sortKey.localeCompare(b.sortKey);
  });
}

export function resolveEffectiveScheduleMaterializationMode(
  input: ResolveMaterializationModeInput
): EffectiveScheduleMaterializationMode {
  const residual = money(input.itemActiveResidualTotal);
  const cut = money(input.cutAmount);
  const canceled = money(input.canceledAmount);
  const unresolved = money(input.unresolvedAmount);
  const hasDelivery = input.deliveryBlockCount > 0;
  const multiPosition = input.originalPositionCount > 1;

  const hasOpenFutureItem = input.itemAmounts.some(
    (i) =>
      i.classification === "PARTIALLY_FULFILLED" ||
      i.classification === "NOT_FULFILLED"
  );
  const hasOnlyUnknownActive =
    !hasOpenFutureItem &&
    unresolved.gt(0) &&
    input.itemAmounts.some((i) => i.classification === "UNKNOWN");

  if (input.hasExplicitManualResidualSchedule && residual.gt(0) && hasDelivery) {
    return "STAGED_MANUAL";
  }

  if (!hasDelivery) {
    if (canceled.gt(0) && residual.lte(0) && cut.lte(0)) return "CANCELED";
    return "NO_MATERIALIZATION";
  }

  if (residual.lte(0)) {
    if (cut.gt(0)) return "CLOSED_WITH_CUT";
    if (canceled.gt(0)) return "CANCELED";
    return "FULL_SUBSTITUTION";
  }

  if (hasOnlyUnknownActive && !hasOpenFutureItem) {
    return "INCONCLUSIVE";
  }

  if (hasDelivery && residual.gt(0) && hasOpenFutureItem && multiPosition) {
    return "STAGED_AUTOMATIC";
  }

  // Parcial com 1 posição (ou demais casos sem staged): proporção legado.
  if (hasDelivery && residual.gt(0)) return "PROPORTIONAL_FALLBACK";
  return "NO_MATERIALIZATION";
}

/**
 * Entrega parcial automática: cada bloco ocupa a próxima posição;
 * residual só nas posições restantes.
 */
export function allocateStagedDeliveryResidual(input: {
  positions: readonly StagedDeliveryPositionInput[];
  deliveryBlocks: readonly StagedDeliveryBlock[];
  residualTotal: Prisma.Decimal | string;
}): AllocateStagedDeliveryResidualResult {
  const residual = money(input.residualTotal);
  const amounts = input.positions.map((p) => money(p.originalAmount));
  const n = amounts.length;
  const empty = {
    residualParts: amounts.map(() => ZERO),
    occupiedPositionIndexes: [] as number[],
    deliveryBlocks: [...input.deliveryBlocks],
    stagedResidualWithoutPosition: ZERO,
  };
  if (n === 0) {
    return { ...empty, stagedResidualWithoutPosition: residual };
  }
  if (residual.lte(0)) {
    return empty;
  }

  const occupiedCount = Math.min(input.deliveryBlocks.length, n);
  const occupiedPositionIndexes = Array.from({ length: occupiedCount }, (_, i) => i);
  const remainingIndexes = Array.from({ length: n }, (_, i) => i).filter(
    (i) => i >= occupiedCount
  );

  if (remainingIndexes.length === 0) {
    return {
      residualParts: amounts.map(() => ZERO),
      occupiedPositionIndexes,
      deliveryBlocks: [...input.deliveryBlocks],
      stagedResidualWithoutPosition: residual,
    };
  }

  const residualParts = allocateResidualAmongPositions(
    amounts,
    remainingIndexes,
    residual
  );

  return {
    residualParts,
    occupiedPositionIndexes,
    deliveryBlocks: [...input.deliveryBlocks],
    stagedResidualWithoutPosition: ZERO,
  };
}

/**
 * Escolhe o vetor de residual por posição conforme o modo FIN-13.
 * `proportionalAllocator` = allocateResidualToOriginalInstallments (legado / fallback).
 */
export function resolveResidualPartsForMaterializationMode(input: {
  mode: EffectiveScheduleMaterializationMode;
  positions: readonly StagedDeliveryPositionInput[];
  deliveryBlocks: readonly StagedDeliveryBlock[];
  residualTotal: Prisma.Decimal;
  proportionalAllocator: (
    originalAmounts: readonly Prisma.Decimal[],
    residualTotal: Prisma.Decimal
  ) => Prisma.Decimal[];
  /** Agenda manual explícita (valores alinhados às posições). */
  manualResidualParts?: readonly Prisma.Decimal[] | null;
}): AllocateStagedDeliveryResidualResult {
  const amounts = input.positions.map((p) => money(p.originalAmount));
  const residual = money(input.residualTotal);

  if (input.mode === "STAGED_MANUAL" && input.manualResidualParts) {
    const parts = amounts.map((_, i) => money(input.manualResidualParts![i] ?? 0));
    return {
      residualParts: parts,
      occupiedPositionIndexes: [],
      deliveryBlocks: [...input.deliveryBlocks],
      stagedResidualWithoutPosition: ZERO,
    };
  }

  if (input.mode === "STAGED_AUTOMATIC") {
    return allocateStagedDeliveryResidual({
      positions: input.positions,
      deliveryBlocks: input.deliveryBlocks,
      residualTotal: residual,
    });
  }

  // NO_MATERIALIZATION / FULL_SUBSTITUTION / CUT / CANCELED / INCONCLUSIVE / fallback:
  // proporção sobre todas as posições (preserva pedidos sem materialização e 1 parcela).
  const residualParts =
    amounts.length > 0
      ? input.proportionalAllocator(amounts, residual)
      : [];

  return {
    residualParts,
    occupiedPositionIndexes: [],
    deliveryBlocks: [...input.deliveryBlocks],
    stagedResidualWithoutPosition: ZERO,
  };
}

export function sortOriginalPositions(
  lines: readonly StagedDeliveryOriginalInstallmentInput[]
): StagedDeliveryPositionInput[] {
  return [...lines]
    .map((line, idx) => ({
      installmentNumber: line.installmentNumber || idx + 1,
      dueDate: line.dueDate,
      originalAmount: money(line.amount),
      _idx: idx,
    }))
    .filter((line) => line.originalAmount.gt(0))
    .sort((a, b) => {
      if (a.installmentNumber !== b.installmentNumber) {
        return a.installmentNumber - b.installmentNumber;
      }
      const byDue = compareIsoDateNullLast(a.dueDate, b.dueDate);
      if (byDue !== 0) return byDue;
      return a._idx - b._idx;
    })
    .map(({ installmentNumber, dueDate, originalAmount }) => ({
      installmentNumber,
      dueDate,
      originalAmount,
    }));
}
