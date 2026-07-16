/**
 * Mapper puro: payload Nomus `/rest/ordens` → stage local.
 * Quantidades Nomus: "15.400" → 15400; "15.000" → 15000.
 * Vínculo oficial somente via itensPedido[].idPedido e itensPedido[].id.
 */

import { Prisma } from "@prisma/client";
import { asString, toInt } from "@/src/lib/nomusAccountsReceivableParser.js";
import { parseNomusPtBrNumber } from "@/scripts/nomusNumberParser.js";

export type JsonObject = Record<string, unknown>;

export type MappedNomusProductionOrderSalesLink = {
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemSequence: string | null;
  customerName: string | null;
  linkQuantity: Prisma.Decimal | null;
  rawJson: JsonObject;
};

export type MappedNomusProductionOrder = {
  externalId: number;
  name: string | null;
  status: string | null;
  tipo: string | null;
  productCode: string | null;
  externalProductId: number | null;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  companyName: string | null;
  rawJson: JsonObject;
  salesLinks: MappedNomusProductionOrderSalesLink[];
};

export type MapProductionOrderResult =
  | { ok: true; row: MappedNomusProductionOrder }
  | { ok: false; reasons: string[]; externalId: number | null };

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** Quantidade Nomus pt-BR (milhar com ponto): "15.400" → 15400. */
export function parseNomusProductionQuantity(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && !input.trim()) return null;
  const parsed = parseNomusPtBrNumber(input);
  return Number.isFinite(parsed) ? parsed : null;
}

export function pickItensPedidoFromOrdem(doc: JsonObject): unknown[] {
  const candidates = [
    doc.itensPedido,
    doc.itensPedidos,
    doc.itensDoPedido,
    asObject(doc.pedido)?.itensPedido,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function mapNomusProductionOrderSalesLink(
  raw: unknown
): MappedNomusProductionOrderSalesLink | null {
  const item = asObject(raw);
  if (!item) return null;

  const externalSalesOrderId = toInt(item.idPedido) ?? toInt(item.idPedidoVenda);
  const externalSalesOrderItemId =
    toInt(item.id) ?? toInt(item.idItemPedido) ?? toInt(item.idItem);
  if (externalSalesOrderId == null || externalSalesOrderItemId == null) return null;

  const qty = parseNomusProductionQuantity(item.quantidade ?? item.qtde ?? item.qtd);

  return {
    externalSalesOrderId,
    externalSalesOrderItemId,
    itemSequence: asString(item.item) ?? asString(item.sequencia) ?? null,
    customerName: asString(item.nomeCliente) ?? asString(item.cliente) ?? null,
    linkQuantity: qty != null ? new Prisma.Decimal(qty) : null,
    rawJson: item,
  };
}

function resolveProductCode(raw: JsonObject): string | null {
  const produto = asObject(raw.produto);
  return (
    asString(raw.codigoProduto) ??
    asString(raw.productCode) ??
    asString(produto?.codigo) ??
    asString(produto?.nome) ??
    asString(raw.produto) ??
    null
  );
}

function resolveCompanyName(raw: JsonObject): string | null {
  const empresa = asObject(raw.empresa);
  return (
    asString(raw.empresaNome) ??
    asString(raw.companyName) ??
    asString(empresa?.nome) ??
    asString(empresa?.razaoSocial) ??
    asString(raw.empresa) ??
    null
  );
}

/**
 * Mapeia um objeto OP do Nomus. Exige `id` externo.
 * Não infere vínculo pedido/item — só lê itensPedido oficiais.
 */
export function mapNomusProductionOrderPayload(raw: JsonObject): MapProductionOrderResult {
  const externalId = toInt(raw.id) ?? toInt(raw.idOrdem) ?? toInt(raw.idOrdemProducao);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const produto = asObject(raw.produto);
  const qty = parseNomusProductionQuantity(
    raw.quantidade ?? raw.qtde ?? raw.quantidadeOrdem ?? raw.qtd
  );

  const salesLinks = pickItensPedidoFromOrdem(raw)
    .map(mapNomusProductionOrderSalesLink)
    .filter((link): link is MappedNomusProductionOrderSalesLink => link != null);

  // Dedup por item externo (último ganha).
  const byItemId = new Map<number, MappedNomusProductionOrderSalesLink>();
  for (const link of salesLinks) {
    byItemId.set(link.externalSalesOrderItemId, link);
  }

  return {
    ok: true,
    row: {
      externalId,
      name: asString(raw.nome) ?? asString(raw.name) ?? asString(raw.codigo) ?? null,
      status: asString(raw.status) ?? asString(raw.situacao) ?? null,
      tipo: asString(raw.tipo) ?? asString(raw.tipoOrdem) ?? null,
      productCode: resolveProductCode(raw),
      externalProductId:
        toInt(raw.idProduto) ?? toInt(raw.produtoId) ?? toInt(produto?.id) ?? null,
      quantity: qty != null ? new Prisma.Decimal(qty) : null,
      unit: asString(raw.unidade) ?? asString(raw.unit) ?? asString(produto?.unidade) ?? null,
      companyName: resolveCompanyName(raw),
      rawJson: raw,
      salesLinks: [...byItemId.values()],
    },
  };
}
