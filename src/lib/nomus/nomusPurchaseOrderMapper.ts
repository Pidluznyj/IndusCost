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
const INSURANCE_KEYS = ["valorTotalSeguro"] as const;
const OTHER_EXPENSES_KEYS = ["valorTotalOutrasDespesasAcessorias"] as const;
const LINE_DISCOUNT_AMOUNT_KEYS = ["valorDesconto"] as const;
const LINE_DISCOUNT_PERCENT_KEYS = ["percentualDesconto"] as const;
const LINE_SURCHARGE_AMOUNT_KEYS = ["valorAcrescimo"] as const;
const LINE_SURCHARGE_PERCENT_KEYS = ["percentualAcrescimo"] as const;

function remainingFromQuantities(
  ordered: number | null,
  received: number | null,
  remaining: number | null
): number | null {
  if (remaining != null) return remaining;
  if (ordered == null || received == null) return null;
  return ordered - received;
}

/** HALF-UP em 2 casas — mesma escala de `NomusPurchaseOrder.totalAmount` (Decimal 20,2). */
export function roundNomusMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100 + Number.EPSILON) / 100;
}

/**
 * Ajustes comerciais oficiais da linha Nomus. Prefere valor absoluto a percentual
 * quando ambos existem. Não inventa desconto/acréscimo ausente.
 */
function applyLineCommercialAdjustments(base: number, raw: JsonObject): number {
  const discountAmount = pickFirstMoney(raw, LINE_DISCOUNT_AMOUNT_KEYS);
  const discountPercent = pickFirstMoney(raw, LINE_DISCOUNT_PERCENT_KEYS);
  const surchargeAmount = pickFirstMoney(raw, LINE_SURCHARGE_AMOUNT_KEYS);
  const surchargePercent = pickFirstMoney(raw, LINE_SURCHARGE_PERCENT_KEYS);
  let value = base;
  if (discountAmount != null) value -= discountAmount;
  else if (discountPercent != null) value -= (value * discountPercent) / 100;
  if (surchargeAmount != null) value += surchargeAmount;
  else if (surchargePercent != null) value += (value * surchargePercent) / 100;
  return value;
}

/**
 * Valor canônico da linha.
 *
 * 1. `valorTotal` oficial da linha, se o Nomus enviar.
 * 2. Senão, `quantidade × valorUnitario` ± desconto/acréscimo oficiais da linha.
 *
 * Não usa `parcelas` (cronograma de pagamento ≠ valor da mercadoria).
 */
export function resolveNomusPurchaseOrderItemTotalAmount(
  raw: JsonObject,
  orderedQuantity: number | null,
  unitPrice: number | null
): number | null {
  const official = pickFirstMoney(raw, LINE_TOTAL_KEYS);
  if (official != null) return official;
  if (orderedQuantity == null || unitPrice == null) return null;
  return roundNomusMoney(applyLineCommercialAdjustments(orderedQuantity * unitPrice, raw));
}

export type NomusPurchaseOrderHeaderTotalSource = "header_valor_total" | "derived_lines_plus_accessories";

/**
 * Valor canônico do cabeçalho.
 *
 * 1. `valorTotal`/`valor`/`total` oficial, se o Nomus enviar.
 * 2. Senão, soma das linhas valoradas + frete + seguro + outras despesas − desconto
 *    de cabeçalho. Campos acessórios ausentes entram como 0 (não fabricam total
 *    quando nenhuma linha tem valor).
 *
 * `parcelas[].valorParcela` não é autoridade de valor comprado.
 */
export function resolveNomusPurchaseOrderHeaderTotalAmount(
  raw: JsonObject,
  items: ReadonlyArray<{ totalAmount: number | null }>
): { value: number | null; source: NomusPurchaseOrderHeaderTotalSource | null } {
  const official = pickFirstMoney(raw, TOTAL_KEYS);
  if (official != null) return { value: official, source: "header_valor_total" };
  const lineSum = sumNullable(items.map((item) => item.totalAmount));
  if (lineSum == null) return { value: null, source: null };
  const freight = pickFirstMoney(raw, FREIGHT_KEYS) ?? 0;
  const insurance = pickFirstMoney(raw, INSURANCE_KEYS) ?? 0;
  const other = pickFirstMoney(raw, OTHER_EXPENSES_KEYS) ?? 0;
  const discount = pickFirstMoney(raw, DISCOUNT_KEYS) ?? 0;
  return {
    value: roundNomusMoney(lineSum + freight + insurance + other - discount),
    source: "derived_lines_plus_accessories",
  };
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
  const unitPrice = pickFirstMoney(raw, UNIT_PRICE_KEYS);

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
    unitPrice,
    totalAmount: resolveNomusPurchaseOrderItemTotalAmount(raw, orderedQuantity, unitPrice),
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
    totalAmount: resolveNomusPurchaseOrderHeaderTotalAmount(raw, items).value,
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
