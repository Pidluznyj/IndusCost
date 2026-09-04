/**
 * PURCH-MIRROR-01 — Parsing defensivo + hash canônico do payload bruto do
 * Pedido de Compra Nomus.
 *
 * Contrato do endpoint /rest/pedidoscompra ainda não foi validado contra a
 * conta real (ver docs/NOMUS_PURCHASE_ORDERS_MIRROR.md "Incertezas"). Os
 * nomes de campo abaixo seguem a convenção observada nos outros coletores
 * Nomus do repositório (pt-BR, "idX"/"dataX"/"valorX") e no padrão de
 * Pedidos de Venda (idProduto, idPedido, dataEmissao). Cada campo é lido por
 * uma lista de candidatos (fallback), nunca inventado quando ausente — campo
 * ausente vira `null`, nunca 0/""/"null".
 *
 * Função pura — sem I/O, sem Prisma.
 */

import { createHash } from "node:crypto";

function firstDefined(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(
      /,\d{1,2}$/.test(trimmed) ? normalized : trimmed
    );
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIntOrNull(value: unknown): number | null {
  const n = asNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asDateOrNull(value: unknown): Date | null {
  const s = asStringOrNull(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Localiza o array de itens dentro de nomes de campo candidatos. */
function pickItemsArray(obj: Record<string, unknown>): unknown[] {
  const candidates = ["itens", "itensPedido", "items", "linhas"];
  for (const key of candidates) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export type NomusPurchaseOrderMappedHeader = {
  externalId: number | null;
  code: string | null;
  externalCompanyId: number | null;
  companyCode: string | null;
  companyName: string | null;
  externalSupplierId: number | null;
  supplierNameSnapshot: string | null;
  supplierDocumentSnapshot: string | null;
  externalBuyerId: number | null;
  buyerNameSnapshot: string | null;
  issueDate: Date | null;
  expectedDeliveryDate: Date | null;
  paymentConditionId: number | null;
  paymentConditionText: string | null;
  paymentMethodId: number | null;
  paymentMethodText: string | null;
  freightValue: number | null;
  insuranceValue: number | null;
  otherExpensesValue: number | null;
  discountValue: number | null;
  subtotalValue: number | null;
  totalValue: number | null;
  nomusStatusCode: string | null;
};

export type NomusPurchaseOrderMappedItem = {
  externalItemId: number | null;
  /** Sequência/posição bruta como veio no payload (pode ser string). */
  sequenceRaw: string | null;
  externalProductId: number | null;
  productCodeSnapshot: string | null;
  productDescriptionSnapshot: string | null;
  unitSnapshot: string | null;
  quantityOrdered: number | null;
  quantityAttended: number | null;
  quantityPending: number | null;
  unitPrice: number | null;
  discountPercent: number | null;
  discountValue: number | null;
  lineTotal: number | null;
  expectedDeliveryDate: Date | null;
  nomusStatusCode: string | null;
  nomusStatusName: string | null;
  rawItem: Record<string, unknown>;
};

export type NomusPurchaseOrderMapped = {
  header: NomusPurchaseOrderMappedHeader;
  items: NomusPurchaseOrderMappedItem[];
  raw: Record<string, unknown>;
};

/** Mapeia um pedido bruto (list ou detail) para os campos normalizados. */
export function mapNomusPurchaseOrderPayload(
  raw: unknown
): NomusPurchaseOrderMapped {
  const obj = isObject(raw) ? raw : {};

  const header: NomusPurchaseOrderMappedHeader = {
    externalId: asIntOrNull(
      firstDefined(obj, ["id", "idPedido", "idPedidoCompra", "codigo"])
    ),
    code: asStringOrNull(
      firstDefined(obj, ["codigoPedido", "numero", "numeroPedido", "codigo"])
    ),
    externalCompanyId: asIntOrNull(
      firstDefined(obj, ["idEmpresa", "idFilial", "idCompany"])
    ),
    companyCode: asStringOrNull(firstDefined(obj, ["codigoEmpresa", "filial"])),
    companyName: asStringOrNull(firstDefined(obj, ["nomeEmpresa", "empresa"])),
    externalSupplierId: asIntOrNull(
      firstDefined(obj, ["idFornecedor", "idPessoaFornecedor", "idPessoa"])
    ),
    supplierNameSnapshot: asStringOrNull(
      firstDefined(obj, ["nomeFornecedor", "fornecedor", "razaoSocialFornecedor"])
    ),
    supplierDocumentSnapshot: asStringOrNull(
      firstDefined(obj, ["cnpjFornecedor", "documentoFornecedor", "cpfCnpjFornecedor"])
    ),
    externalBuyerId: asIntOrNull(
      firstDefined(obj, ["idComprador", "idUsuarioComprador", "idResponsavel"])
    ),
    buyerNameSnapshot: asStringOrNull(
      firstDefined(obj, ["nomeComprador", "comprador", "responsavel"])
    ),
    issueDate: asDateOrNull(
      firstDefined(obj, ["dataEmissao", "dataPedido", "dataInclusao"])
    ),
    expectedDeliveryDate: asDateOrNull(
      firstDefined(obj, ["dataPrevisaoEntrega", "dataEntrega", "previsaoEntrega"])
    ),
    paymentConditionId: asIntOrNull(
      firstDefined(obj, ["idCondicaoPagamento", "idCondPagamento"])
    ),
    paymentConditionText: asStringOrNull(
      firstDefined(obj, ["condicaoPagamento", "descricaoCondicaoPagamento"])
    ),
    paymentMethodId: asIntOrNull(firstDefined(obj, ["idFormaPagamento"])),
    paymentMethodText: asStringOrNull(
      firstDefined(obj, ["formaPagamento", "descricaoFormaPagamento"])
    ),
    freightValue: asNumberOrNull(firstDefined(obj, ["valorFrete", "frete"])),
    insuranceValue: asNumberOrNull(firstDefined(obj, ["valorSeguro", "seguro"])),
    otherExpensesValue: asNumberOrNull(
      firstDefined(obj, ["valorOutrasDespesas", "outrasDespesas"])
    ),
    discountValue: asNumberOrNull(
      firstDefined(obj, ["valorDesconto", "desconto"])
    ),
    subtotalValue: asNumberOrNull(
      firstDefined(obj, ["valorSubtotal", "subtotal"])
    ),
    totalValue: asNumberOrNull(firstDefined(obj, ["valorTotal", "total"])),
    nomusStatusCode: asStringOrNull(firstDefined(obj, ["status", "idStatus"])),
  };

  const rawItems = pickItemsArray(obj);
  const items: NomusPurchaseOrderMappedItem[] = rawItems.map((rawItem, index) => {
    const itemObj = isObject(rawItem) ? rawItem : {};
    return {
      externalItemId: asIntOrNull(
        firstDefined(itemObj, ["id", "idItem", "idItemPedido"])
      ),
      sequenceRaw: asStringOrNull(
        firstDefined(itemObj, ["sequencia", "numero", "ordem"])
      ) ?? String(index + 1),
      externalProductId: asIntOrNull(
        firstDefined(itemObj, ["idProduto", "idMaterial"])
      ),
      productCodeSnapshot: asStringOrNull(
        firstDefined(itemObj, ["codigoProduto", "codigo"])
      ),
      productDescriptionSnapshot: asStringOrNull(
        firstDefined(itemObj, ["descricaoProduto", "descricao", "nomeProduto"])
      ),
      unitSnapshot: asStringOrNull(firstDefined(itemObj, ["unidade", "un"])),
      quantityOrdered: asNumberOrNull(
        firstDefined(itemObj, ["quantidade", "quantidadePedida"])
      ),
      quantityAttended: asNumberOrNull(
        firstDefined(itemObj, ["quantidadeAtendida", "quantidadeEntregue"])
      ),
      quantityPending: asNumberOrNull(
        firstDefined(itemObj, ["quantidadePendente", "saldoQuantidade"])
      ),
      unitPrice: asNumberOrNull(
        firstDefined(itemObj, ["precoUnitario", "valorUnitario"])
      ),
      discountPercent: asNumberOrNull(
        firstDefined(itemObj, ["percentualDesconto", "descontoPercentual"])
      ),
      discountValue: asNumberOrNull(
        firstDefined(itemObj, ["valorDesconto", "desconto"])
      ),
      lineTotal: asNumberOrNull(
        firstDefined(itemObj, ["valorTotal", "total"])
      ),
      expectedDeliveryDate: asDateOrNull(
        firstDefined(itemObj, ["dataPrevisaoEntrega", "dataEntrega"])
      ),
      nomusStatusCode: asStringOrNull(
        firstDefined(itemObj, ["status", "idStatus"])
      ),
      nomusStatusName: asStringOrNull(
        firstDefined(itemObj, ["descricaoStatus", "nomeStatus"])
      ),
      rawItem: itemObj,
    };
  });

  return { header, items, raw: obj };
}

/**
 * Chave natural estável de item quando o Nomus não fornece um id de linha
 * confiável: `lineNumber` (posição 1-based dentro do pedido, na ordem em que
 * o payload retorna os itens). Documentado: não é ideal se o Nomus
 * reordenar os itens entre execuções, mas é a única chave determinística
 * disponível sem inventar um UUID aleatório a cada sync (que quebraria
 * idempotência). Se o payload trouxer id de linha (`externalItemId`),
 * ele é preferido pelo chamador — este helper só resolve o `lineNumber`.
 */
export function resolveNomusPurchaseOrderItemLineNumber(
  item: NomusPurchaseOrderMappedItem,
  indexInOrder: number
): number {
  const fromSequence = Number.parseInt(item.sequenceRaw ?? "", 10);
  if (Number.isFinite(fromSequence) && fromSequence > 0) return fromSequence;
  return indexInOrder + 1;
}

/**
 * Canonicaliza um objeto JSON recursivamente (chaves ordenadas) para que o
 * hash seja estável independentemente da ordem de serialização da origem.
 * Não inclui timestamps locais de sync (payloadHash é hash da FONTE, não da
 * execução — nunca usar campos de sync como syncedAt/lastSeenAt aqui).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = canonicalize(v);
    return out;
  }
  return value;
}

/** Hash canônico e estável do payload bruto de um pedido (cabeçalho+itens). */
export function stableNomusPurchaseOrderPayloadHash(raw: unknown): string {
  const canonical = canonicalize(raw);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}

/** Hash canônico de um item isolado (usado para detectar mudança por linha). */
export function stableNomusPurchaseOrderItemPayloadHash(rawItem: unknown): string {
  return stableNomusPurchaseOrderPayloadHash(rawItem);
}
