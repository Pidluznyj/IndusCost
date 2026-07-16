/**
 * Mapper puro: payload Nomus `/rest/ordens` → stage local (OP-02 schema).
 * Parsers/normalização: `nomusProductionOrdersParsers` (OP-03).
 * Vínculo oficial somente via itensPedido[].idPedido e itensPedido[].id.
 */

import { Prisma } from "@prisma/client";
import {
  asNomusProductionOrderObject,
  normalizeNomusProductionOrderCode,
  normalizeNomusProductionOrderInt,
  normalizeNomusProductionOrderString,
  parseNomusProductionOrderDateTime,
  parseNomusProductionQuantity,
  stableNomusProductionOrderPayloadHash,
  validateNomusProductionOrderPayload,
  type JsonObject,
  type NomusProductionOrderDateParseResult,
} from "@/src/lib/nomusProductionOrdersParsers.js";

export type { JsonObject };
export {
  parseNomusProductionQuantity,
  stableNomusProductionOrderPayloadHash,
} from "@/src/lib/nomusProductionOrdersParsers.js";

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

export type MapProductionOrderFieldError = {
  field: string;
  error: string;
  raw: string;
};

export type MapProductionOrderResult =
  | {
      ok: true;
      row: MappedNomusProductionOrder;
      fieldErrors: MapProductionOrderFieldError[];
    }
  | { ok: false; reasons: string[]; externalId: number | null };

function mapDateField(
  field: string,
  input: unknown,
  fieldErrors: MapProductionOrderFieldError[]
): Date | null {
  const parsed: NomusProductionOrderDateParseResult = parseNomusProductionOrderDateTime(input);
  if (parsed.ok) return parsed.value;
  fieldErrors.push({ field, error: parsed.error, raw: parsed.raw });
  return null;
}

export function pickItensPedidoFromOrdem(doc: JsonObject): unknown[] {
  const candidates = [
    doc.itensPedido,
    doc.itensPedidos,
    doc.itensDoPedido,
    asNomusProductionOrderObject(doc.pedido)?.itensPedido,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function mapNomusProductionOrderSalesLink(
  raw: unknown
): MappedNomusProductionOrderSalesLink | null {
  const item = asNomusProductionOrderObject(raw);
  if (!item) return null;

  const externalSalesOrderId =
    normalizeNomusProductionOrderInt(item.idPedido) ??
    normalizeNomusProductionOrderInt(item.idPedidoVenda);
  const externalSalesOrderItemId =
    normalizeNomusProductionOrderInt(item.id) ??
    normalizeNomusProductionOrderInt(item.idItemPedido) ??
    normalizeNomusProductionOrderInt(item.idItem);
  if (externalSalesOrderId == null || externalSalesOrderItemId == null) return null;

  const qty = parseNomusProductionQuantity(item.quantidade ?? item.qtde ?? item.qtd);

  return {
    externalSalesOrderId,
    externalSalesOrderItemId,
    itemNumber:
      normalizeNomusProductionOrderCode(item.item) ??
      normalizeNomusProductionOrderCode(item.sequencia) ??
      null,
    customerName:
      normalizeNomusProductionOrderString(item.nomeCliente) ??
      normalizeNomusProductionOrderString(item.cliente) ??
      null,
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
  const produto = asNomusProductionOrderObject(raw.produto);
  const config =
    asNomusProductionOrderObject(raw.configuracaoProduto) ??
    asNomusProductionOrderObject(raw.configuracao) ??
    asNomusProductionOrderObject(produto?.configuracao) ??
    asNomusProductionOrderObject(produto?.configuracaoProduto);

  const productCode =
    normalizeNomusProductionOrderCode(raw.codigoProduto) ??
    normalizeNomusProductionOrderCode(raw.productCode) ??
    normalizeNomusProductionOrderCode(produto?.codigo) ??
    normalizeNomusProductionOrderCode(produto?.nome) ??
    normalizeNomusProductionOrderCode(raw.produto) ??
    null;

  return {
    externalProductId:
      normalizeNomusProductionOrderInt(raw.idProduto) ??
      normalizeNomusProductionOrderInt(raw.produtoId) ??
      normalizeNomusProductionOrderInt(produto?.id) ??
      null,
    productCode,
    productDescription:
      normalizeNomusProductionOrderString(raw.descricaoProduto) ??
      normalizeNomusProductionOrderString(produto?.descricao) ??
      normalizeNomusProductionOrderString(produto?.nome) ??
      null,
    productAdditionalInfo:
      normalizeNomusProductionOrderString(raw.informacaoAdicionalProduto) ??
      normalizeNomusProductionOrderString(raw.infoAdicionalProduto) ??
      normalizeNomusProductionOrderString(produto?.informacaoAdicional) ??
      normalizeNomusProductionOrderString(produto?.infoAdicional) ??
      null,
    productConfigId:
      normalizeNomusProductionOrderInt(raw.idConfiguracaoProduto) ??
      normalizeNomusProductionOrderInt(raw.idConfiguracao) ??
      normalizeNomusProductionOrderInt(config?.id) ??
      null,
    productConfigCode:
      normalizeNomusProductionOrderCode(raw.codigoConfiguracaoProduto) ??
      normalizeNomusProductionOrderCode(raw.codigoConfiguracao) ??
      normalizeNomusProductionOrderCode(config?.codigo) ??
      normalizeNomusProductionOrderCode(config?.nome) ??
      null,
  };
}

function resolveCompanyFields(raw: JsonObject): {
  externalCompanyId: number | null;
  companyName: string | null;
} {
  const empresa = asNomusProductionOrderObject(raw.empresa);
  return {
    externalCompanyId:
      normalizeNomusProductionOrderInt(raw.idEmpresa) ??
      normalizeNomusProductionOrderInt(empresa?.id) ??
      null,
    companyName:
      normalizeNomusProductionOrderString(raw.empresaNome) ??
      normalizeNomusProductionOrderString(raw.companyName) ??
      normalizeNomusProductionOrderString(empresa?.nome) ??
      normalizeNomusProductionOrderString(empresa?.razaoSocial) ??
      normalizeNomusProductionOrderString(raw.empresa) ??
      null,
  };
}

function resolvePriority(raw: JsonObject): string | null {
  const asText =
    normalizeNomusProductionOrderString(raw.prioridade) ??
    normalizeNomusProductionOrderString(raw.priority);
  if (asText) return asText;
  const n =
    normalizeNomusProductionOrderInt(raw.prioridade) ??
    normalizeNomusProductionOrderInt(raw.priority);
  return n != null ? String(n) : null;
}

/**
 * Mapeia um objeto OP do Nomus. Exige `id` externo.
 * Não infere vínculo pedido/item — só lê itensPedido oficiais.
 * OP sem itensPedido → salesLinks vazio (permitido).
 * Datas inválidas → campo null + fieldErrors (erro controlado).
 */
export function mapNomusProductionOrderPayload(raw: JsonObject): MapProductionOrderResult {
  const externalId =
    normalizeNomusProductionOrderInt(raw.id) ??
    normalizeNomusProductionOrderInt(raw.idOrdem) ??
    normalizeNomusProductionOrderInt(raw.idOrdemProducao);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const fieldErrors: MapProductionOrderFieldError[] = [];
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
    fieldErrors,
    row: {
      externalId,
      name:
        normalizeNomusProductionOrderString(raw.nome) ??
        normalizeNomusProductionOrderString(raw.name) ??
        normalizeNomusProductionOrderCode(raw.codigo) ??
        null,
      status:
        normalizeNomusProductionOrderString(raw.status) ??
        normalizeNomusProductionOrderString(raw.situacao) ??
        null,
      tipo:
        normalizeNomusProductionOrderString(raw.tipo) ??
        normalizeNomusProductionOrderString(raw.tipoOrdem) ??
        null,
      priority: resolvePriority(raw),
      ...product,
      ...company,
      quantity: qty != null ? new Prisma.Decimal(qty) : null,
      unit:
        normalizeNomusProductionOrderCode(raw.unidade) ??
        normalizeNomusProductionOrderCode(raw.unit) ??
        normalizeNomusProductionOrderCode(
          asNomusProductionOrderObject(raw.produto)?.unidade
        ) ??
        null,
      stockSector:
        normalizeNomusProductionOrderString(raw.setorEstoque) ??
        normalizeNomusProductionOrderString(raw.setor) ??
        normalizeNomusProductionOrderString(
          asNomusProductionOrderObject(raw.setorEstoque)?.nome
        ) ??
        null,
      openedAt: mapDateField(
        "openedAt",
        raw.dataAbertura ?? raw.dataInicio ?? raw.dataCriacao,
        fieldErrors
      ),
      closedAt: mapDateField(
        "closedAt",
        raw.dataEncerramento ?? raw.dataFim ?? raw.dataConclusao,
        fieldErrors
      ),
      plannedAt: mapDateField(
        "plannedAt",
        raw.dataPrevista ?? raw.dataPrevisao ?? raw.dataEntregaPrevista,
        fieldErrors
      ),
      // Não usar timestamps locais do stage; só campos Nomus oficiais.
      nomusUpdatedAt: mapDateField(
        "nomusUpdatedAt",
        raw.dataAlteracao ?? raw.dataAtualizacao,
        fieldErrors
      ),
      rawJson: raw,
      payloadHash: stableNomusProductionOrderPayloadHash(raw),
      salesLinks: [...byItemId.values()],
    },
  };
}

/**
 * Mapper do cabeçalho OP (OP-05): valida payload, converte datas/quantidades e hash.
 * `salesLinks` fica vazio — vínculos itensPedido não entram na persistência deste prompt.
 */
export function mapNomusProductionOrderHeader(raw: unknown): MapProductionOrderResult {
  const validated = validateNomusProductionOrderPayload(raw);
  if (!validated.ok || !validated.payload) {
    return {
      ok: false,
      reasons: validated.reasons.length > 0 ? validated.reasons : ["INVALID_PAYLOAD"],
      externalId: validated.externalId,
    };
  }
  const mapped = mapNomusProductionOrderPayload(validated.payload);
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    fieldErrors: mapped.fieldErrors,
    row: {
      ...mapped.row,
      salesLinks: [],
    },
  };
}
