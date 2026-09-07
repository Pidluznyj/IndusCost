/**
 * Vínculo Pedido de Compra Nomus ↔ Contas a Pagar — I/O (Prisma).
 *
 * Número constante de consultas por pedido: vínculos persistidos, documentos
 * de entrada que apontam o pedido, títulos candidatos (uma consulta com OR),
 * vínculos do mesmo título em outros pedidos. Toda a regra vive no motor
 * puro (`nomusPurchaseOrderPayableLink.ts`). Nada é escrito no Nomus.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma.js";
import {
  extractDirectNomusNfeRefs,
  extractPurchaseOrderHeaderFields,
  parsePurchaseOrderPlannedInstallments,
  sumPlannedInstallmentsTotal,
  type ConfirmedPayableSnapshot,
} from "./nomusPurchaseOrder360.js";
import {
  PURCHASE_ORDER_PAYABLE_LINK_HISTORY_ACTIONS,
  PurchaseOrderPayableLinkError,
  buildPurchaseOrderPayableReconciliation,
  isSameSupplier,
  normalizePurchaseOrderPayableLinkReason,
  parseConfirmPayableLinkPayload,
  resolveAutomaticPayableLinks,
  type PayableCandidateRow,
  type PersistedPayableLinkRow,
  type PurchaseOrderLinkIdentity,
  type PurchaseOrderPayableReconciliation,
} from "./nomusPurchaseOrderPayableLink.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type PayableLinkActor = { userId: string | null; userName: string | null };

type DecimalLike = { toString(): string } | null | undefined;

function money(value: DecimalLike): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

const PAYABLE_SELECT = {
  externalId: true,
  companyId: true,
  personId: true,
  personName: true,
  personCnpj: true,
  documentNumber: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  dueDate: true,
  paymentDate: true,
  settlementDate: true,
  amountPayable: true,
  amountPaid: true,
  balancePayable: true,
  paymentMethodId: true,
  paymentMethodName: true,
  bankAccountId: true,
  description: true,
  comments: true,
  classification: true,
  status: true,
  suspendPayment: true,
} as const;

type PayableSelectRow = {
  externalId: number;
  companyId: number | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  documentNumber: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: Date | null;
  paymentDate: Date | null;
  settlementDate: Date | null;
  amountPayable: DecimalLike;
  amountPaid: DecimalLike;
  balancePayable: DecimalLike;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  bankAccountId: number | null;
  description: string | null;
  comments: string | null;
  classification: string | null;
  status: boolean | null;
  suspendPayment: boolean | null;
};

export function toPayableCandidateRow(row: PayableSelectRow): PayableCandidateRow {
  return {
    externalId: row.externalId,
    companyId: row.companyId,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    documentNumber: row.documentNumber,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    dueDate: row.dueDate,
    paymentDate: row.paymentDate,
    settlementDate: row.settlementDate,
    amountPayable: money(row.amountPayable),
    amountPaid: money(row.amountPaid),
    balancePayable: money(row.balancePayable),
    paymentMethodId: row.paymentMethodId,
    paymentMethodName: row.paymentMethodName,
    bankAccountId: row.bankAccountId,
    description: row.description,
    comments: row.comments,
    classification: row.classification,
    nomusStatus: row.status,
    suspendPayment: row.suspendPayment,
  };
}

export function toConfirmedPayableSnapshot(row: PayableCandidateRow): ConfirmedPayableSnapshot {
  return {
    externalId: row.externalId,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate,
    paymentDate: row.paymentDate,
    settlementDate: row.settlementDate,
    amountPayable: row.amountPayable,
    amountPaid: row.amountPaid,
    balancePayable: row.balancePayable,
    paymentMethodName: row.paymentMethodName,
    description: row.description,
    comments: row.comments,
    classification: row.classification,
    nomusStatus: row.nomusStatus,
    suspendPayment: row.suspendPayment,
  };
}

type OrderRow = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierTaxId: string | null;
  rawPayload: unknown;
};

const ORDER_SELECT = {
  id: true,
  externalId: true,
  orderNumber: true,
  supplierExternalId: true,
  supplierTaxId: true,
  rawPayload: true,
} as const;

function identityFromOrder(order: OrderRow): PurchaseOrderLinkIdentity {
  const header = extractPurchaseOrderHeaderFields(order.rawPayload);
  return {
    id: order.id,
    externalId: order.externalId,
    orderNumber: order.orderNumber,
    companyId: typeof header.companyId === "number" ? header.companyId : null,
    supplierExternalId: order.supplierExternalId,
    supplierTaxId: order.supplierTaxId,
  };
}

/** Janela de vencimento em torno das parcelas para a busca de candidatos do fornecedor. */
const CANDIDATE_WINDOW_DAYS = 400;
const CANDIDATE_LIMIT = 500;

function candidateDateWindow(installmentDueDates: Array<Date | null>): { gte: Date; lte: Date } | null {
  const times = installmentDueDates
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  if (times.length === 0) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const day = 86_400_000;
  return { gte: new Date(min - CANDIDATE_WINDOW_DAYS * day), lte: new Date(max + CANDIDATE_WINDOW_DAYS * day) };
}

/** Camada 2: NF-e de documentos de entrada cujo rawJson aponta este pedido. */
async function loadStockDocumentInvoiceIds(db: Db, externalId: number): Promise<number[]> {
  const rows = await db.nomusStockDocument.findMany({
    where: {
      isCancelled: false,
      idNfe: { not: null },
      OR: [
        { rawJson: { path: ["idPedidoCompra"], equals: externalId } },
        { rawJson: { path: ["idPedidoCompra"], equals: String(externalId) } },
        { rawJson: { path: ["idPedido"], equals: externalId } },
        { rawJson: { path: ["pedidoCompraId"], equals: externalId } },
      ],
    },
    select: { idNfe: true },
    take: 200,
  });
  return [...new Set(rows.map((row) => row.idNfe).filter((id): id is number => id != null))];
}

export type PurchaseOrderPayableContext = {
  order: OrderRow;
  identity: PurchaseOrderLinkIdentity;
  installments: ReturnType<typeof parsePurchaseOrderPlannedInstallments>;
  plannedInstallmentsTotal: number | null;
  payables: PayableCandidateRow[];
  persisted: PersistedPayableLinkRow[];
  automatic: ReturnType<typeof resolveAutomaticPayableLinks>;
  linkedElsewherePayableIds: number[];
};

export async function loadPurchaseOrderPayableContext(
  db: Db,
  order: OrderRow
): Promise<PurchaseOrderPayableContext> {
  const identity = identityFromOrder(order);
  const installments = parsePurchaseOrderPlannedInstallments(order.rawPayload);
  const directInvoiceIds = extractDirectNomusNfeRefs(order.rawPayload).map((ref) => ref.externalId);

  const [persistedRows, stockDocumentInvoiceIds] = await Promise.all([
    db.nomusPurchaseOrderPayableLink.findMany({
      where: { nomusPurchaseOrderId: order.id },
      orderBy: { createdAt: "asc" },
    }),
    loadStockDocumentInvoiceIds(db, order.externalId),
  ]);

  const invoiceIds = [...new Set([...directInvoiceIds, ...stockDocumentInvoiceIds])];
  const persistedIds = persistedRows.map((row) => row.payableExternalId);
  const window = candidateDateWindow(installments.map((row) => row.dueDate));
  const documentKeys = [order.orderNumber, String(order.externalId)].filter(
    (value): value is string => !!value && value.trim().length > 0
  );

  const or: Prisma.NomusAccountsPayableWhereInput[] = [];
  if (invoiceIds.length) or.push({ sourceInvoiceId: { in: invoiceIds } });
  if (persistedIds.length) or.push({ externalId: { in: persistedIds } });
  if (order.supplierExternalId != null) {
    or.push({
      personId: order.supplierExternalId,
      ...(window ? { dueDate: { gte: window.gte, lte: window.lte } } : {}),
    });
    or.push({ personId: order.supplierExternalId, documentNumber: { in: documentKeys } });
  }

  const payableRows = or.length
    ? await db.nomusAccountsPayable.findMany({
        where: { OR: or },
        select: PAYABLE_SELECT,
        orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
        take: CANDIDATE_LIMIT,
      })
    : [];
  const payables = payableRows.map(toPayableCandidateRow);

  const payableIds = payables.map((row) => row.externalId);
  const elsewhere = payableIds.length
    ? await db.nomusPurchaseOrderPayableLink.findMany({
        where: { payableExternalId: { in: payableIds }, nomusPurchaseOrderId: { not: order.id } },
        select: { payableExternalId: true },
      })
    : [];

  const automatic = resolveAutomaticPayableLinks({
    order: identity,
    payables,
    directInvoiceIds,
    stockDocumentInvoiceIds,
  });

  return {
    order,
    identity,
    installments,
    plannedInstallmentsTotal: sumPlannedInstallmentsTotal(installments),
    payables,
    persisted: persistedRows,
    automatic,
    linkedElsewherePayableIds: [...new Set(elsewhere.map((row) => row.payableExternalId))],
  };
}

async function findOrderOrThrow(db: Db, orderId: string): Promise<OrderRow> {
  const order = await db.nomusPurchaseOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) {
    throw new PurchaseOrderPayableLinkError(
      "PURCHASE_ORDER_NOT_FOUND",
      "Pedido de compra Nomus não encontrado.",
      404
    );
  }
  return order;
}

export async function buildPurchaseOrderPayableReconciliationForOrder(
  orderId: string,
  options: { db?: Db; now?: Date } = {}
): Promise<PurchaseOrderPayableReconciliation> {
  const db = options.db ?? defaultPrisma;
  const order = await findOrderOrThrow(db, orderId);
  const context = await loadPurchaseOrderPayableContext(db, order);
  return buildPurchaseOrderPayableReconciliation({
    order: context.identity,
    installments: context.installments,
    plannedInstallmentsTotal: context.plannedInstallmentsTotal,
    payables: context.payables,
    automatic: context.automatic,
    persisted: context.persisted,
    linkedElsewherePayableIds: context.linkedElsewherePayableIds,
    now: options.now,
  });
}

export async function confirmPurchaseOrderPayableLink(
  orderId: string,
  actor: PayableLinkActor,
  body: Record<string, unknown>,
  options: { db?: PrismaClient; now?: Date } = {}
): Promise<PurchaseOrderPayableReconciliation> {
  const db = options.db ?? defaultPrisma;
  const order = await findOrderOrThrow(db, orderId);
  const context = await loadPurchaseOrderPayableContext(db, order);
  const payload = parseConfirmPayableLinkPayload(body, { installmentCount: context.installments.length });

  const payable = context.payables.find((row) => row.externalId === payload.payableExternalId);
  if (!payable) {
    // Título fora dos candidatos do pedido: pode existir no espelho, mas não pertence ao fornecedor.
    const exists = await db.nomusAccountsPayable.findUnique({
      where: { externalId: payload.payableExternalId },
      select: PAYABLE_SELECT,
    });
    if (!exists) {
      throw new PurchaseOrderPayableLinkError(
        "PAYABLE_NOT_FOUND",
        "Título de Contas a Pagar não encontrado no espelho.",
        404,
        "payableExternalId"
      );
    }
    if (!isSameSupplier(context.identity, toPayableCandidateRow(exists))) {
      throw new PurchaseOrderPayableLinkError(
        "PAYABLE_SUPPLIER_MISMATCH",
        "O título pertence a outro fornecedor. Só é possível vincular títulos do mesmo fornecedor do pedido.",
        409,
        "payableExternalId"
      );
    }
    throw new PurchaseOrderPayableLinkError(
      "PAYABLE_OUT_OF_WINDOW",
      "O título está fora da janela de vencimento das parcelas deste pedido.",
      409,
      "payableExternalId"
    );
  }
  if (!isSameSupplier(context.identity, payable)) {
    throw new PurchaseOrderPayableLinkError(
      "PAYABLE_SUPPLIER_MISMATCH",
      "O título pertence a outro fornecedor. Só é possível vincular títulos do mesmo fornecedor do pedido.",
      409,
      "payableExternalId"
    );
  }

  if (payload.method === "INSTALLMENT_MATCH") {
    // A confirmação por parcela só vale para uma sugestão que o motor realmente produziu.
    const reconciliation = buildPurchaseOrderPayableReconciliation({
      order: context.identity,
      installments: context.installments,
      plannedInstallmentsTotal: context.plannedInstallmentsTotal,
      payables: context.payables,
      automatic: context.automatic,
      persisted: context.persisted,
      linkedElsewherePayableIds: context.linkedElsewherePayableIds,
      now: options.now,
    });
    const suggestion = reconciliation.suggestions.find(
      (row) =>
        row.payableExternalId === payload.payableExternalId &&
        row.installmentIndex === payload.installmentIndex
    );
    if (!suggestion) {
      throw new PurchaseOrderPayableLinkError(
        "SUGGESTION_NOT_FOUND",
        "Esta combinação parcela × título não é uma sugestão válida do sistema. Use o vínculo manual com motivo.",
        409
      );
    }
  }

  const evidence =
    payload.method === "INSTALLMENT_MATCH"
      ? `Parcela conferida: fornecedor, empresa, valor e vencimento iguais (título ${payload.payableExternalId}).`
      : `Vínculo manual confirmado por ${actor.userName ?? actor.userId ?? "usuário"}.`;

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.nomusPurchaseOrderPayableLink.create({
        data: {
          nomusPurchaseOrderId: order.id,
          payableExternalId: payload.payableExternalId,
          installmentIndex: payload.installmentIndex,
          method: payload.method,
          confidence: "CONFIRMED",
          evidence,
          reason: payload.reason,
          createdByUserId: actor.userId,
          createdByUserName: actor.userName,
        },
      });
      await tx.nomusPurchaseOrderPayableLinkHistory.create({
        data: {
          linkId: created.id,
          nomusPurchaseOrderId: order.id,
          payableExternalId: payload.payableExternalId,
          action: PURCHASE_ORDER_PAYABLE_LINK_HISTORY_ACTIONS.linked,
          reason: payload.reason,
          detailsJson: {
            method: payload.method,
            installmentIndex: payload.installmentIndex,
            evidence,
            payable: {
              dueDate: payable.dueDate?.toISOString() ?? null,
              amountPayable: payable.amountPayable,
              documentNumber: payable.documentNumber,
              sourceInvoiceId: payable.sourceInvoiceId,
            },
          },
          userId: actor.userId,
          userName: actor.userName,
        },
      });
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new PurchaseOrderPayableLinkError(
        "PAYABLE_ALREADY_LINKED",
        "Este título já está vinculado a este pedido.",
        409,
        "payableExternalId"
      );
    }
    throw error;
  }

  return buildPurchaseOrderPayableReconciliationForOrder(order.id, { db, now: options.now });
}

export async function removePurchaseOrderPayableLink(
  orderId: string,
  payableExternalId: number,
  actor: PayableLinkActor,
  body: Record<string, unknown>,
  options: { db?: PrismaClient; now?: Date } = {}
): Promise<PurchaseOrderPayableReconciliation> {
  const db = options.db ?? defaultPrisma;
  const order = await findOrderOrThrow(db, orderId);
  const reason = normalizePurchaseOrderPayableLinkReason(body.reason, true);

  const link = await db.nomusPurchaseOrderPayableLink.findUnique({
    where: { nomusPurchaseOrderId_payableExternalId: { nomusPurchaseOrderId: order.id, payableExternalId } },
  });
  if (!link) {
    throw new PurchaseOrderPayableLinkError(
      "PAYABLE_LINK_NOT_FOUND",
      "Vínculo não encontrado. Vínculos automáticos por NF-e não podem ser removidos aqui.",
      404
    );
  }

  await db.$transaction(async (tx) => {
    await tx.nomusPurchaseOrderPayableLink.delete({ where: { id: link.id } });
    await tx.nomusPurchaseOrderPayableLinkHistory.create({
      data: {
        linkId: link.id,
        nomusPurchaseOrderId: order.id,
        payableExternalId,
        action: PURCHASE_ORDER_PAYABLE_LINK_HISTORY_ACTIONS.unlinked,
        reason,
        detailsJson: {
          method: link.method,
          installmentIndex: link.installmentIndex,
          evidence: link.evidence,
          linkedByUserName: link.createdByUserName,
          linkedAt: link.createdAt.toISOString(),
        },
        userId: actor.userId,
        userName: actor.userName,
      },
    });
  });

  return buildPurchaseOrderPayableReconciliationForOrder(order.id, { db, now: options.now });
}

/**
 * Lote para a listagem: títulos vinculados por CONFIRMAÇÃO humana (os automáticos
 * por NF-e a lista já resolve). Uma consulta de vínculos + uma de títulos.
 */
export async function loadConfirmedPayableSnapshotsByOrder(
  orderIds: readonly string[],
  options: { db?: Db } = {}
): Promise<Map<string, ConfirmedPayableSnapshot[]>> {
  const db = options.db ?? defaultPrisma;
  const result = new Map<string, ConfirmedPayableSnapshot[]>();
  if (orderIds.length === 0) return result;
  const links = await db.nomusPurchaseOrderPayableLink.findMany({
    where: { nomusPurchaseOrderId: { in: [...orderIds] } },
    select: { nomusPurchaseOrderId: true, payableExternalId: true },
  });
  if (links.length === 0) return result;
  const payableIds = [...new Set(links.map((row) => row.payableExternalId))];
  const payables = await db.nomusAccountsPayable.findMany({
    where: { externalId: { in: payableIds } },
    select: PAYABLE_SELECT,
  });
  const byId = new Map(payables.map((row) => [row.externalId, toConfirmedPayableSnapshot(toPayableCandidateRow(row))]));
  for (const link of links) {
    const snapshot = byId.get(link.payableExternalId);
    if (!snapshot) continue;
    const list = result.get(link.nomusPurchaseOrderId) ?? [];
    list.push(snapshot);
    result.set(link.nomusPurchaseOrderId, list);
  }
  return result;
}

export function mapPayableLinkError(error: unknown): { status: number; body: { error: string; code: string; field?: string } } {
  if (error instanceof PurchaseOrderPayableLinkError) {
    return {
      status: error.httpStatus,
      body: { error: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) },
    };
  }
  console.error("purchase-order-payable-link error:", error);
  return {
    status: 500,
    body: { error: "Erro ao processar o vínculo do pedido com Contas a Pagar.", code: "PURCHASE_ORDER_PAYABLE_LINK_UNEXPECTED_ERROR" },
  };
}
