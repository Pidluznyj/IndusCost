/**
 * Hashes e helpers puros para snapshots de comissão na venda (idempotência).
 */
import { createHash } from "node:crypto";
import { roundMoney } from "./commission-money.js";
import type { CommissionOrderItemCalculationResult } from "./commissionOrderCalculation.js";

export type CommissionOrderItemSnapshotStatusValue =
  CommissionOrderItemCalculationResult["status"] | "ERROR";

export type CommissionOrderSnapshotHashInput = {
  salesOrderId: string;
  nfeId: number | null;
  saleDate: string;
  rawSellerId: number | null;
  canonicalSellerId: string | null;
  items: CommissionOrderItemSnapshotHashInput[];
};

export type CommissionOrderItemSnapshotHashInput = {
  salesOrderItemId: string;
  productId: string;
  soldAmount: number;
  marginPercent: number | null;
  commissionRatePercent: number;
  grossCommissionAmount: number;
  finalCommissionAmount: number;
  ruleId: string | null;
  status: CommissionOrderItemSnapshotStatusValue;
};

function hashPayload(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => (part == null ? "" : String(part))).join("|"))
    .digest("hex");
}

function normalizeMoney(value: number): number {
  return roundMoney(value);
}

function normalizeRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Math.round(value * 10000) / 10000);
}

/** Hash idempotente por linha de item (pedido + NF + item + valores calculados). */
export function buildCommissionOrderItemSnapshotSourceHash(input: {
  salesOrderId: string;
  nfeId: number | null;
  salesOrderItemId: string;
  productId: string;
  soldAmount: number;
  marginPercent: number | null;
  commissionRatePercent: number;
  grossCommissionAmount: number;
  finalCommissionAmount: number;
  ruleId: string | null;
  status: CommissionOrderItemSnapshotStatusValue;
}): string {
  return hashPayload([
    "item",
    input.salesOrderId,
    input.nfeId,
    input.salesOrderItemId,
    input.productId,
    normalizeMoney(input.soldAmount),
    normalizeRate(input.marginPercent),
    normalizeRate(input.commissionRatePercent),
    normalizeMoney(input.grossCommissionAmount),
    normalizeMoney(input.finalCommissionAmount),
    input.ruleId,
    input.status,
  ]);
}

/** Hash idempotente do cabeçalho do pedido/NF (agrega hashes dos itens). */
export function buildCommissionOrderSnapshotSourceHash(
  input: CommissionOrderSnapshotHashInput
): string {
  const itemHashes = input.items
    .map((item) =>
      buildCommissionOrderItemSnapshotSourceHash({
        salesOrderId: input.salesOrderId,
        nfeId: input.nfeId,
        salesOrderItemId: item.salesOrderItemId,
        productId: item.productId,
        soldAmount: item.soldAmount,
        marginPercent: item.marginPercent,
        commissionRatePercent: item.commissionRatePercent,
        grossCommissionAmount: item.grossCommissionAmount,
        finalCommissionAmount: item.finalCommissionAmount,
        ruleId: item.ruleId,
        status: item.status,
      })
    )
    .sort();

  return hashPayload([
    "order",
    input.salesOrderId,
    input.nfeId,
    input.saleDate,
    input.rawSellerId,
    input.canonicalSellerId,
    itemHashes.join(","),
  ]);
}

export function mapCalculationResultToItemHashInput(
  line: CommissionOrderItemCalculationResult
): CommissionOrderItemSnapshotHashInput {
  return {
    salesOrderItemId: line.itemId,
    productId: line.productId,
    soldAmount: line.soldAmount,
    marginPercent: line.marginPercent,
    commissionRatePercent: line.commissionRatePercent,
    grossCommissionAmount: line.grossCommissionAmount,
    finalCommissionAmount: line.netCommissionAmount,
    ruleId: line.ruleId,
    status: line.status,
  };
}

export function aggregateOrderSnapshotTotals(
  items: Array<Pick<CommissionOrderItemSnapshotHashInput, "soldAmount" | "grossCommissionAmount" | "finalCommissionAmount">>
): {
  totalSoldAmount: number;
  totalGrossCommissionAmount: number;
  totalFinalCommissionAmount: number;
} {
  return items.reduce(
    (acc, item) => {
      acc.totalSoldAmount = roundMoney(acc.totalSoldAmount + item.soldAmount);
      acc.totalGrossCommissionAmount = roundMoney(
        acc.totalGrossCommissionAmount + item.grossCommissionAmount
      );
      acc.totalFinalCommissionAmount = roundMoney(
        acc.totalFinalCommissionAmount + item.finalCommissionAmount
      );
      return acc;
    },
    {
      totalSoldAmount: 0,
      totalGrossCommissionAmount: 0,
      totalFinalCommissionAmount: 0,
    }
  );
}

export function toCommissionOrderItemSnapshotStatus(
  status: CommissionOrderItemCalculationResult["status"]
): CommissionOrderItemSnapshotStatusValue {
  return status;
}
