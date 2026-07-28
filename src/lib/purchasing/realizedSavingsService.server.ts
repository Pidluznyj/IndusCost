/**
 * Serviço de comparação ganho negociado × realizado (OP-24).
 * Read-only sobre PC + recebimentos confirmados + evidências.
 */
import type { PrismaClient } from "@prisma/client";
import {
  computeSavingsComparison,
  type SavingsComparisonLineInput,
} from "./realizedSavingsEngine.js";
import { PurchaseOrderWorkflowError } from "./purchaseOrderWorkflow.js";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function buildPurchaseOrderSavingsComparison(
  prisma: PrismaClient,
  purchaseOrderId: string
) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      items: { orderBy: { lineNumber: "asc" } },
      receipts: {
        where: { status: { in: ["APROVADO", "ESTORNADO"] } },
        include: { items: true },
      },
    },
  });
  if (!po) {
    throw new PurchaseOrderWorkflowError("Pedido de compra não encontrado.", "NOT_FOUND");
  }

  const receiptIds = po.receipts.map((r) => r.id);
  const evidenceCount = await prisma.purchaseEvidence.count({
    where: {
      deletedAt: null,
      OR: [
        { entityType: "PURCHASE_ORDER", entityId: po.id },
        ...(receiptIds.length
          ? [{ entityType: "RECEIPT" as const, entityId: { in: receiptIds } }]
          : []),
      ],
    },
  });

  // Aceite confirmado: só APROVADO; ESTORNADO não conta como realizado.
  const acceptedByItem = new Map<
    string,
    { qty: number; costSum: number; freight: number; taxes: number; expenses: number; discounts: number }
  >();

  for (const receipt of po.receipts) {
    if (receipt.status !== "APROVADO") continue;
    const acceptedQtyHeader = receipt.items.reduce((s, i) => s + num(i.quantityAccepted), 0);
    for (const item of receipt.items) {
      const qty = num(item.quantityAccepted);
      if (qty <= 0) continue;
      const unit = numOrNull(item.effectiveUnitCost) ?? numOrNull(item.unitCostSnapshot) ?? 0;
      const share = acceptedQtyHeader > 0 ? qty / acceptedQtyHeader : 0;
      const freightShare = num(receipt.freightValueActual) * share;
      const expensesShare = num(receipt.expensesActual) * share;
      const prev = acceptedByItem.get(item.purchaseOrderItemId) ?? {
        qty: 0,
        costSum: 0,
        freight: 0,
        taxes: 0,
        expenses: 0,
        discounts: 0,
      };
      acceptedByItem.set(item.purchaseOrderItemId, {
        qty: prev.qty + qty,
        costSum: prev.costSum + unit * qty,
        freight: prev.freight + freightShare,
        taxes: prev.taxes,
        expenses: prev.expenses + expensesShare,
        discounts: prev.discounts,
      });
    }
  }

  const lines: SavingsComparisonLineInput[] = po.items.map((item) => {
    const acc = acceptedByItem.get(item.id);
    const qtyAccepted = acc?.qty ?? 0;
    const receivedUnitCost =
      qtyAccepted > 0 && acc ? acc.costSum / qtyAccepted : null;
    return {
      purchaseOrderItemId: item.id,
      description: item.description,
      quantityOrdered: num(item.quantityOrdered),
      initialUnitPrice: numOrNull(item.initialUnitPriceSnapshot),
      orderUnitPrice: num(item.unitPriceSnapshot),
      orderFreight: num(item.freightValueSnapshot),
      orderTaxes: num(item.nonRecoverableTaxesSnapshot),
      orderExpenses: 0,
      orderDiscounts: num(item.discountsSnapshot),
      quantityAcceptedConfirmed: qtyAccepted,
      receivedUnitCost,
      receivedFreight: acc?.freight ?? 0,
      receivedTaxes: acc?.taxes ?? 0,
      receivedExpenses: acc?.expenses ?? 0,
      receivedDiscounts: acc?.discounts ?? 0,
    };
  });

  const comparison = computeSavingsComparison({
    currency: po.currency,
    initialComparableTotalSnapshot: numOrNull(po.initialComparableTotalSnapshot),
    negotiatedComparableTotalSnapshot: numOrNull(po.negotiatedComparableTotalSnapshot),
    totalGainSnapshot: numOrNull(po.totalGainSnapshot),
    orderFreightHeader: num(po.freightValueSnapshot),
    orderTaxesHeader: num(po.nonRecoverableTaxesSnapshot),
    orderExpensesHeader: 0,
    orderDiscountsHeader: num(po.discountsSnapshot),
    freightIncoterm: po.deliveryTermsSnapshot,
    evidenceCount,
    lines,
  });

  return {
    purchaseOrder: {
      id: po.id,
      code: po.code,
      status: po.status,
      supplierName: po.supplierDisplayNameSnapshot,
      currency: po.currency,
    },
    comparison,
    meta: {
      ...comparison.meta,
      createsAccountsPayable: false,
      writesNomusStock: false,
      updatesPublishedCost: false,
      doesNotMutateNegotiationHistory: true,
    },
  };
}
