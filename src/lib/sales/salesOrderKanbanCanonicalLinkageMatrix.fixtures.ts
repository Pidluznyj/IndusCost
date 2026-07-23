/**
 * KAN-LINK-09 — Fixtures da matriz canônica Pedido → OP → DS → NF → Envio → Kanban.
 * Puro: sem I/O. Valores PD 02757 / 4525 / 7394 só aqui (teste/fixture).
 */

import {
  assembleSalesOrderFlowEvidenceBatch,
  type AssembleSalesOrderFlowEvidenceBatchInput,
  type SalesOrderFlowEvidencePack,
} from "./salesOrderFlowEvidence.js";

export const MATRIX_ORDER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
export const MATRIX_ORDER_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02";
export const MATRIX_ITEM_10 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10";
export const MATRIX_ITEM_20 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb20";
export const MATRIX_ITEM_B10 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb30";
export const MATRIX_EXT_ORDER = 2757;
export const MATRIX_EXT_ORDER_B = 2000;
export const MATRIX_EXT_ITEM_10 = 9010;
export const MATRIX_EXT_ITEM_20 = 9020;
export const MATRIX_EXT_PROD_10 = 5010;
export const MATRIX_EXT_PROD_20 = 5020;
export const MATRIX_DS_4525 = 4525;
export const MATRIX_NFE_7394 = 9001;
export const MATRIX_NFE_NUMERO = "7394";
export const MATRIX_NFE_SERIE = "2";

export type MatrixPackOptions = {
  orderCode?: string;
  orderId?: string;
  fulfilled?: boolean;
  withOp?: boolean;
  opPartial?: boolean;
  multiOp?: boolean;
  withDs?: boolean;
  dsPartial?: boolean;
  multiDs?: boolean;
  dsCancelled?: boolean;
  dsReturn?: boolean;
  withNfe?: boolean;
  nfeStatus?: number;
  nfeCancelled?: boolean;
  nfeRejected?: boolean;
  nfeViaLink?: boolean;
  nfeWithoutLocalDs?: boolean;
  cut?: boolean;
  partialCancel?: boolean;
  excessDocument?: boolean;
  ambiguousLine?: boolean;
  unresolvedLine?: boolean;
  multiOrderDs?: boolean;
  unitIncompatible?: boolean;
  orphanNfeLink?: boolean;
  secondItemBare?: boolean;
};

function baseItems(orderId: string, options: MatrixPackOptions) {
  const fulfilled = options.fulfilled === true;
  const cut = options.cut === true;
  const partialCancel = options.partialCancel === true;
  return [
    {
      id: MATRIX_ITEM_10,
      salesOrderId: orderId,
      productId: "p10",
      externalProductId: MATRIX_EXT_PROD_10,
      nomusItemExternalId: MATRIX_EXT_ITEM_10,
      nomusItemSequence: "00010",
      skuSnapshot: "SKU-A",
      productNameSnapshot: "Item 10",
      quantity: 114,
      nomusQuantityFulfilled: cut ? 80 : fulfilled ? 114 : partialCancel ? 0 : 0,
      nomusItemStatusRaw: cut ? "5" : fulfilled ? "4" : partialCancel ? "6" : "1",
      nomusItemStatusNormalized: cut
        ? "FULFILLED_WITH_CUT"
        : fulfilled
          ? "FULFILLED"
          : partialCancel
            ? "CANCELED"
            : "RELEASED",
      nomusIsCut: cut ? true : null,
      nomusIsCanceled: partialCancel ? true : null,
    },
    {
      id: MATRIX_ITEM_20,
      salesOrderId: orderId,
      productId: "p20",
      externalProductId: MATRIX_EXT_PROD_20,
      nomusItemExternalId: MATRIX_EXT_ITEM_20,
      nomusItemSequence: "00020",
      skuSnapshot: "SKU-B",
      productNameSnapshot: "Item 20",
      quantity: 360,
      nomusQuantityFulfilled: fulfilled ? 360 : 0,
      nomusItemStatusRaw: fulfilled ? "4" : "1",
      nomusItemStatusNormalized: fulfilled ? "FULFILLED" : "RELEASED",
    },
  ];
}

/** Pack equivalente ao cenário PD 02757 (e variantes da matriz). */
export function buildCanonicalLinkageMatrixPack(
  options: MatrixPackOptions = {}
): SalesOrderFlowEvidencePack {
  const orderId = options.orderId ?? MATRIX_ORDER_A;
  const orderCode = options.orderCode ?? "PD 02757";
  const withDs = options.withDs !== false;
  const withNfe =
    options.withNfe === true ||
    (options.withNfe !== false &&
      withDs &&
      !options.dsPartial &&
      !options.dsCancelled &&
      !options.dsReturn);
  const nfeStatus = options.nfeRejected
    ? 3
    : options.nfeCancelled
      ? 7
      : (options.nfeStatus ?? 4);
  const dsQty20 = options.excessDocument
    ? 500
    : options.dsPartial
      ? 100
      : 360;

  const stockDocuments: AssembleSalesOrderFlowEvidenceBatchInput["stockDocuments"] =
    [];
  const stockDocumentItems: AssembleSalesOrderFlowEvidenceBatchInput["stockDocumentItems"] =
    [];

  if (withDs) {
    stockDocuments.push({
      id: "ds-4525",
      externalId: MATRIX_DS_4525,
      idNfe: options.nfeWithoutLocalDs ? null : withNfe ? MATRIX_NFE_7394 : null,
      statusRaw: options.dsCancelled
        ? "cancelado"
        : options.dsReturn
          ? "devolucao"
          : "emitido",
      isCancelled: options.dsCancelled === true,
      tipoDocumentoEstoque: options.dsReturn ? "DEVOLUCAO" : "SAIDA",
      externalSalesOrderId: MATRIX_EXT_ORDER,
      orderCodeNormalized: "PD02757",
      totalValue: 12650.4,
    });
    stockDocumentItems.push({
      id: "dsi-10",
      stockDocumentId: "ds-4525",
      // Produto inexistente + sem id/seq → item não resolvido (cenário 13).
      externalProductId: options.unresolvedLine
        ? 888888
        : MATRIX_EXT_PROD_10,
      quantity: 114,
      externalSalesOrderId: MATRIX_EXT_ORDER,
      externalSalesOrderItemId: options.unresolvedLine
        ? null
        : MATRIX_EXT_ITEM_10,
      salesOrderItemSequence: options.unresolvedLine ? null : "00010",
      orderCodeNormalized: "PD02757",
      unitCode: options.unitIncompatible ? "KG" : "UN",
    });
    stockDocumentItems.push({
      id: "dsi-20",
      stockDocumentId: "ds-4525",
      externalProductId: options.ambiguousLine
        ? 999999
        : options.unresolvedLine
          ? 888889
          : MATRIX_EXT_PROD_20,
      quantity: dsQty20,
      externalSalesOrderId: MATRIX_EXT_ORDER,
      externalSalesOrderItemId: options.ambiguousLine
        ? null
        : options.unresolvedLine
          ? null
          : MATRIX_EXT_ITEM_20,
      salesOrderItemSequence: options.ambiguousLine
        ? null
        : options.unresolvedLine
          ? null
          : "00020",
      orderCodeNormalized: "PD02757",
      unitCode: "UN",
    });
  }

  if (options.multiDs) {
    stockDocuments.push({
      id: "ds-4526",
      externalId: 4526,
      idNfe: null,
      statusRaw: "emitido",
      isCancelled: false,
      externalSalesOrderId: MATRIX_EXT_ORDER,
      orderCodeNormalized: "PD02757",
    });
    stockDocumentItems.push({
      id: "dsi-20b",
      stockDocumentId: "ds-4526",
      externalProductId: MATRIX_EXT_PROD_20,
      quantity: 50,
      externalSalesOrderId: MATRIX_EXT_ORDER,
      externalSalesOrderItemId: MATRIX_EXT_ITEM_20,
      salesOrderItemSequence: "00020",
      orderCodeNormalized: "PD02757",
    });
  }

  if (options.multiOrderDs) {
    stockDocuments.push({
      id: "ds-multi",
      externalId: 9900,
      idNfe: null,
      statusRaw: "emitido",
      isCancelled: false,
      externalSalesOrderId: null,
      orderCodeNormalized: null,
    });
    stockDocumentItems.push(
      {
        id: "dsi-multi-a",
        stockDocumentId: "ds-multi",
        externalProductId: MATRIX_EXT_PROD_10,
        quantity: 10,
        externalSalesOrderId: MATRIX_EXT_ORDER,
        externalSalesOrderItemId: MATRIX_EXT_ITEM_10,
        salesOrderItemSequence: "00010",
        orderCodeNormalized: "PD02757",
      },
      {
        id: "dsi-multi-b",
        stockDocumentId: "ds-multi",
        externalProductId: MATRIX_EXT_PROD_10,
        quantity: 10,
        externalSalesOrderId: MATRIX_EXT_ORDER_B,
        externalSalesOrderItemId: 9910,
        salesOrderItemSequence: "00010",
        orderCodeNormalized: "PD02000",
      }
    );
  }

  const productionOrders: AssembleSalesOrderFlowEvidenceBatchInput["productionOrders"] =
    [];
  const productionLinks: AssembleSalesOrderFlowEvidenceBatchInput["productionLinks"] =
    [];

  if (options.withOp || options.multiOp || options.opPartial) {
    const qty = options.opPartial ? 40 : 114;
    productionOrders.push({
      id: "op-1",
      externalId: 8801,
      status: "ABERTA",
      quantity: qty,
      productCode: "SKU-A",
    });
    productionLinks.push({
      id: "opl-1",
      productionOrderId: "op-1",
      productionOrderExternalId: 8801,
      salesOrderId: orderId,
      salesOrderItemId: MATRIX_ITEM_10,
      externalSalesOrderId: MATRIX_EXT_ORDER,
      externalSalesOrderItemId: MATRIX_EXT_ITEM_10,
      linkedQuantity: qty,
      isCurrent: true,
    });
  }
  if (options.multiOp) {
    productionOrders.push({
      id: "op-2",
      externalId: 8802,
      status: "ABERTA",
      quantity: 74,
      productCode: "SKU-A",
    });
    productionLinks.push({
      id: "opl-2",
      productionOrderId: "op-2",
      productionOrderExternalId: 8802,
      salesOrderId: orderId,
      salesOrderItemId: MATRIX_ITEM_10,
      externalSalesOrderId: MATRIX_EXT_ORDER,
      externalSalesOrderItemId: MATRIX_EXT_ITEM_10,
      linkedQuantity: 74,
      isCurrent: true,
    });
  }

  const nfeLinks: AssembleSalesOrderFlowEvidenceBatchInput["nfeLinks"] = [];
  const nomusNfes: AssembleSalesOrderFlowEvidenceBatchInput["nomusNfes"] = [];

  if (withNfe || options.nfeViaLink || options.orphanNfeLink) {
    nfeLinks.push({
      id: "nl1",
      salesOrderId: options.orphanNfeLink ? MATRIX_ORDER_B : orderId,
      nfeExternalId: MATRIX_NFE_7394,
      nfeNumber: MATRIX_NFE_NUMERO,
      // Manter status do link alinhado ao Nomus (evita preferredStatus=100).
      nfeStatus: options.nfeCancelled || options.nfeRejected ? nfeStatus : 100,
    });
    nomusNfes.push({
      id: "nfe1",
      externalId: MATRIX_NFE_7394,
      numero: MATRIX_NFE_NUMERO,
      serie: MATRIX_NFE_SERIE,
      status: nfeStatus,
    });
  }

  if (options.nfeWithoutLocalDs && !withDs) {
    // NF sem DS local: só link + nfe.
    if (nfeLinks.length === 0) {
      nfeLinks.push({
        id: "nl1",
        salesOrderId: orderId,
        nfeExternalId: MATRIX_NFE_7394,
        nfeNumber: MATRIX_NFE_NUMERO,
        nfeStatus: 100,
      });
      nomusNfes.push({
        id: "nfe1",
        externalId: MATRIX_NFE_7394,
        numero: MATRIX_NFE_NUMERO,
        serie: MATRIX_NFE_SERIE,
        status: 4,
      });
    }
  }

  const input: AssembleSalesOrderFlowEvidenceBatchInput = {
    orders: [
      {
        id: orderId,
        orderCode,
        status: "SENT_TO_NOMUS",
        customerId: "c1",
        externalSalesOrderId: MATRIX_EXT_ORDER,
        expectedDeliveryDate: null,
        totalNetValue: 12650.4,
        items: baseItems(orderId, options),
      },
    ],
    products: [
      {
        id: "p10",
        type: "PRODUCT",
        costingMode: "BOM_ONLY",
        hasProductRouting: true,
        hasProductBom: true,
      },
      {
        id: "p20",
        type: "PRODUCT",
        costingMode: "BOM_ONLY",
        hasProductRouting: true,
        hasProductBom: true,
      },
    ],
    nfeLinks,
    nomusNfes,
    stockDocuments,
    stockDocumentItems,
    productionOrders,
    productionLinks,
  };

  if (options.multiOrderDs) {
    input.orders.push({
      id: MATRIX_ORDER_B,
      orderCode: "PD 02000",
      status: "SENT_TO_NOMUS",
      customerId: "c2",
      externalSalesOrderId: MATRIX_EXT_ORDER_B,
      expectedDeliveryDate: null,
      totalNetValue: 100,
      items: [
        {
          id: MATRIX_ITEM_B10,
          salesOrderId: MATRIX_ORDER_B,
          productId: "p10",
          externalProductId: MATRIX_EXT_PROD_10,
          nomusItemExternalId: 9910,
          nomusItemSequence: "00010",
          skuSnapshot: "SKU-A",
          productNameSnapshot: "Item 10 B",
          quantity: 10,
          nomusQuantityFulfilled: 0,
          nomusItemStatusRaw: "1",
          nomusItemStatusNormalized: "RELEASED",
        },
      ],
    });
  }

  return assembleSalesOrderFlowEvidenceBatch(input).get(orderId)!;
}

/** Segundo pedido com o mesmo produto (cenário 25). */
export function buildSameProductDifferentOrdersPacks(): {
  packA: SalesOrderFlowEvidencePack;
  packB: SalesOrderFlowEvidencePack;
} {
  const packA = buildCanonicalLinkageMatrixPack({
    orderCode: "PD 10001",
    withDs: false,
    withNfe: false,
    withOp: true,
  });
  const packB = buildCanonicalLinkageMatrixPack({
    orderId: MATRIX_ORDER_B,
    orderCode: "PD 10002",
    withDs: false,
    withNfe: false,
    withOp: true,
  });
  // Force same product external id on B's OP link path via shared products.
  return { packA, packB };
}
