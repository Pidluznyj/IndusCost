/**
 * Vínculo Pedido de Compra Nomus ↔ Contas a Pagar — I/O (Prisma).
 *
 * Número constante de consultas por pedido: vínculos persistidos, documentos
 * de entrada que apontam o pedido, títulos candidatos (uma consulta com OR),
 * dono financeiro dos mesmos títulos (vínculos confirmados de qualquer pedido +
 * busca reversa, em lote, das evidências automáticas de outros pedidos).
 * Toda a regra vive no motor puro (`nomusPurchaseOrderPayableLink.ts` e
 * `nomusPurchaseOrderPayableOwnership.ts`). Nada é escrito no Nomus.
 *
 * CARDINALIDADE FINANCEIRA V1: `payableExternalId` é ÚNICO na tabela de
 * vínculos (migration 20260925120000). A pré-checagem de dono acontece aqui,
 * mas o banco é a autoridade final na corrida: a violação P2002 vira 409 de
 * domínio, nunca 500.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma.js";
import {
  extractDirectNomusNfeRefs,
  extractDocumentEntryPurchaseOrderId,
  extractPurchaseOrderHeaderFields,
  parsePurchaseOrderPlannedInstallments,
  sumPlannedInstallmentsTotal,
  type ConfirmedPayableSnapshot,
} from "./nomusPurchaseOrder360.js";
import {
  PURCHASE_ORDER_PAYABLE_LINK_HISTORY_ACTIONS,
  PURCHASE_ORDER_PAYABLE_OWNER_ERROR_CODES,
  PurchaseOrderPayableLinkError,
  assertPayableFinancialOwnerAvailable,
  buildPurchaseOrderPayableReconciliation,
  isSameSupplier,
  normalizeDocumentNumber,
  normalizePurchaseOrderPayableLinkReason,
  parseConfirmPayableLinkPayload,
  resolveAutomaticPayableLinks,
  type AutomaticLinkPayableRef,
  type PayableCandidateRow,
  type PersistedPayableLinkRow,
  type PurchaseOrderLinkIdentity,
  type PurchaseOrderPayableReconciliation,
} from "./nomusPurchaseOrderPayableLink.js";
import {
  resolvePayableFinancialOwnership,
  type PayableFinancialOwnership,
  type PayableOwnershipClaim,
} from "./nomusPurchaseOrderPayableOwnership.js";

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
    documentNumber: row.documentNumber,
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

/* ------------------------------------------------------------------ *
 * Dono financeiro — resolução em lote (aba, listagem e 360 usam a mesma)
 * ------------------------------------------------------------------ */

/** Campos mínimos de um título para resolver seu dono financeiro. */
export type OwnershipPayableRef = AutomaticLinkPayableRef;

export type PayableOwnershipResolution = {
  ownership: Map<number, PayableFinancialOwnership>;
  /** Números dos pedidos envolvidos (para nomear o pedido dono na UI/erro). */
  orderNumbersById: Map<string, string | null>;
  /** Vínculos persistidos ATIVOS dos títulos analisados (qualquer pedido). */
  confirmedLinks: Array<{ nomusPurchaseOrderId: string; payableExternalId: number }>;
};

/** Lote de NF-e por consulta de busca reversa (limita o tamanho do OR no Postgres). */
const REVERSE_LOOKUP_INVOICE_CHUNK = 100;
const REVERSE_LOOKUP_ORDER_LIMIT = 1000;
const REVERSE_LOOKUP_STOCK_DOCUMENT_LIMIT = 2000;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Busca reversa das evidências automáticas: quais pedidos (de QUALQUER página)
 * reivindicam algum destes títulos pelas camadas 1–3? Set-based e em lote:
 *
 *  - camada 1: pedidos cujo `rawPayload.nfes[].id` é uma NF-e dos títulos
 *    (filtro JSON `array_contains`, id numérico ou texto — mesma tolerância da
 *    camada 2 direta);
 *  - camada 2: documentos de entrada com `idNfe` dos títulos → pedido apontado
 *    em `idPedidoCompra`;
 *  - camada 3: pedidos cujo número/ID é o `documentNumber` do título.
 *
 * Escopo: pedidos do mesmo fornecedor dos títulos (ou sem fornecedor informado)
 * — NF-e e número de pedido pertencem ao fornecedor. A decisão final por
 * título usa o MESMO `resolveAutomaticPayableLinks` do caminho direto, com o
 * rawPayload real de cada pedido encontrado (paridade de regra, sem N+1).
 */
export async function loadAutomaticPayableClaimsAcrossOrders(
  db: Db,
  payables: readonly OwnershipPayableRef[],
  options: { orderNumbersById?: Map<string, string | null> } = {}
): Promise<PayableOwnershipClaim[]> {
  if (payables.length === 0) return [];
  const invoiceIds = [...new Set(payables.map((row) => row.sourceInvoiceId).filter((id): id is number => id != null))];
  const personIds = [...new Set(payables.map((row) => row.personId).filter((id): id is number => id != null))];
  const documentNumbers = [
    ...new Set(
      payables
        .map((row) => row.documentNumber?.trim() ?? "")
        .filter((value) => value.length > 0)
        .flatMap((value) => [value, value.toUpperCase()])
    ),
  ];
  const documentExternalIds = [
    ...new Set(
      payables
        .map((row) => normalizeDocumentNumber(row.documentNumber))
        .filter((key) => /^\d+$/.test(key))
        .map((key) => Number.parseInt(key, 10))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    ),
  ];

  const supplierClause: Prisma.NomusPurchaseOrderWhereInput = {
    OR: [...(personIds.length ? [{ supplierExternalId: { in: personIds } }] : []), { supplierExternalId: null }],
  };

  const orderQueries: Array<Promise<OrderRow[]>> = [];
  for (const ids of chunk(invoiceIds, REVERSE_LOOKUP_INVOICE_CHUNK)) {
    orderQueries.push(
      db.nomusPurchaseOrder.findMany({
        where: {
          AND: [
            supplierClause,
            {
              OR: ids.flatMap((id) => [
                { rawPayload: { path: ["nfes"], array_contains: [{ id }] } },
                { rawPayload: { path: ["nfes"], array_contains: [{ id: String(id) }] } },
              ]),
            },
          ],
        },
        select: ORDER_SELECT,
        take: REVERSE_LOOKUP_ORDER_LIMIT,
      })
    );
  }
  if (documentNumbers.length || documentExternalIds.length) {
    orderQueries.push(
      db.nomusPurchaseOrder.findMany({
        where: {
          AND: [
            supplierClause,
            {
              OR: [
                ...(documentNumbers.length ? [{ orderNumber: { in: documentNumbers } }] : []),
                ...(documentExternalIds.length ? [{ externalId: { in: documentExternalIds } }] : []),
              ],
            },
          ],
        },
        select: ORDER_SELECT,
        take: REVERSE_LOOKUP_ORDER_LIMIT,
      })
    );
  }

  const [orderBatches, stockDocuments] = await Promise.all([
    Promise.all(orderQueries),
    invoiceIds.length
      ? db.nomusStockDocument.findMany({
          where: { isCancelled: false, idNfe: { in: invoiceIds } },
          select: { idNfe: true, rawJson: true },
          take: REVERSE_LOOKUP_STOCK_DOCUMENT_LIMIT,
        })
      : Promise.resolve([] as Array<{ idNfe: number | null; rawJson: unknown }>),
  ]);

  const ordersById = new Map<string, OrderRow>();
  for (const batch of orderBatches) for (const row of batch) ordersById.set(row.id, row);

  const stockInvoiceIdsByOrderExternalId = new Map<number, Set<number>>();
  for (const doc of stockDocuments) {
    const purchaseOrderExternalId = extractDocumentEntryPurchaseOrderId(doc.rawJson);
    if (purchaseOrderExternalId == null || doc.idNfe == null) continue;
    const set = stockInvoiceIdsByOrderExternalId.get(purchaseOrderExternalId) ?? new Set<number>();
    set.add(doc.idNfe);
    stockInvoiceIdsByOrderExternalId.set(purchaseOrderExternalId, set);
  }
  const loadedExternalIds = new Set([...ordersById.values()].map((row) => row.externalId));
  const missingExternalIds = [...stockInvoiceIdsByOrderExternalId.keys()].filter((id) => !loadedExternalIds.has(id));
  if (missingExternalIds.length) {
    const rows = await db.nomusPurchaseOrder.findMany({
      where: { externalId: { in: missingExternalIds } },
      select: ORDER_SELECT,
      take: REVERSE_LOOKUP_ORDER_LIMIT,
    });
    for (const row of rows) ordersById.set(row.id, row);
  }

  const claims: PayableOwnershipClaim[] = [];
  for (const order of ordersById.values()) {
    options.orderNumbersById?.set(order.id, order.orderNumber);
    const identity = identityFromOrder(order);
    const resolved = resolveAutomaticPayableLinks({
      order: identity,
      payables,
      directInvoiceIds: extractDirectNomusNfeRefs(order.rawPayload).map((ref) => ref.externalId),
      stockDocumentInvoiceIds: [...(stockInvoiceIdsByOrderExternalId.get(order.externalId) ?? [])],
    });
    for (const link of resolved) {
      claims.push({
        nomusPurchaseOrderId: order.id,
        payableExternalId: link.payableExternalId,
        source: "AUTOMATIC",
        method: link.method,
      });
    }
  }
  return claims;
}

/**
 * Autoridade única de dono financeiro para um conjunto de títulos: vínculos
 * confirmados de QUALQUER pedido (1 consulta) + evidências automáticas de
 * QUALQUER pedido (busca reversa em lote) + evidências já conhecidas pelo
 * chamador → `resolvePayableFinancialOwnership`. Usada pela aba Financeiro,
 * pela listagem de Pedidos Nomus e pela ficha 360 — nunca uma regra em cada.
 */
export async function resolvePayableOwnershipAcrossOrders(
  db: Db,
  input: { payables: readonly OwnershipPayableRef[]; knownClaims?: readonly PayableOwnershipClaim[] }
): Promise<PayableOwnershipResolution> {
  const orderNumbersById = new Map<string, string | null>();
  const payableIds = [...new Set(input.payables.map((row) => row.externalId))];
  if (payableIds.length === 0) {
    return { ownership: new Map(), orderNumbersById, confirmedLinks: [] };
  }

  const [confirmedRows, automaticClaims] = await Promise.all([
    db.nomusPurchaseOrderPayableLink.findMany({
      where: { payableExternalId: { in: payableIds } },
      select: {
        payableExternalId: true,
        nomusPurchaseOrderId: true,
        nomusPurchaseOrder: { select: { orderNumber: true } },
      },
    }),
    loadAutomaticPayableClaimsAcrossOrders(db, input.payables, { orderNumbersById }),
  ]);

  const confirmedLinks = confirmedRows.map((row) => ({
    nomusPurchaseOrderId: row.nomusPurchaseOrderId,
    payableExternalId: row.payableExternalId,
  }));
  for (const row of confirmedRows) {
    if (!orderNumbersById.has(row.nomusPurchaseOrderId)) {
      orderNumbersById.set(row.nomusPurchaseOrderId, row.nomusPurchaseOrder?.orderNumber ?? null);
    }
  }

  const claims: PayableOwnershipClaim[] = [
    ...confirmedLinks.map((row) => ({ ...row, source: "CONFIRMED" as const })),
    ...automaticClaims,
    ...(input.knownClaims ?? []),
  ];
  return { ownership: resolvePayableFinancialOwnership(claims), orderNumbersById, confirmedLinks };
}

/* ------------------------------------------------------------------ *
 * Contexto do pedido (aba Financeiro)
 * ------------------------------------------------------------------ */

export type PurchaseOrderPayableContext = {
  order: OrderRow;
  identity: PurchaseOrderLinkIdentity;
  installments: ReturnType<typeof parsePurchaseOrderPlannedInstallments>;
  plannedInstallmentsTotal: number | null;
  payables: PayableCandidateRow[];
  persisted: PersistedPayableLinkRow[];
  automatic: ReturnType<typeof resolveAutomaticPayableLinks>;
  /** Títulos com vínculo CONFIRMADO em outro pedido (compatibilidade de payload). */
  linkedElsewherePayableIds: number[];
  ownership: Map<number, PayableFinancialOwnership>;
  orderNumbersById: Map<string, string | null>;
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

  const automatic = resolveAutomaticPayableLinks({
    order: identity,
    payables,
    directInvoiceIds,
    stockDocumentInvoiceIds,
  });

  // Dono financeiro de cada candidato — mesma autoridade da listagem e do 360.
  const knownClaims: PayableOwnershipClaim[] = [
    ...persistedRows.map((row) => ({
      nomusPurchaseOrderId: order.id,
      payableExternalId: row.payableExternalId,
      source: "CONFIRMED" as const,
      method: row.method,
    })),
    ...automatic.map((row) => ({
      nomusPurchaseOrderId: order.id,
      payableExternalId: row.payableExternalId,
      source: "AUTOMATIC" as const,
      method: row.method,
    })),
  ];
  const resolution = await resolvePayableOwnershipAcrossOrders(db, { payables, knownClaims });
  resolution.orderNumbersById.set(order.id, order.orderNumber);

  const linkedElsewherePayableIds = [
    ...new Set(
      resolution.confirmedLinks
        .filter((row) => row.nomusPurchaseOrderId !== order.id)
        .map((row) => row.payableExternalId)
    ),
  ];

  return {
    order,
    identity,
    installments,
    plannedInstallmentsTotal: sumPlannedInstallmentsTotal(installments),
    payables,
    persisted: persistedRows,
    automatic,
    linkedElsewherePayableIds,
    ownership: resolution.ownership,
    orderNumbersById: resolution.orderNumbersById,
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

function reconciliationFromContext(
  context: PurchaseOrderPayableContext,
  now: Date | undefined
): PurchaseOrderPayableReconciliation {
  return buildPurchaseOrderPayableReconciliation({
    order: context.identity,
    installments: context.installments,
    plannedInstallmentsTotal: context.plannedInstallmentsTotal,
    payables: context.payables,
    automatic: context.automatic,
    persisted: context.persisted,
    linkedElsewherePayableIds: context.linkedElsewherePayableIds,
    ownership: context.ownership,
    orderNumbersById: context.orderNumbersById,
    now,
  });
}

export async function buildPurchaseOrderPayableReconciliationForOrder(
  orderId: string,
  options: { db?: Db; now?: Date } = {}
): Promise<PurchaseOrderPayableReconciliation> {
  const db = options.db ?? defaultPrisma;
  const order = await findOrderOrThrow(db, orderId);
  const context = await loadPurchaseOrderPayableContext(db, order);
  return reconciliationFromContext(context, options.now);
}

/* ------------------------------------------------------------------ *
 * Confirmação — todas as formas (sugestão, INSTALLMENT_MATCH, manual, POST direto)
 * ------------------------------------------------------------------ */

function isPrismaUniqueViolation(error: unknown): error is { code: "P2002"; meta?: { target?: unknown } } {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2002";
}

/** Colunas do índice violado, quando o Prisma informa `meta.target` (array ou texto). */
function uniqueViolationTarget(error: { meta?: { target?: unknown } }): string[] | null {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map((value) => String(value));
  if (typeof target === "string") return [target];
  return null;
}

/**
 * Traduz a violação de unicidade do banco (autoridade final na corrida) em
 * conflito de domínio. Prefere reconsultar o dono atual — resposta exata mesmo
 * quando dois pedidos disputam o título no mesmo instante; usa `meta.target`
 * do Prisma só quando o dono já não existe (desvinculado entre a falha e a
 * reconsulta). Nunca depende do texto da mensagem.
 */
async function mapUniqueViolationToDomainError(
  db: Db,
  error: { code: "P2002"; meta?: { target?: unknown } },
  input: { orderId: string; payableExternalId: number }
): Promise<PurchaseOrderPayableLinkError> {
  const owner = await db.nomusPurchaseOrderPayableLink.findFirst({
    where: { payableExternalId: input.payableExternalId },
    select: { nomusPurchaseOrderId: true, nomusPurchaseOrder: { select: { orderNumber: true } } },
  });
  const orderNumbersById = new Map<string, string | null>();
  if (owner) orderNumbersById.set(owner.nomusPurchaseOrderId, owner.nomusPurchaseOrder?.orderNumber ?? null);
  try {
    assertPayableFinancialOwnerAvailable({
      payableExternalId: input.payableExternalId,
      orderId: input.orderId,
      confirmedOrderIds: owner ? [owner.nomusPurchaseOrderId] : [],
      orderNumbersById,
    });
  } catch (domainError) {
    if (domainError instanceof PurchaseOrderPayableLinkError) return domainError;
    throw domainError;
  }
  // Sem dono na reconsulta: decide pelo índice violado informado pelo Prisma.
  const target = uniqueViolationTarget(error);
  const samePair = target?.includes("nomusPurchaseOrderId") === true;
  return new PurchaseOrderPayableLinkError(
    samePair
      ? PURCHASE_ORDER_PAYABLE_OWNER_ERROR_CODES.alreadyLinkedHere
      : PURCHASE_ORDER_PAYABLE_OWNER_ERROR_CODES.linkedToAnotherOrder,
    samePair
      ? "Este título já está vinculado a este pedido."
      : "Este título já está vinculado financeiramente a outro pedido.",
    409,
    "payableExternalId",
    { payableExternalId: input.payableExternalId, uniqueTarget: target }
  );
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

  // Cardinalidade V1 — pré-checagem pela autoridade única (o banco confirma na corrida).
  assertPayableFinancialOwnerAvailable({
    payableExternalId: payload.payableExternalId,
    orderId: order.id,
    confirmedOrderIds: context.ownership.get(payload.payableExternalId)?.confirmedOrderIds ?? [],
    orderNumbersById: context.orderNumbersById,
  });

  if (payload.method === "INSTALLMENT_MATCH") {
    // A confirmação por parcela só vale para uma sugestão que o motor realmente produziu.
    const reconciliation = reconciliationFromContext(context, options.now);
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
    if (isPrismaUniqueViolation(error)) {
      throw await mapUniqueViolationToDomainError(db, error, {
        orderId: order.id,
        payableExternalId: payload.payableExternalId,
      });
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

  // Hard delete da linha ativa (libera o dono financeiro); o histórico sobrevive
  // (sem FK history → link): quem vinculou, quando, por quê, e o desvínculo.
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

/* ------------------------------------------------------------------ *
 * Lote para listagem / 360
 * ------------------------------------------------------------------ */

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

/**
 * Dono financeiro dos títulos que a listagem/360 apresenta por pedido (NF-e +
 * confirmados). `claims` = evidências que o chamador já tem (NF-e do pedido =
 * automática; vínculo persistido = confirmada); o resto (vínculos e evidências
 * de pedidos fora da página) vem da mesma autoridade em lote.
 */
export async function resolvePayableOwnershipForOrderPayables(
  input: {
    payablesByOrder: ReadonlyMap<string, readonly ConfirmedPayableSnapshot[]>;
    confirmedByOrder: ReadonlyMap<string, readonly ConfirmedPayableSnapshot[]>;
  },
  options: { db?: Db } = {}
): Promise<PayableOwnershipResolution> {
  const db = options.db ?? defaultPrisma;
  const refs = new Map<number, OwnershipPayableRef>();
  const knownClaims: PayableOwnershipClaim[] = [];
  const collect = (rows: ReadonlyMap<string, readonly ConfirmedPayableSnapshot[]>, source: PayableOwnershipClaim["source"]) => {
    for (const [orderId, list] of rows) {
      for (const row of list) {
        refs.set(row.externalId, {
          externalId: row.externalId,
          sourceInvoiceId: row.sourceInvoiceId,
          documentNumber: row.documentNumber ?? null,
          personId: row.personId,
          personCnpj: row.personCnpj,
        });
        knownClaims.push({
          nomusPurchaseOrderId: orderId,
          payableExternalId: row.externalId,
          source,
          method: source === "AUTOMATIC" ? "DIRECT_NOMUS_NFE" : null,
        });
      }
    }
  };
  collect(input.payablesByOrder, "AUTOMATIC");
  collect(input.confirmedByOrder, "CONFIRMED");
  return resolvePayableOwnershipAcrossOrders(db, { payables: [...refs.values()], knownClaims });
}

export function mapPayableLinkError(error: unknown): {
  status: number;
  body: { error: string; code: string; field?: string; details?: Record<string, unknown> };
} {
  if (error instanceof PurchaseOrderPayableLinkError) {
    return {
      status: error.httpStatus,
      body: {
        error: error.message,
        code: error.code,
        ...(error.field ? { field: error.field } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  console.error("purchase-order-payable-link error:", error);
  return {
    status: 500,
    body: { error: "Erro ao processar o vínculo do pedido com Contas a Pagar.", code: "PURCHASE_ORDER_PAYABLE_LINK_UNEXPECTED_ERROR" },
  };
}
