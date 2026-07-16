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
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  closedAt: Date | null;
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

/**
 * Primeiro valor presente e não-vazio.
 * Não usa Date.now(); ausência permanece ausência (caller passa null ao parser).
 */
export function firstPresentNomusDateCandidate(...candidates: unknown[]): unknown {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === "string" && candidate.trim() === "") continue;
    return candidate;
  }
  return null;
}

/**
 * Mapeamento oficial OP-14.1 (prioridade = nomes reais de GET /rest/ordens).
 * Aliases legados só como fallback semanticamente equivalente.
 *
 * closedAt: NUNCA dataHoraEntrega / dataHoraEdicao — só encerramento inequívoco.
 */
export function resolveNomusProductionOrderDateInputs(raw: JsonObject): {
  openedAt: unknown;
  releasedAt: unknown;
  plannedAt: unknown;
  deliveryAt: unknown;
  closedAt: unknown;
  nomusUpdatedAt: unknown;
} {
  return {
    openedAt: firstPresentNomusDateCandidate(
      raw.dataHoraCriacao,
      raw.dataAbertura,
      raw.dataInicio,
      raw.dataCriacao
    ),
    releasedAt: firstPresentNomusDateCandidate(raw.dataHoraLiberacao, raw.dataLiberacao),
    plannedAt: firstPresentNomusDateCandidate(
      raw.dataHoraInicialPlanejada,
      raw.dataPrevista,
      raw.dataPrevisao,
      raw.dataEntregaPrevista
    ),
    deliveryAt: firstPresentNomusDateCandidate(raw.dataHoraEntrega, raw.dataEntrega),
    // Encerramento oficial apenas — não confundir com entrega/edição.
    closedAt: firstPresentNomusDateCandidate(
      raw.dataHoraEncerramento,
      raw.dataEncerramento,
      raw.dataFim,
      raw.dataConclusao
    ),
    nomusUpdatedAt: firstPresentNomusDateCandidate(
      raw.dataHoraEdicao,
      raw.dataAlteracao,
      raw.dataAtualizacao
    ),
  };
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
  const empresaObj = asNomusProductionOrderObject(raw.empresa);
  const empresaAsString =
    normalizeNomusProductionOrderString(raw.empresaNome) ??
    normalizeNomusProductionOrderString(raw.nomeEmpresa) ??
    normalizeNomusProductionOrderString(raw.descricaoEmpresa) ??
    normalizeNomusProductionOrderString(raw.empresaDescricao) ??
    normalizeNomusProductionOrderString(raw.companyName) ??
    normalizeNomusProductionOrderString(empresaObj?.nome) ??
    normalizeNomusProductionOrderString(empresaObj?.razaoSocial) ??
    normalizeNomusProductionOrderString(empresaObj?.descricao) ??
    normalizeNomusProductionOrderString(empresaObj?.codigoNome) ??
    // string pura: "02 - KOPPETEL" ou "KOPPETEL"
    normalizeNomusProductionOrderString(raw.empresa);

  const parsedFromLabel = empresaAsString
    ? parseNomusEmpresaLabel(empresaAsString)
    : null;

  const externalCompanyId =
    normalizeNomusProductionOrderInt(raw.idEmpresa) ??
    normalizeNomusProductionOrderInt(empresaObj?.id) ??
    normalizeNomusProductionOrderInt(raw.empresa) ??
    parsedFromLabel?.id ??
    null;

  const companyName = empresaAsString;

  return { externalCompanyId, companyName };
}

/**
 * Aceita rótulos Nomus no formato `"02 - KOPPETEL"` → `{ id: 2, name: "02 - KOPPETEL" }`.
 * O nome exibido preserva o texto original; o id só é inferido do prefixo numérico.
 */
export function parseNomusEmpresaLabel(
  value: string
): { id: number | null; name: string } {
  const trimmed = value.trim();
  if (!trimmed) return { id: null, name: "" };
  const match = trimmed.match(/^(\d+)\s*[-–—]\s*(.+)$/);
  if (!match) return { id: null, name: trimmed };
  const id = Number(match[1]);
  return {
    id: Number.isFinite(id) ? id : null,
    name: trimmed,
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

  const dateInputs = resolveNomusProductionOrderDateInputs(raw);

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
      openedAt: mapDateField("openedAt", dateInputs.openedAt, fieldErrors),
      releasedAt: mapDateField("releasedAt", dateInputs.releasedAt, fieldErrors),
      plannedAt: mapDateField("plannedAt", dateInputs.plannedAt, fieldErrors),
      deliveryAt: mapDateField("deliveryAt", dateInputs.deliveryAt, fieldErrors),
      closedAt: mapDateField("closedAt", dateInputs.closedAt, fieldErrors),
      // Não usar timestamps locais do stage; só campos Nomus oficiais.
      nomusUpdatedAt: mapDateField("nomusUpdatedAt", dateInputs.nomusUpdatedAt, fieldErrors),
      rawJson: raw,
      payloadHash: stableNomusProductionOrderPayloadHash(raw),
      salesLinks: [...byItemId.values()],
    },
  };
}

/**
 * Mapper validado para persistência (cabeçalho + vínculos oficiais itensPedido).
 */
export function mapNomusProductionOrderForPersist(raw: unknown): MapProductionOrderResult {
  const validated = validateNomusProductionOrderPayload(raw);
  if (!validated.ok || !validated.payload) {
    return {
      ok: false,
      reasons: validated.reasons.length > 0 ? validated.reasons : ["INVALID_PAYLOAD"],
      externalId: validated.externalId,
    };
  }
  return mapNomusProductionOrderPayload(validated.payload);
}

/**
 * @deprecated Prefer `mapNomusProductionOrderForPersist` (inclui itensPedido).
 * Mantido para compat: equivalente ao persist completo.
 */
export function mapNomusProductionOrderHeader(raw: unknown): MapProductionOrderResult {
  return mapNomusProductionOrderForPersist(raw);
}
