/**
 * B5 — carga da evidência oficial de faturamento por item para um pedido.
 *
 * Lê os documentos de saída do Nomus (NomusStockDocument + itens) de TODAS as NF-e do
 * pedido e resolve cada linha com o resolvedor canônico de documento de saída
 * (`resolveOutputDocumentLineLinks`) — para o pedido e para os demais pedidos das
 * mesmas NF-e, de modo que uma linha reivindicada por dois pedidos nunca seja alocada.
 * Somente leitura; poucas consultas em lote (sem N+1 por linha).
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import type { CommissionOrderSourceBundle } from "./commission-types.js";
import {
  extractOutputDocumentOrderRefsFromRaw,
  normalizeOutputDocumentOrderCode,
  resolveOutputDocumentLineLinks,
  type OutputDocumentLinkDocumentInput,
  type OutputDocumentLinkLineInput,
} from "../sales/salesOrderOutputDocumentLinkResolver.js";
import {
  resolveOrderInvoiceAllocation,
  resolveSingleNfeBillingProof,
  type InvoiceAllocationLineInput,
  type OrderInvoiceAllocation,
  type SingleNfeBillingProof,
} from "./commissionInvoiceAllocation.js";
import { resolveItemizedBillingCoverage } from "../sales/salesOrderItemizedBillingCoverage.js";

/** Liga/desliga a alocação por NF-e (padrão: ligada). `false` volta ao snapshot do pedido inteiro. */
export function isCommissionInvoiceAllocationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.COMMISSION_INVOICE_ALLOCATION_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

type AllocationDb = Pick<PrismaClient, "nomusStockDocument" | "salesOrderNfeLink" | "salesOrder">;
type BillingProofDb = Pick<
  PrismaClient,
  "nomusNfe" | "salesOrderNfeLink" | "salesOrder" | "salesOrderItem" | "salesOrderItemFlowSnapshot"
>;

/**
 * Prova de faturamento integral do pedido de NF-e única (sem evidência por item no
 * documento de saída): cobertura por item do motor operacional — mesma regra e mesmas
 * entradas do status de Faturamento do pedido (`loadSalesOrderLinkedNfeContextMap`) —
 * e, se inconclusiva, valor de produtos da NF-e × valor líquido dos pedidos dela.
 */
export async function loadSingleNfeBillingProof(
  db: BillingProofDb,
  input: { salesOrderId: string; nfeExternalId: number; nfeProcessedAt: Date | null }
): Promise<SingleNfeBillingProof> {
  const [nfe, nfeLinks, flowRows, itemCount] = await Promise.all([
    db.nomusNfe.findUnique({
      where: { externalId: input.nfeExternalId },
      select: { valorLiquido: true, xmlVProd: true, xmlVDesc: true },
    }),
    db.salesOrderNfeLink.findMany({
      where: { nfeExternalId: input.nfeExternalId },
      select: { salesOrderId: true, firstSeenAt: true, dataProcessamento: true },
    }),
    db.salesOrderItemFlowSnapshot.findMany({
      where: { salesOrderId: input.salesOrderId },
      select: {
        salesOrderItemId: true,
        isActiveForKanban: true,
        currentStage: true,
        orderedQuantity: true,
        shipTargetQuantity: true,
        activeRemainingQuantity: true,
        invoicedQuantity: true,
        computedAt: true,
        verifiedAt: true,
      },
    }),
    db.salesOrderItem.count({ where: { salesOrderId: input.salesOrderId } }),
  ]);
  const ownLink = nfeLinks.find((link) => link.salesOrderId === input.salesOrderId) ?? null;
  const processedAt = ownLink?.dataProcessamento ?? input.nfeProcessedAt;
  const latestFiscalEvidenceAt =
    ownLink?.firstSeenAt instanceof Date
      ? new Date(Math.max(ownLink.firstSeenAt.getTime(), processedAt?.getTime() ?? 0))
      : null;
  const itemized = resolveItemizedBillingCoverage({
    items: flowRows.map((row) => ({
      salesOrderItemId: row.salesOrderItemId,
      isActiveForKanban: row.isActiveForKanban,
      currentStage: row.currentStage,
      orderedQuantity: decimalToNumber(row.orderedQuantity),
      shipTargetQuantity: decimalToNumber(row.shipTargetQuantity),
      activeRemainingQuantity: decimalToNumber(row.activeRemainingQuantity),
      invoicedQuantity: decimalToNumber(row.invoicedQuantity),
      computedAt: row.computedAt,
      verifiedAt: row.verifiedAt,
    })),
    expectedItemCount: itemCount,
    latestFiscalEvidenceAt,
  });
  const orderIds = [...new Set([input.salesOrderId, ...nfeLinks.map((link) => link.salesOrderId)])];
  const orders = await db.salesOrder.findMany({ where: { id: { in: orderIds } }, select: { totalNetValue: true } });
  const ordersNetTotal = orders.reduce((sum, order) => sum + decimalToNumber(order.totalNetValue), 0);
  const liquid = nfe?.valorLiquido != null ? decimalToNumber(nfe.valorLiquido) : null;
  const products =
    liquid != null && liquid > 0
      ? liquid
      : nfe?.xmlVProd != null
        ? decimalToNumber(nfe.xmlVProd) - decimalToNumber(nfe.xmlVDesc)
        : null;
  return resolveSingleNfeBillingProof({
    itemizedCoverage: itemized.coverage,
    itemizedReason: itemized.reason,
    nfeProductsValue: products,
    ordersNetTotal: orders.length === orderIds.length ? ordersNetTotal : null,
  });
}

export async function loadOrderInvoiceAllocation(
  db: AllocationDb & Partial<BillingProofDb>,
  bundle: CommissionOrderSourceBundle
): Promise<OrderInvoiceAllocation> {
  const nfeIds = [...new Set(bundle.linkedNfes.map((nfe) => nfe.nfeExternalId))];
  const items = bundle.items.map((item) => ({ salesOrderItemId: item.localItemId, orderedQuantity: item.quantity }));
  const nfes = bundle.linkedNfes.map((nfe) => ({
    nfeExternalId: nfe.nfeExternalId,
    processedAt: nfe.dataProcessamento,
    valid: nfe.isAuthorized && nfe.isOutputOperation && !nfe.isCancelled,
  }));
  if (nfeIds.length === 0) return resolveOrderInvoiceAllocation({ items, nfes, lines: [] });
  // NF-e única: a prova de faturamento integral só pesa se não houver evidência por item.
  const validNfes = nfes.filter((nfe) => nfe.valid);
  const singleNfeBillingProof =
    validNfes.length === 1
      ? await loadSingleNfeBillingProof(db as BillingProofDb, {
          salesOrderId: bundle.localOrderId,
          nfeExternalId: validNfes[0]!.nfeExternalId,
          nfeProcessedAt: validNfes[0]!.processedAt,
        })
      : null;

  const [documents, links] = await Promise.all([
    db.nomusStockDocument.findMany({
      where: { idNfe: { in: nfeIds } },
      select: {
        id: true,
        externalId: true,
        idNfe: true,
        isCancelled: true,
        statusRaw: true,
        tipoDocumentoEstoque: true,
        rawJson: true,
        items: {
          select: { id: true, externalProductId: true, quantity: true, estimatedTotalValue: true, rawJson: true },
        },
      },
      orderBy: { externalId: "asc" },
    }),
    db.salesOrderNfeLink.findMany({
      where: { nfeExternalId: { in: nfeIds } },
      select: { salesOrderId: true, nfeExternalId: true },
    }),
  ]);
  if (documents.length === 0) return resolveOrderInvoiceAllocation({ items, nfes, lines: [], singleNfeBillingProof });

  const orderIds = [...new Set([bundle.localOrderId, ...links.map((link) => link.salesOrderId)])];
  const orders = await db.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderId: true,
      items: { select: { id: true, nomusItemExternalId: true, nomusItemSequence: true, externalProductId: true } },
    },
  });
  const nfesByOrder = new Map<string, Set<number>>();
  for (const link of links) {
    const set = nfesByOrder.get(link.salesOrderId) ?? new Set<number>();
    set.add(link.nfeExternalId);
    nfesByOrder.set(link.salesOrderId, set);
  }

  const lines: OutputDocumentLinkLineInput[] = documents.flatMap((doc) =>
    doc.items.map((line) => ({
      id: line.id,
      stockDocumentId: doc.id,
      stockDocumentExternalId: doc.externalId,
      externalProductId: line.externalProductId,
      quantity: decimalToNumber(line.quantity),
      estimatedTotalValue: decimalToNumber(line.estimatedTotalValue),
      refs: extractOutputDocumentOrderRefsFromRaw(line.rawJson),
    }))
  );
  const nfeOfDocument = new Map(documents.map((doc) => [doc.externalId, doc.idNfe]));

  // Resolve as linhas para cada pedido das NF-e: quem reivindica cada linha.
  const claims = new Map<string, Set<string>>();
  // Reivindicação pelo item oficial (idItemPedido): a linha é daquele pedido.
  const officialClaims = new Map<string, Set<string>>();
  const resolvedForOrder = new Map<string, ReturnType<typeof resolveOutputDocumentLineLinks>>();
  for (const order of orders) {
    const linked = nfesByOrder.get(order.id) ?? new Set<number>();
    const docInputs: OutputDocumentLinkDocumentInput[] = documents.map((doc) => ({
      id: doc.id,
      externalId: doc.externalId,
      idNfe: doc.idNfe,
      isCancelled: doc.isCancelled,
      statusRaw: doc.statusRaw,
      tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
      headerRefs: extractOutputDocumentOrderRefsFromRaw(doc.rawJson),
      linkedViaSalesOrderNfeLink: doc.idNfe != null && linked.has(doc.idNfe),
    }));
    const resolved = resolveOutputDocumentLineLinks({
      salesOrderId: order.id,
      externalSalesOrderId: order.externalSalesOrderId,
      orderCodeNormalized: normalizeOutputDocumentOrderCode(order.orderCode),
      items: order.items.map((item) => ({
        id: item.id,
        salesOrderId: order.id,
        externalSalesOrderId: order.externalSalesOrderId,
        orderCodeNormalized: normalizeOutputDocumentOrderCode(order.orderCode),
        nomusItemExternalId: item.nomusItemExternalId,
        nomusItemSequence: item.nomusItemSequence,
        externalProductId: item.externalProductId,
      })),
      documents: docInputs,
      lines,
      nfeExternalIdsLinked: linked,
    });
    resolvedForOrder.set(order.id, resolved);
    for (const link of resolved) {
      if (link.salesOrderItemId == null) continue;
      const set = claims.get(link.stockDocumentItemId) ?? new Set<string>();
      set.add(order.id);
      claims.set(link.stockDocumentItemId, set);
      if (link.sourceType === "DIRECT_ORDER_ITEM_REFERENCE" && link.itemCoverage === "RESOLVED") {
        const official = officialClaims.get(link.stockDocumentItemId) ?? new Set<string>();
        official.add(order.id);
        officialClaims.set(link.stockDocumentItemId, official);
      }
    }
  }

  const own = resolvedForOrder.get(bundle.localOrderId) ?? [];
  // O resolvedor canônico liga ao pedido, só pelo vínculo pedido × NF-e, também a linha
  // cujo idItemPedido oficial é de OUTRO pedido da mesma NF-e. Essa linha não é
  // evidência (nem fraca) deste pedido: pertence ao pedido do item oficial.
  const ownLines = own.filter(
    (link) =>
      link.salesOrderItemId != null ||
      ![...(officialClaims.get(link.stockDocumentItemId) ?? [])].some((id) => id !== bundle.localOrderId)
  );
  const allocationLines: InvoiceAllocationLineInput[] = ownLines.map((link) => ({
    stockDocumentItemId: link.stockDocumentItemId,
    stockDocumentExternalId: link.stockDocumentExternalId,
    nfeExternalId: nfeOfDocument.get(link.stockDocumentExternalId) ?? null,
    documentValid: link.documentValidity === "VALID",
    belongsToOrder: link.salesOrderId === bundle.localOrderId,
    salesOrderItemId: link.salesOrderItemId,
    quantity: link.quantity,
    sourceType: link.sourceType,
    itemCoverage: link.itemCoverage,
    claimedByOtherOrders: [...(claims.get(link.stockDocumentItemId) ?? [])].some((id) => id !== bundle.localOrderId),
  }));
  return resolveOrderInvoiceAllocation({ items, nfes, lines: allocationLines, singleNfeBillingProof });
}
