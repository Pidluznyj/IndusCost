/**
 * Qualidade da integração de propostas do Nomus — diagnóstico, NÃO indicador comercial.
 *
 * Olha as propostas do Nomus com líquido <= 0 e explica cada uma a partir do que veio da origem
 * (`externalRawPayload.itensProposta`, `valorTotal`, `valorTotalNfe`) e do que foi gravado (itens mapeados,
 * pedido vinculado). Não altera nada: valores originais, códigos, cliente e payload ficam como estão.
 *
 * Item da origem sem `codigoProduto` é descartado pelo sincronizador (NO_SKU) — por isso "itens na origem, nenhum
 * mapeado" é uma categoria própria. Valor bruto positivo com líquido zero (ex.: CP 01818–01822, valorTotalNfe 42.900)
 * é registrado como inconsistência da origem; o bruto nunca vira líquido.
 */
import { classifyProposalCommercialEligibility } from "./proposalCommercialEligibility.js";

export type ProposalIntegrationQualityRow = {
  id: string;
  number: number;
  externalProposalCode: string | null;
  customerName: string | null;
  status: string;
  totalNetValue: number | string | { toString(): string } | null;
  totalGrossValue: number | string | { toString(): string } | null;
  mappedItemCount: number;
  hasSalesOrder: boolean;
  externalRawPayload: unknown;
};

export type ProposalIntegrationQualityItem = {
  id: string;
  number: number;
  externalProposalCode: string | null;
  customerName: string | null;
  status: string;
  rawNetValue: string | null;
  rawGrossValue: string | null;
  totalGrossValue: number;
  sourceItemCount: number;
  sourceItemsWithoutSku: number;
  mappedItemCount: number;
  hasSalesOrder: boolean;
  categories: ProposalIntegrationCategory[];
  hiddenFromDefaultGrid: boolean;
};

export type ProposalIntegrationCategory =
  | "NO_SOURCE_ITEMS"
  | "SOURCE_ITEMS_NONE_MAPPED"
  | "ZERO_NET_VALUE"
  | "GROSS_POSITIVE_NET_ZERO"
  | "SALES_ORDER_NEEDS_REVIEW"
  | "MAPPED_ITEMS_ZERO_VALUE";

export const PROPOSAL_INTEGRATION_CATEGORY_LABEL: Record<ProposalIntegrationCategory, string> = {
  NO_SOURCE_ITEMS: "Sem itens na origem",
  SOURCE_ITEMS_NONE_MAPPED: "Com itens na origem, nenhum mapeado",
  ZERO_NET_VALUE: "Valor líquido zero",
  GROSS_POSITIVE_NET_ZERO: "Valor bruto positivo e líquido zero",
  SALES_ORDER_NEEDS_REVIEW: "Com pedido de venda vinculado — revisar",
  MAPPED_ITEMS_ZERO_VALUE: "Com itens mapeados e valor zero — revisar",
};

export type ProposalIntegrationQualityReport = {
  scope: "NOMUS_ZERO_NET_VALUE";
  total: number;
  hiddenFromDefaultGrid: number;
  counts: Record<ProposalIntegrationCategory, number>;
  items: ProposalIntegrationQualityItem[];
};

function amount(value: ProposalIntegrationQualityRow["totalNetValue"]): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

/** Número pt-BR do Nomus ("42.900,00", "0,00", "42900") → número; vazio → null. */
export function parseNomusRawAmount(value: unknown): number | null {
  const text = rawText(value)?.trim();
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function describeNomusSourceItems(payload: unknown): { sourceItemCount: number; sourceItemsWithoutSku: number } {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const items = Array.isArray(record.itensProposta)
    ? record.itensProposta.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const withoutSku = items.filter((item) => {
    const sku = item.codigoProduto;
    return sku == null || String(sku).trim() === "";
  }).length;
  return { sourceItemCount: items.length, sourceItemsWithoutSku: withoutSku };
}

export function classifyProposalIntegrationQuality(row: ProposalIntegrationQualityRow): ProposalIntegrationQualityItem {
  const payload = row.externalRawPayload && typeof row.externalRawPayload === "object"
    ? (row.externalRawPayload as Record<string, unknown>)
    : {};
  const source = describeNomusSourceItems(payload);
  const gross = Math.max(amount(row.totalGrossValue), parseNomusRawAmount(payload.valorTotalNfe) ?? 0);
  const categories: ProposalIntegrationCategory[] = ["ZERO_NET_VALUE"];
  if (source.sourceItemCount === 0) categories.push("NO_SOURCE_ITEMS");
  else if (row.mappedItemCount === 0) categories.push("SOURCE_ITEMS_NONE_MAPPED");
  if (gross > 0) categories.push("GROSS_POSITIVE_NET_ZERO");
  if (row.hasSalesOrder) categories.push("SALES_ORDER_NEEDS_REVIEW");
  else if (row.mappedItemCount > 0) categories.push("MAPPED_ITEMS_ZERO_VALUE");
  const eligibility = classifyProposalCommercialEligibility({
    sourceSystem: "NOMUS",
    totalNetValue: row.totalNetValue,
    mappedItemCount: row.mappedItemCount,
    hasSalesOrder: row.hasSalesOrder,
  });
  return {
    id: row.id,
    number: row.number,
    externalProposalCode: row.externalProposalCode,
    customerName: row.customerName,
    status: row.status,
    rawNetValue: rawText(payload.valorTotal),
    rawGrossValue: rawText(payload.valorTotalNfe),
    totalGrossValue: gross,
    sourceItemCount: source.sourceItemCount,
    sourceItemsWithoutSku: source.sourceItemsWithoutSku,
    mappedItemCount: row.mappedItemCount,
    hasSalesOrder: row.hasSalesOrder,
    categories,
    hiddenFromDefaultGrid: !eligibility.visibleByDefault,
  };
}

export function summarizeProposalIntegrationQuality(
  rows: readonly ProposalIntegrationQualityRow[]
): ProposalIntegrationQualityReport {
  const items = rows.filter((row) => amount(row.totalNetValue) <= 0).map(classifyProposalIntegrationQuality);
  const counts = Object.fromEntries(
    (Object.keys(PROPOSAL_INTEGRATION_CATEGORY_LABEL) as ProposalIntegrationCategory[]).map((key) => [
      key,
      items.filter((item) => item.categories.includes(key)).length,
    ])
  ) as Record<ProposalIntegrationCategory, number>;
  return {
    scope: "NOMUS_ZERO_NET_VALUE",
    total: items.length,
    hiddenFromDefaultGrid: items.filter((item) => item.hiddenFromDefaultGrid).length,
    counts,
    items,
  };
}
