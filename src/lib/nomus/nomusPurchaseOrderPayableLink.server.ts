/**
 * Vínculo Pedido de Compra Nomus ↔ Contas a Pagar — I/O (Prisma).
 *
 * Número constante de consultas por pedido: vínculos persistidos, documentos
 * de entrada que apontam o pedido, títulos candidatos, dono financeiro dos
 * mesmos títulos (vínculos confirmados de qualquer pedido + busca reversa, em
 * lote, das evidências automáticas de outros pedidos). Toda a regra vive no
 * motor puro (`nomusPurchaseOrderPayableLink.ts`,
 * `nomusPurchaseOrderPayableOwnership.ts`). Nada é escrito no Nomus.
 *
 * SIMETRIA AUTO-LINK × OWNERSHIP GLOBAL (invariante):
 *   DIRECT_MATCH_CANDIDATES(título) == GLOBAL_OWNERSHIP_CANDIDATES(título)
 * Para cada camada automática existe UM extrator canônico em memória
 * (`extractNomusPurchaseOrderNfeIds`, `extractDocumentEntryPurchaseOrderId`,
 * `resolveAutomaticPayableLinks`) e as consultas SQL abaixo são apenas
 * PRÉ-FILTROS SUPERCONJUNTO (nunca decidem). Como `toInt` aceita qualquer
 * grafia com dígitos ("0501", "501/A"), o pré-filtro compara os DÍGITOS do
 * valor (sem zeros à esquerda) por prefixo — o que é superconjunto do
 * `parseInt` aplicado pelo extrator — e o extrator decide em memória. Assim a
 * aba Financeiro (direto), a listagem/360 (lote) e a busca reversa (global)
 * reconhecem exatamente as mesmas formas.
 *
 * CARDINALIDADE FINANCEIRA V1: `payableExternalId` é ÚNICO na tabela de
 * vínculos (migration 20260925120000). A pré-checagem de dono acontece aqui,
 * mas o banco é a autoridade final na corrida: a violação P2002 vira 409 de
 * domínio, nunca 500.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma.js";
import {
  extractDocumentEntryPurchaseOrderId,
  extractNomusPurchaseOrderNfeIds,
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
  digitsOnly,
  isSameSupplier,
  normalizeDocumentNumber,
  normalizePurchaseOrderPayableLinkReason,
  parseConfirmPayableLinkPayload,
  resolveAutomaticPayableLinks,
  type AutomaticLinkPayableRef,
  type AutomaticLinkResolution,
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

/** Mesmas colunas de PAYABLE_SELECT, para o pré-filtro SQL de camada 3. */
const PAYABLE_SQL_COLUMNS = Prisma.sql`
  p."externalId", p."companyId", p."personId", p."personName", p."personCnpj", p."documentNumber",
  p."sourceInvoiceId", p."sourceInvoiceNumber", p."dueDate", p."paymentDate", p."settlementDate",
  p."amountPayable", p."amountPaid", p."balancePayable", p."paymentMethodId", p."paymentMethodName",
  p."bankAccountId", p."description", p."comments", p."classification", p."status", p."suspendPayment"`;

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

/** Identidade de pedido para as camadas automáticas (sem rawPayload). */
export type PurchaseOrderIdentityRow = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierTaxId: string | null;
};

type OrderRow = PurchaseOrderIdentityRow & { rawPayload: unknown };

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

/* ------------------------------------------------------------------ *
 * Pré-filtros SQL (superconjunto) — a decisão é sempre do extrator canônico
 * ------------------------------------------------------------------ */

/** Marcadores estáveis dos pré-filtros (também usados pelos testes com Prisma falso). */
export const PAYABLE_LINK_SQL_MARKERS = {
  ordersDeclaringInvoices: "po-payable:orders-declaring-nfe",
  ordersBySupplierScope: "po-payable:orders-by-supplier-scope",
  ordersByExternalId: "po-payable:orders-by-external-id",
  stockDocumentsPointingToOrders: "po-payable:stock-documents-pointing-to-orders",
  payablesByDocumentNumber: "po-payable:payables-by-document-number",
} as const;

const REVERSE_LOOKUP_ORDER_LIMIT = 2000;
const REVERSE_LOOKUP_STOCK_DOCUMENT_LIMIT = 2000;
const DOCUMENT_NUMBER_PAYABLE_LIMIT = 500;

/** Projeção mínima de pedido devolvida pelos pré-filtros (com `rawPayload->'nfes'`). */
export type PurchaseOrderNfeProjectionRow = PurchaseOrderIdentityRow & { nfes: unknown };

/**
 * Padrão de prefixo de dígitos para um ID inteiro positivo. O extrator (`toInt`)
 * faz `parseInt` sobre os dígitos do valor; os dígitos sem zeros à esquerda de
 * qualquer grafia que o `parseInt` leia como N começam por N — logo
 * `ltrim(digits, '0') LIKE 'N%'` é superconjunto do extrator.
 */
function digitPrefixPattern(id: number): string {
  return `${String(Math.trunc(Math.abs(id))).replace(/^0+(?=\d)/, "")}%`;
}

/** Digits(coluna JSON) sem zeros à esquerda — mesmo pré-processamento de `toInt`. */
function sqlDigits(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`ltrim(regexp_replace(coalesce(${expression}, ''), '[^0-9]', '', 'g'), '0')`;
}

/**
 * Camada 1 reversa: pedidos (de QUALQUER fornecedor — a camada 1 direta não
 * exige fornecedor) cujo `rawPayload.nfes[]` contenha alguma das NF-e, nas
 * MESMAS formas do extrator canônico: elemento escalar, ou primeira chave não
 * nula entre id/idNfe/externalId (`coalesce` na mesma ordem). Devolve só a
 * projeção `nfes`; `extractNomusPurchaseOrderNfeIds({ nfes })` decide.
 */
async function queryOrdersDeclaringInvoices(db: Db, invoiceIds: readonly number[]): Promise<PurchaseOrderNfeProjectionRow[]> {
  if (invoiceIds.length === 0) return [];
  const patterns = invoiceIds.map(digitPrefixPattern);
  return db.$queryRaw<PurchaseOrderNfeProjectionRow[]>(Prisma.sql`
    /* ${Prisma.raw(PAYABLE_LINK_SQL_MARKERS.ordersDeclaringInvoices)} */
    SELECT o."id", o."externalId", o."orderNumber", o."supplierExternalId", o."supplierTaxId",
           o."rawPayload"->'nfes' AS "nfes"
    FROM "NomusPurchaseOrder" o
    WHERE jsonb_typeof(o."rawPayload"->'nfes') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(o."rawPayload"->'nfes') AS e
        WHERE ${sqlDigits(Prisma.sql`coalesce(e->>'id', e->>'idNfe', e->>'externalId', e #>> '{}')`)}
              LIKE ANY(ARRAY[${Prisma.join(patterns)}]::text[])
      )
    LIMIT ${REVERSE_LOOKUP_ORDER_LIMIT}
  `);
}

/**
 * Camada 3 reversa: pedidos no escopo de fornecedor dos títulos (mesmo
 * `supplierExternalId`, ou CNPJ igual — `isSameSupplier` decide em memória
 * junto com `normalizeDocumentNumber`).
 */
async function queryOrdersBySupplierScope(
  db: Db,
  scope: { personIds: readonly number[]; cnpjs: readonly string[] }
): Promise<PurchaseOrderNfeProjectionRow[]> {
  if (scope.personIds.length === 0 && scope.cnpjs.length === 0) return [];
  const byId = scope.personIds.length ? Prisma.sql`o."supplierExternalId" IN (${Prisma.join(scope.personIds)})` : Prisma.sql`false`;
  const byCnpj = scope.cnpjs.length
    ? Prisma.sql`regexp_replace(coalesce(o."supplierTaxId", ''), '[^0-9]', '', 'g') IN (${Prisma.join(scope.cnpjs)})`
    : Prisma.sql`false`;
  return db.$queryRaw<PurchaseOrderNfeProjectionRow[]>(Prisma.sql`
    /* ${Prisma.raw(PAYABLE_LINK_SQL_MARKERS.ordersBySupplierScope)} */
    SELECT o."id", o."externalId", o."orderNumber", o."supplierExternalId", o."supplierTaxId",
           o."rawPayload"->'nfes' AS "nfes"
    FROM "NomusPurchaseOrder" o
    WHERE ${byId} OR ${byCnpj}
    LIMIT ${REVERSE_LOOKUP_ORDER_LIMIT}
  `);
}

async function queryOrdersByExternalId(db: Db, externalIds: readonly number[]): Promise<PurchaseOrderNfeProjectionRow[]> {
  if (externalIds.length === 0) return [];
  return db.$queryRaw<PurchaseOrderNfeProjectionRow[]>(Prisma.sql`
    /* ${Prisma.raw(PAYABLE_LINK_SQL_MARKERS.ordersByExternalId)} */
    SELECT o."id", o."externalId", o."orderNumber", o."supplierExternalId", o."supplierTaxId",
           o."rawPayload"->'nfes' AS "nfes"
    FROM "NomusPurchaseOrder" o
    WHERE o."externalId" IN (${Prisma.join(externalIds)})
    LIMIT ${REVERSE_LOOKUP_ORDER_LIMIT}
  `);
}

type StockDocumentPointerRow = { idNfe: number | null; rawJson: unknown };

/**
 * Camada 2 direta (pedido → documentos de entrada): superconjunto pelas mesmas
 * chaves e ordem do extrator canônico (`coalesce(idPedidoCompra, idPedido,
 * pedidoCompraId)`); `extractDocumentEntryPurchaseOrderId(rawJson)` decide.
 */
async function queryStockDocumentsPointingToOrders(db: Db, externalIds: readonly number[]): Promise<StockDocumentPointerRow[]> {
  if (externalIds.length === 0) return [];
  const patterns = externalIds.map(digitPrefixPattern);
  return db.$queryRaw<StockDocumentPointerRow[]>(Prisma.sql`
    /* ${Prisma.raw(PAYABLE_LINK_SQL_MARKERS.stockDocumentsPointingToOrders)} */
    SELECT d."idNfe", d."rawJson"
    FROM "NomusStockDocument" d
    WHERE d."isCancelled" = false
      AND d."idNfe" IS NOT NULL
      AND ${sqlDigits(Prisma.sql`coalesce(d."rawJson"->>'idPedidoCompra', d."rawJson"->>'idPedido', d."rawJson"->>'pedidoCompraId')`)}
          LIKE ANY(ARRAY[${Prisma.join(patterns)}]::text[])
    LIMIT ${REVERSE_LOOKUP_STOCK_DOCUMENT_LIMIT}
  `);
}

/**
 * Camada 3 direta (pedido → títulos): títulos do escopo de fornecedor cujo
 * `documentNumber` normalizado (mesma regra de `normalizeDocumentNumber`:
 * maiúsculas, só [A-Z0-9], sem zeros à esquerda antes de dígito) é uma das
 * chaves do pedido. Superconjunto: `resolveAutomaticPayableLinks` decide.
 */
async function queryPayablesByDocumentNumber(
  db: Db,
  input: { normalizedKeys: readonly string[]; personIds: readonly number[]; cnpjs: readonly string[] }
): Promise<PayableSelectRow[]> {
  if (input.normalizedKeys.length === 0 || (input.personIds.length === 0 && input.cnpjs.length === 0)) return [];
  const byId = input.personIds.length ? Prisma.sql`p."personId" IN (${Prisma.join(input.personIds)})` : Prisma.sql`false`;
  const byCnpj = input.cnpjs.length
    ? Prisma.sql`regexp_replace(coalesce(p."personCnpj", ''), '[^0-9]', '', 'g') IN (${Prisma.join(input.cnpjs)})`
    : Prisma.sql`false`;
  return db.$queryRaw<PayableSelectRow[]>(Prisma.sql`
    /* ${Prisma.raw(PAYABLE_LINK_SQL_MARKERS.payablesByDocumentNumber)} */
    SELECT ${PAYABLE_SQL_COLUMNS}
    FROM "NomusAccountsPayable" p
    WHERE (${byId} OR ${byCnpj})
      AND regexp_replace(regexp_replace(upper(coalesce(p."documentNumber", '')), '[^A-Z0-9]', '', 'g'), '^0+(?=[0-9])', '')
          IN (${Prisma.join(input.normalizedKeys)})
    LIMIT ${DOCUMENT_NUMBER_PAYABLE_LIMIT}
  `);
}

function projectionIdentity(row: PurchaseOrderIdentityRow): PurchaseOrderLinkIdentity {
  return {
    id: row.id,
    externalId: row.externalId,
    orderNumber: row.orderNumber,
    companyId: null,
    supplierExternalId: row.supplierExternalId,
    supplierTaxId: row.supplierTaxId,
  };
}

function orderDocumentKeys(order: Pick<PurchaseOrderIdentityRow, "orderNumber" | "externalId">): string[] {
  return [normalizeDocumentNumber(order.orderNumber), normalizeDocumentNumber(String(order.externalId))].filter((k) => k.length > 0);
}

function supplierScopeOf(rows: ReadonlyArray<{ supplierExternalId: number | null; supplierTaxId: string | null }>) {
  return {
    personIds: [...new Set(rows.map((r) => r.supplierExternalId).filter((id): id is number => id != null))],
    cnpjs: [...new Set(rows.map((r) => digitsOnly(r.supplierTaxId)).filter((d) => d.length >= 11))],
  };
}

function payableScopeOf(rows: ReadonlyArray<{ personId: number | null; personCnpj: string | null }>) {
  return {
    personIds: [...new Set(rows.map((r) => r.personId).filter((id): id is number => id != null))],
    cnpjs: [...new Set(rows.map((r) => digitsOnly(r.personCnpj)).filter((d) => d.length >= 11))],
  };
}

/* ------------------------------------------------------------------ *
 * Candidatos automáticos por pedido (direto) — aba, listagem e 360
 * ------------------------------------------------------------------ */

export type AutomaticCandidatesForOrder = {
  identity: PurchaseOrderLinkIdentity;
  directInvoiceIds: number[];
  stockDocumentInvoiceIds: number[];
  /** Camadas 1–3 resolvidas pelo motor puro sobre os candidatos. */
  automatic: AutomaticLinkResolution[];
  /** Títulos reivindicados (mesma lista de `automatic`, com os dados do título). */
  payables: PayableCandidateRow[];
};

/**
 * Candidatos automáticos (camadas 1–3) de N pedidos, em lote e com a MESMA
 * regra do caminho direto da aba Financeiro. Consultas constantes:
 * documentos de entrada apontando os pedidos (1), títulos por NF-e (1),
 * títulos por número do pedido (1).
 */
export async function loadAutomaticPayableCandidatesForOrders(
  db: Db,
  orders: readonly OrderRow[]
): Promise<Map<string, AutomaticCandidatesForOrder>> {
  const result = new Map<string, AutomaticCandidatesForOrder>();
  if (orders.length === 0) return result;

  const directByOrder = new Map(orders.map((order) => [order.id, extractNomusPurchaseOrderNfeIds(order.rawPayload)]));
  const externalIds = [...new Set(orders.map((order) => order.externalId))];
  const stockDocuments = await queryStockDocumentsPointingToOrders(db, externalIds);
  const stockByExternalId = new Map<number, Set<number>>();
  for (const doc of stockDocuments) {
    const pointed = extractDocumentEntryPurchaseOrderId(doc.rawJson);
    if (pointed == null || doc.idNfe == null) continue;
    const set = stockByExternalId.get(pointed) ?? new Set<number>();
    set.add(doc.idNfe);
    stockByExternalId.set(pointed, set);
  }

  const invoiceIds = new Set<number>();
  for (const order of orders) {
    for (const id of directByOrder.get(order.id) ?? []) invoiceIds.add(id);
    for (const id of stockByExternalId.get(order.externalId) ?? []) invoiceIds.add(id);
  }
  const normalizedKeys = [...new Set(orders.flatMap(orderDocumentKeys))];

  const [byInvoice, byDocumentNumber] = await Promise.all([
    invoiceIds.size
      ? db.nomusAccountsPayable.findMany({
          where: { sourceInvoiceId: { in: [...invoiceIds] } },
          select: PAYABLE_SELECT,
        })
      : Promise.resolve([] as PayableSelectRow[]),
    queryPayablesByDocumentNumber(db, { normalizedKeys, ...supplierScopeOf(orders) }),
  ]);
  const candidateById = new Map<number, PayableCandidateRow>();
  for (const row of [...byInvoice, ...byDocumentNumber]) candidateById.set(row.externalId, toPayableCandidateRow(row));
  const candidates = [...candidateById.values()];

  for (const order of orders) {
    const identity = identityFromOrder(order);
    const directInvoiceIds = directByOrder.get(order.id) ?? [];
    const stockDocumentInvoiceIds = [...(stockByExternalId.get(order.externalId) ?? [])];
    const automatic = resolveAutomaticPayableLinks({ order: identity, payables: candidates, directInvoiceIds, stockDocumentInvoiceIds });
    result.set(order.id, {
      identity,
      directInvoiceIds,
      stockDocumentInvoiceIds,
      automatic,
      payables: automatic.map((link) => candidateById.get(link.payableExternalId)!).filter(Boolean),
    });
  }
  return result;
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

/**
 * Busca reversa (global) das evidências automáticas: quais pedidos — de
 * qualquer página — reivindicam algum destes títulos pelas camadas 1–3?
 *
 *  - camada 1: pedidos que declaram as NF-e dos títulos (qualquer fornecedor,
 *    como no caminho direto), pré-filtro superconjunto + extrator canônico;
 *  - camada 2: documentos de entrada com `idNfe` dos títulos → pedido apontado
 *    (extrator canônico) → pedidos por externalId;
 *  - camada 3: pedidos no escopo de fornecedor dos títulos; número/ID
 *    normalizado decidido em memória.
 *
 * Cada pedido encontrado passa pelo MESMO `resolveAutomaticPayableLinks` do
 * caminho direto (paridade de regra, sem N+1).
 */
export async function loadAutomaticPayableClaimsAcrossOrders(
  db: Db,
  payables: readonly OwnershipPayableRef[],
  options: { orderNumbersById?: Map<string, string | null> } = {}
): Promise<PayableOwnershipClaim[]> {
  if (payables.length === 0) return [];
  const invoiceIds = [...new Set(payables.map((row) => row.sourceInvoiceId).filter((id): id is number => id != null))];
  const hasDocumentNumber = payables.some((row) => normalizeDocumentNumber(row.documentNumber).length > 0);

  const [declaring, bySupplier, stockDocuments] = await Promise.all([
    queryOrdersDeclaringInvoices(db, invoiceIds),
    hasDocumentNumber ? queryOrdersBySupplierScope(db, payableScopeOf(payables)) : Promise.resolve([] as PurchaseOrderNfeProjectionRow[]),
    invoiceIds.length
      ? db.nomusStockDocument.findMany({
          where: { isCancelled: false, idNfe: { in: invoiceIds } },
          select: { idNfe: true, rawJson: true },
          take: REVERSE_LOOKUP_STOCK_DOCUMENT_LIMIT,
        })
      : Promise.resolve([] as StockDocumentPointerRow[]),
  ]);

  const ordersById = new Map<string, PurchaseOrderNfeProjectionRow>();
  for (const row of [...declaring, ...bySupplier]) ordersById.set(row.id, row);

  const stockInvoiceIdsByOrderExternalId = new Map<number, Set<number>>();
  for (const doc of stockDocuments) {
    const pointed = extractDocumentEntryPurchaseOrderId(doc.rawJson);
    if (pointed == null || doc.idNfe == null) continue;
    const set = stockInvoiceIdsByOrderExternalId.get(pointed) ?? new Set<number>();
    set.add(doc.idNfe);
    stockInvoiceIdsByOrderExternalId.set(pointed, set);
  }
  const loadedExternalIds = new Set([...ordersById.values()].map((row) => row.externalId));
  const missingExternalIds = [...stockInvoiceIdsByOrderExternalId.keys()].filter((id) => !loadedExternalIds.has(id));
  for (const row of await queryOrdersByExternalId(db, missingExternalIds)) ordersById.set(row.id, row);

  const claims: PayableOwnershipClaim[] = [];
  for (const order of ordersById.values()) {
    options.orderNumbersById?.set(order.id, order.orderNumber);
    const resolved = resolveAutomaticPayableLinks({
      order: projectionIdentity(order),
      payables,
      directInvoiceIds: extractNomusPurchaseOrderNfeIds({ nfes: order.nfes }),
      stockDocumentInvoiceIds: [...(stockInvoiceIdsByOrderExternalId.get(order.externalId) ?? [])],
    });
    for (const link of resolved) {
      claims.push({ nomusPurchaseOrderId: order.id, payableExternalId: link.payableExternalId, source: "AUTOMATIC", method: link.method });
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

/** Janela de vencimento em torno das parcelas para sugestões (camada 4) do fornecedor. */
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

export type PurchaseOrderPayableContext = {
  order: OrderRow;
  identity: PurchaseOrderLinkIdentity;
  installments: ReturnType<typeof parsePurchaseOrderPlannedInstallments>;
  plannedInstallmentsTotal: number | null;
  payables: PayableCandidateRow[];
  persisted: PersistedPayableLinkRow[];
  automatic: AutomaticLinkResolution[];
  /** Títulos com vínculo CONFIRMADO em outro pedido (compatibilidade de payload). */
  linkedElsewherePayableIds: number[];
  ownership: Map<number, PayableFinancialOwnership>;
  orderNumbersById: Map<string, string | null>;
};

export async function loadPurchaseOrderPayableContext(
  db: Db,
  order: OrderRow
): Promise<PurchaseOrderPayableContext> {
  const installments = parsePurchaseOrderPlannedInstallments(order.rawPayload);

  // Camadas 1–3 pelo MESMO lote da listagem/360 (uma regra só) + vínculos persistidos.
  const [candidatesByOrder, persistedRows] = await Promise.all([
    loadAutomaticPayableCandidatesForOrders(db, [order]),
    db.nomusPurchaseOrderPayableLink.findMany({
      where: { nomusPurchaseOrderId: order.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const candidates = candidatesByOrder.get(order.id)!;
  const identity = candidates.identity;

  // Sugestões (camada 4) e títulos persistidos: fornecedor na janela das parcelas + ids já vinculados.
  const persistedIds = persistedRows.map((row) => row.payableExternalId);
  const window = candidateDateWindow(installments.map((row) => row.dueDate));
  const or: Prisma.NomusAccountsPayableWhereInput[] = [];
  if (persistedIds.length) or.push({ externalId: { in: persistedIds } });
  if (order.supplierExternalId != null) {
    or.push({
      personId: order.supplierExternalId,
      ...(window ? { dueDate: { gte: window.gte, lte: window.lte } } : {}),
    });
  }
  const extraRows = or.length
    ? await db.nomusAccountsPayable.findMany({
        where: { OR: or },
        select: PAYABLE_SELECT,
        orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
        take: CANDIDATE_LIMIT,
      })
    : [];

  const payableById = new Map<number, PayableCandidateRow>();
  for (const row of candidates.payables) payableById.set(row.externalId, row);
  for (const row of extraRows) if (!payableById.has(row.externalId)) payableById.set(row.externalId, toPayableCandidateRow(row));
  const payables = [...payableById.values()].sort(
    (a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0) || a.externalId - b.externalId
  );
  const automatic = candidates.automatic;

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
 * Lote para a listagem: títulos vinculados por CONFIRMAÇÃO humana.
 * Uma consulta de vínculos + uma de títulos.
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

export type OrderFinancialPayables = {
  /** Títulos que o pedido apresenta (automáticos camadas 1–3 + confirmados), deduplicados. */
  rows: ConfirmedPayableSnapshot[];
};

/**
 * Entrada financeira canônica da listagem e do 360 — a MESMA da aba
 * Financeiro: candidatos automáticos (camadas 1–3, mesmo lote/regra) +
 * vínculos confirmados, com o dono financeiro resolvido pela autoridade global.
 */
export async function loadOrderFinancialPayablesWithOwnership(
  orders: readonly OrderRow[],
  options: { db?: Db } = {}
): Promise<{ payablesByOrder: Map<string, ConfirmedPayableSnapshot[]>; ownership: Map<number, PayableFinancialOwnership> }> {
  const db = options.db ?? defaultPrisma;
  const payablesByOrder = new Map<string, ConfirmedPayableSnapshot[]>();
  if (orders.length === 0) return { payablesByOrder, ownership: new Map() };

  const [automaticByOrder, confirmedByOrder] = await Promise.all([
    loadAutomaticPayableCandidatesForOrders(db, orders),
    loadConfirmedPayableSnapshotsByOrder(
      orders.map((order) => order.id),
      { db }
    ),
  ]);

  const refs = new Map<number, OwnershipPayableRef>();
  const knownClaims: PayableOwnershipClaim[] = [];
  for (const order of orders) {
    const automatic = automaticByOrder.get(order.id);
    const rows: ConfirmedPayableSnapshot[] = [];
    const seen = new Set<number>();
    for (const row of automatic?.payables ?? []) {
      if (seen.has(row.externalId)) continue;
      seen.add(row.externalId);
      rows.push(toConfirmedPayableSnapshot(row));
      refs.set(row.externalId, row);
    }
    for (const link of automatic?.automatic ?? []) {
      knownClaims.push({ nomusPurchaseOrderId: order.id, payableExternalId: link.payableExternalId, source: "AUTOMATIC", method: link.method });
    }
    for (const row of confirmedByOrder.get(order.id) ?? []) {
      if (!seen.has(row.externalId)) {
        seen.add(row.externalId);
        rows.push(row);
      }
      refs.set(row.externalId, {
        externalId: row.externalId,
        sourceInvoiceId: row.sourceInvoiceId,
        documentNumber: row.documentNumber ?? null,
        personId: row.personId,
        personCnpj: row.personCnpj,
      });
      knownClaims.push({ nomusPurchaseOrderId: order.id, payableExternalId: row.externalId, source: "CONFIRMED", method: null });
    }
    payablesByOrder.set(order.id, rows);
  }

  const resolution = await resolvePayableOwnershipAcrossOrders(db, { payables: [...refs.values()], knownClaims });
  return { payablesByOrder, ownership: resolution.ownership };
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
