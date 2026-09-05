import { stableNomusPayloadHash } from "@/src/lib/nomusAccountsReceivableMapper.js";
import {
  classifyNomusPurchaseOrderStage,
  mapNomusPurchaseOrderItemStatus,
} from "./nomusPurchaseOrderClassifier.js";
import {
  pickFirstBoolean,
  pickFirstDate,
  pickFirstDateTime,
  pickFirstInt,
  pickFirstMoney,
  pickFirstString,
  pickPurchaseOrderItemsArray,
  sumNullable,
} from "./nomusPurchaseOrderParser.js";
import type {
  JsonObject,
  MapNomusPurchaseOrderResult,
  MappedNomusPurchaseOrder,
  MappedNomusPurchaseOrderItem,
} from "./nomusPurchaseOrderTypes.js";

export { stableNomusPayloadHash };

const HEADER_ID_KEYS = ["id", "idPedidoCompra", "idPedido", "codigoInterno"] as const;
const ORDER_NUMBER_KEYS = ["codigoPedido", "numero", "numeroPedido", "codigo", "pedido", "numeroDocumento"] as const;
const SUPPLIER_ID_KEYS = ["idPessoaFornecedor", "idFornecedor", "idPessoa", "idFornecedorPessoa"] as const;
const SUPPLIER_NAME_KEYS = ["nomeFornecedor", "nomePessoa", "fornecedor"] as const;
const SUPPLIER_TAX_KEYS = ["cnpjFornecedor", "cnpjPessoa", "cpfCnpj", "cpfCnpjPessoa", "documentoFornecedor"] as const;
const STATUS_KEYS = ["status", "situacao", "statusPedido", "descricaoStatus"] as const;
const CANCELED_KEYS = ["cancelado", "cancelada", "isCancelado"] as const;
const ISSUED_KEYS = ["dataEmissao", "data", "dataPedido"] as const;
const EXPECTED_KEYS = ["dataEntregaPadrao", "dataPrevisao", "dataEntrega", "previsaoEntrega", "dataPrevisaoEntrega"] as const;
const CREATED_KEYS = ["dataCriacao", "dataHoraCriacao"] as const;
const MODIFIED_KEYS = ["dataModificacao", "atualizadoEm", "dataAtualizacao"] as const;
const PAYMENT_KEYS = ["condicaoPagamentoTexto", "condicaoPagamento", "nomeFormaPagamento", "formaPagamento"] as const;
const COMMENT_KEYS = ["observacoes", "comentarios", "observacao"] as const;
const CURRENCY_KEYS = ["moeda", "siglaMoeda"] as const;
const TOTAL_KEYS = ["valorTotal", "valor", "total"] as const;
const DISCOUNT_KEYS = ["valorDesconto", "desconto"] as const;
const FREIGHT_KEYS = ["valorTotalFrete", "valorFrete", "frete"] as const;

const LINE_ID_KEYS = ["id", "idItem", "idLinha", "sequencia"] as const;
const PRODUCT_ID_KEYS = ["idProduto", "idMaterial", "idItemProduto"] as const;
const PRODUCT_CODE_KEYS = ["codigoProduto", "codigo", "codigoItem"] as const;
const DESCRIPTION_KEYS = ["descricao", "nomeProduto", "descricaoProduto"] as const;
const UNIT_KEYS = ["unidade", "unidadeMedida", "siglaUnidade"] as const;
const ORDERED_QTY_KEYS = ["quantidade", "qtde", "quantidadePedida", "qtdePedida"] as const;
const RECEIVED_QTY_KEYS = ["quantidadeAtendida", "quantidadeRecebida", "qtdeAtendida", "qtdeRecebida"] as const;
const REMAINING_QTY_KEYS = ["saldo", "quantidadeSaldo", "qtdeSaldo"] as const;
const UNIT_PRICE_KEYS = ["valorUnitario", "precoUnitario"] as const;
const LINE_TOTAL_KEYS = ["valorTotal", "valor", "total"] as const;

function remainingFromQuantities(
  ordered: number | null,
  received: number | null,
  remaining: number | null
): number | null {
  if (remaining != null) return remaining;
  if (ordered == null || received == null) return null;
  return ordered - received;
}

export function mapNomusPurchaseOrderItemPayload(
  raw: JsonObject,
  lineIndex: number
): MappedNomusPurchaseOrderItem {
  const orderedQuantity = pickFirstMoney(raw, ORDERED_QTY_KEYS);
  const receivedQuantity = pickFirstMoney(raw, RECEIVED_QTY_KEYS);
  const remainingQuantity = remainingFromQuantities(
    orderedQuantity,
    receivedQuantity,
    pickFirstMoney(raw, REMAINING_QTY_KEYS)
  );

  const itemStatus = mapNomusPurchaseOrderItemStatus(raw.status);

  return {
    lineIndex,
    lineExternalId: pickFirstInt(raw, LINE_ID_KEYS),
    lineCode: pickFirstString(raw, ["item"]),
    itemStatusCode: itemStatus.code,
    itemStatusKey: itemStatus.key,
    productExternalId: pickFirstInt(raw, PRODUCT_ID_KEYS),
    productCode: pickFirstString(raw, PRODUCT_CODE_KEYS),
    description: pickFirstString(raw, DESCRIPTION_KEYS),
    unit: pickFirstString(raw, UNIT_KEYS),
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    unitPrice: pickFirstMoney(raw, UNIT_PRICE_KEYS),
    totalAmount: pickFirstMoney(raw, LINE_TOTAL_KEYS),
    rawPayload: raw,
    payloadHash: stableNomusPayloadHash(raw),
  };
}

export function mapNomusPurchaseOrderPayload(raw: JsonObject): MapNomusPurchaseOrderResult {
  const externalId = pickFirstInt(raw, HEADER_ID_KEYS);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const items = pickPurchaseOrderItemsArray(raw).map((item, index) =>
    mapNomusPurchaseOrderItemPayload(item, index)
  );

  const orderedQuantity =
    pickFirstMoney(raw, ["quantidadeTotal", "quantidadePedidaTotal"]) ??
    sumNullable(items.map((item) => item.orderedQuantity));
  const receivedQuantity =
    pickFirstMoney(raw, ["quantidadeAtendidaTotal", "quantidadeRecebidaTotal"]) ??
    sumNullable(items.map((item) => item.receivedQuantity));
  const remainingQuantity = remainingFromQuantities(
    orderedQuantity,
    receivedQuantity,
    pickFirstMoney(raw, ["saldoTotal", "quantidadeSaldoTotal"])
  );

  const canceled = pickFirstBoolean(raw, CANCELED_KEYS);
  const statusRaw = pickFirstString(raw, STATUS_KEYS);
  const stage = classifyNomusPurchaseOrderStage({
    canceled,
    statusRaw,
    orderedQuantity,
    receivedQuantity,
    itemStatusCodes: items.map((item) => item.itemStatusCode),
  });

  const row: MappedNomusPurchaseOrder = {
    externalId,
    orderNumber: pickFirstString(raw, ORDER_NUMBER_KEYS),
    supplierExternalId: pickFirstInt(raw, SUPPLIER_ID_KEYS),
    supplierName: pickFirstString(raw, SUPPLIER_NAME_KEYS),
    supplierTaxId: pickFirstString(raw, SUPPLIER_TAX_KEYS),
    statusRaw,
    canceled,
    stage,
    issuedAt: pickFirstDate(raw, ISSUED_KEYS),
    expectedAt: pickFirstDate(raw, EXPECTED_KEYS),
    createdAtNomus: pickFirstDateTime(raw, CREATED_KEYS),
    modifiedAtNomus: pickFirstDateTime(raw, MODIFIED_KEYS),
    paymentTerms: pickFirstString(raw, PAYMENT_KEYS),
    comments: pickFirstString(raw, COMMENT_KEYS),
    currency: pickFirstString(raw, CURRENCY_KEYS),
    totalAmount: pickFirstMoney(raw, TOTAL_KEYS),
    discountAmount: pickFirstMoney(raw, DISCOUNT_KEYS),
    freightAmount: pickFirstMoney(raw, FREIGHT_KEYS),
    itemCount: items.length,
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    rawPayload: raw,
    payloadHash: stableNomusPayloadHash(raw),
    items,
  };

  return { ok: true, row };
}
