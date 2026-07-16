/**
 * Mapper puro: payload Nomus `/rest/ordens` → stage local (OP-02 schema).
 * Quantidades Nomus: "15.400" → 15400; "15.000" → 15000.
 * Vínculo oficial somente via itensPedido[].idPedido e itensPedido[].id.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  asString,
  parseNomusBrDateTime,
  toInt,
} from "@/src/lib/nomusAccountsReceivableParser.js";
import { parseNomusPtBrNumber } from "@/scripts/nomusNumberParser.js";

export type JsonObject = Record<string, unknown>;

export type MappedNomusProductionOrderSalesLink = {
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber: string | null;
  customerName: string | null;
  linkedQuantity: Prisma.Decimal | null;
  rawJson: JsonObject;
};

export type MappedNomusProductionOrder = {
  externalId: number;
  name: string | null;
  status: string | null;
  tipo: string | null;
  priority: string | null;
  externalProductId: number | null;
  productCode: string | null;
  productDescription: string | null;
  productAdditionalInfo: string | null;
  productConfigId: number | null;
  productConfigCode: string | null;
  externalCompanyId: number | null;
  companyName: string | null;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  stockSector: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  plannedAt: Date | null;
  nomusUpdatedAt: Date | null;
  rawJson: JsonObject;
  payloadHash: string;
  salesLinks: MappedNomusProductionOrderSalesLink[];
};

export type MapProductionOrderResult =
  | { ok: true; row: MappedNomusProductionOrder }
  | { ok: false; reasons: string[]; externalId: number | null };

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

export function stableNomusProductionOrderPayloadHash(raw: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
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
    itemNumber: asString(item.item) ?? asString(item.sequencia) ?? null,
    customerName: asString(item.nomeCliente) ?? asString(item.cliente) ?? null,
    linkedQuantity: qty != null ? new Prisma.Decimal(qty) : null,
    rawJson: item,
  };
}

function resolveProductFields(raw: JsonObject): {
  externalProductId: number | null;
  productCode: string | null;
  productDescription: string | null;
  productAdditionalInfo: string | null;
  productConfigId: number | null;
  productConfigCode: string | null;
} {
  const produto = asObject(raw.produto);
  const config =
    asObject(raw.configuracaoProduto) ??
    asObject(raw.configuracao) ??
    asObject(produto?.configuracao) ??
    asObject(produto?.configuracaoProduto);

  const productCode =
    asString(raw.codigoProduto) ??
    asString(raw.productCode) ??
    asString(produto?.codigo) ??
    asString(produto?.nome) ??
    asString(raw.produto) ??
    null;

  return {
    externalProductId:
      toInt(raw.idProduto) ?? toInt(raw.produtoId) ?? toInt(produto?.id) ?? null,
    productCode,
    productDescription:
      asString(raw.descricaoProduto) ??
      asString(produto?.descricao) ??
      asString(produto?.nome) ??
      null,
    productAdditionalInfo:
      asString(raw.informacaoAdicionalProduto) ??
      asString(raw.infoAdicionalProduto) ??
      asString(produto?.informacaoAdicional) ??
      asString(produto?.infoAdicional) ??
      null,
    productConfigId:
      toInt(raw.idConfiguracaoProduto) ??
      toInt(raw.idConfiguracao) ??
      toInt(config?.id) ??
      null,
    productConfigCode:
      asString(raw.codigoConfiguracaoProduto) ??
      asString(raw.codigoConfiguracao) ??
      asString(config?.codigo) ??
      asString(config?.nome) ??
      null,
  };
}

function resolveCompanyFields(raw: JsonObject): {
  externalCompanyId: number | null;
  companyName: string | null;
} {
  const empresa = asObject(raw.empresa);
  return {
    externalCompanyId: toInt(raw.idEmpresa) ?? toInt(empresa?.id) ?? null,
    companyName:
      asString(raw.empresaNome) ??
      asString(raw.companyName) ??
      asString(empresa?.nome) ??
      asString(empresa?.razaoSocial) ??
      asString(raw.empresa) ??
      null,
  };
}

function resolvePriority(raw: JsonObject): string | null {
  const asText = asString(raw.prioridade) ?? asString(raw.priority);
  if (asText) return asText;
  const n = toInt(raw.prioridade) ?? toInt(raw.priority);
  return n != null ? String(n) : null;
}

/**
 * Mapeia um objeto OP do Nomus. Exige `id` externo.
 * Não infere vínculo pedido/item — só lê itensPedido oficiais.
 * OP sem itensPedido → salesLinks vazio (permitido).
 */
export function mapNomusProductionOrderPayload(raw: JsonObject): MapProductionOrderResult {
  const externalId = toInt(raw.id) ?? toInt(raw.idOrdem) ?? toInt(raw.idOrdemProducao);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const product = resolveProductFields(raw);
  const company = resolveCompanyFields(raw);
  const qty = parseNomusProductionQuantity(
    raw.quantidade ?? raw.qtde ?? raw.quantidadeOrdem ?? raw.qtd
  );

  const salesLinks = pickItensPedidoFromOrdem(raw)
    .map(mapNomusProductionOrderSalesLink)
    .filter((link): link is MappedNomusProductionOrderSalesLink => link != null);

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
      priority: resolvePriority(raw),
      ...product,
      ...company,
      quantity: qty != null ? new Prisma.Decimal(qty) : null,
      unit:
        asString(raw.unidade) ??
        asString(raw.unit) ??
        asString(asObject(raw.produto)?.unidade) ??
        null,
      stockSector:
        asString(raw.setorEstoque) ??
        asString(raw.setor) ??
        asString(asObject(raw.setorEstoque)?.nome) ??
        null,
      openedAt: parseNomusBrDateTime(
        raw.dataAbertura ?? raw.dataInicio ?? raw.dataCriacao
      ),
      closedAt: parseNomusBrDateTime(
        raw.dataEncerramento ?? raw.dataFim ?? raw.dataConclusao
      ),
      plannedAt: parseNomusBrDateTime(
        raw.dataPrevista ?? raw.dataPrevisao ?? raw.dataEntregaPrevista
      ),
      nomusUpdatedAt: parseNomusBrDateTime(
        raw.dataAlteracao ?? raw.dataAtualizacao ?? raw.updatedAt
      ),
      rawJson: raw,
      payloadHash: stableNomusProductionOrderPayloadHash(raw),
      salesLinks: [...byItemId.values()],
    },
  };
}
