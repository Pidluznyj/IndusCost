import type { Prisma } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import { isNomusNfeCancelled } from "./finance/nfeStatus.js";
import { prisma } from "./prisma.js";
import {
  buildLinkedNfeFiscalAmounts,
  resolveNfeComparableBillingValue,
} from "./sales/orderFiscalFinancialMetrics.js";
import {
  diffCalendarDays,
  extractNomusRawNfes,
  parseNomusBrOrIsoDate,
  startOfLocalDay,
} from "./salesOrderNomusRaw.js";
import type { ExtractedSalesOrderNfe } from "./salesOrderNomusNfeExtract.js";
import { extractSalesOrderNfesFromNomusPayload } from "./salesOrderNomusNfeExtract.js";

export const INVOICE_COVERAGE_TOLERANCE_ABSOLUTE = 1;
export const INVOICE_COVERAGE_TOLERANCE_PERCENT = 0.01;
/** Tolerância (pontos percentuais) para tratar o progresso operacional como 100%. */
export const OPERATIONAL_INVOICED_PROGRESS_FULL_TOLERANCE = 0.01;

/**
 * Base usada na cobertura de faturamento do pedido:
 * - `nfe_header_value`: soma do cabeçalho das NF válidas × valor líquido do pedido.
 *   Só é atribuível ao pedido quando a NF pertence apenas a ele.
 * - `operational_item_quantity`: quantidade faturada por item do motor operacional
 *   (`SalesOrderFlowSnapshot.progressInvoiced`). Usada quando o cabeçalho não é
 *   atribuível (NF/Documento de Saída com itens de vários pedidos, ou cabeçalho
 *   acima do valor do pedido).
 */
export type SalesOrderInvoiceCoverageBasis =
  | "nfe_header_value"
  | "operational_item_quantity";

/** Faturamento por item já consolidado pelo motor operacional (SalesOrderFlow). */
export type SalesOrderOperationalInvoicingInput = {
  /** `SalesOrderFlowSnapshot.progressInvoiced` (0–100, ponderado pela obrigação ativa). */
  progressInvoicedPercent: number | null | undefined;
};

export type SalesOrderLinkedNfeLinkInput = {
  id: string;
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeKey: string | null;
  nfeStatus: number | null;
  tipoOperacao: number | null;
  dataProcessamento: Date | null;
  presentInLastPayload: boolean;
  nomusNfeId: string | null;
  rawPayload?: unknown;
};

export type SalesOrderLinkedNomusNfeInput = {
  id: string;
  externalId: number;
  numero: string | null;
  chave: string | null;
  status: number | null;
  tipoOperacao: number | null;
  dataProcessamento: Date | null;
  xmlDhEmi: Date | null;
  valorLiquido: unknown;
  xmlVNF: unknown;
  xmlVProd?: unknown;
  xmlVDesc?: unknown;
};

export type SalesOrderLinkedNfeContext = {
  source: "linked" | "raw_fallback";
  hasNfe: boolean;
  nfeCount: number;
  validInvoiceCount: number;
  canceledInvoiceCount: number;
  hasValidInvoice: boolean;
  hasCanceledInvoice: boolean;
  nfeNumbers: string[];
  nfeKeys: string[];
  nfeStatuses: number[];
  nfeTipoOperacao: number[];
  nfeLinks: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeKey: string | null;
    nomusNfeId: string | null;
  }>;
  firstNfeProcessingDate: Date | null;
  lastNfeProcessingDate: Date | null;
  firstNfeIssueDate: Date | null;
  lastNfeIssueDate: Date | null;
  /** Soma só de NF válidas para faturamento (exclui canceladas) — base comparável (preferência xmlVNF). */
  nfeTotalValue: number;
  /** Soma histórica incluindo canceladas. */
  nfeTotalValueAll: number;
  /** Soma de produtos líquidos (valorLiquido) das NF válidas. */
  nfeProductsValue: number;
  /** Soma de impostos destacados (vNF − produtos) das NF válidas, quando ambos existem. */
  nfeHighlightedTaxesValue: number;
  invoiceCoveragePercent: number | null;
  /** Base da cobertura acima; ausente = `nfe_header_value`. */
  invoiceCoverageBasis?: SalesOrderInvoiceCoverageBasis;
  /** Alguma NF válida deste pedido também está vinculada a outro pedido. */
  hasNfeSharedAcrossOrders?: boolean;
  isFullyInvoiced: boolean;
  isPartiallyInvoiced: boolean;
  isNotInvoiced: boolean;
  isOnTime: boolean | null;
  isLate: boolean | null;
  hasCut: boolean;
  isComplete: boolean;
  hasValueDivergence: boolean;
  needsDataReview: boolean;
  reviewReasons: string[];
  daysToInvoice: number | null;
  daysLate: number | null;
  slaStatus: "on_time" | "late" | "pending" | "review";
  slaDays: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRawValue(raw: unknown, keys: string[]): number | null {
  const obj = asObject(raw);
  if (!obj) return null;
  for (const key of keys) {
    const n = decimalToNumber(obj[key]);
    if (n != null && n >= 0) return n;
  }
  return null;
}

export function resolveLinkedNfeProcessingDate(
  link: Pick<SalesOrderLinkedNfeLinkInput, "dataProcessamento">,
  nomusNfe?: SalesOrderLinkedNomusNfeInput | null
): Date | null {
  if (nomusNfe?.dataProcessamento) return startOfLocalDay(nomusNfe.dataProcessamento);
  if (link.dataProcessamento) return startOfLocalDay(link.dataProcessamento);
  if (nomusNfe?.xmlDhEmi) return startOfLocalDay(nomusNfe.xmlDhEmi);
  return null;
}

export function resolveLinkedNfeIssueDate(
  nomusNfe?: SalesOrderLinkedNomusNfeInput | null
): Date | null {
  if (!nomusNfe?.xmlDhEmi) return null;
  return startOfLocalDay(nomusNfe.xmlDhEmi);
}

/**
 * Valor de faturamento da NF vinculada em base comparável ao pedido.
 * Prefere `xmlVNF` (total da NF, incl. IPI quando presente no vNF).
 * Fallback: `valorLiquido` (vProd − vDesc) e depois rawPayload.
 */
export function resolveLinkedNfeValue(
  link: Pick<SalesOrderLinkedNfeLinkInput, "rawPayload">,
  nomusNfe?: SalesOrderLinkedNomusNfeInput | null
): number {
  const fromRaw = readRawValue(link.rawPayload, ["xmlVNF", "vNF", "valor", "valorTotal"]);
  return resolveNfeComparableBillingValue(nomusNfe ?? null, fromRaw ?? 0);
}

export function resolveLinkedNfeFiscalBreakdown(
  link: Pick<SalesOrderLinkedNfeLinkInput, "rawPayload">,
  nomusNfe?: SalesOrderLinkedNomusNfeInput | null
) {
  const fromRaw = readRawValue(link.rawPayload, ["xmlVNF", "vNF", "valor", "valorTotal"]);
  return buildLinkedNfeFiscalAmounts(nomusNfe ?? null, fromRaw ?? 0);
}

export function isInvoiceCoverageComplete(
  nfeTotalValue: number,
  totalNetValue: number | null | undefined
): boolean {
  if (totalNetValue == null || !Number.isFinite(totalNetValue) || totalNetValue <= 0) {
    return false;
  }
  const diff = Math.abs(nfeTotalValue - totalNetValue);
  const pctDiff = diff / totalNetValue;
  return diff <= INVOICE_COVERAGE_TOLERANCE_ABSOLUTE || pctDiff <= INVOICE_COVERAGE_TOLERANCE_PERCENT;
}

export function computeInvoiceCoveragePercent(
  nfeTotalValue: number,
  totalNetValue: number | null | undefined
): number | null {
  if (totalNetValue == null || !Number.isFinite(totalNetValue) || totalNetValue <= 0) {
    return null;
  }
  return (nfeTotalValue / totalNetValue) * 100;
}

/**
 * Progresso faturado do motor operacional quando ele é utilizável como base de
 * cobertura: finito e positivo. Zero/ausente = sem rateio operacional
 * (mantém a regra do cabeçalho da NF).
 */
export function resolveOperationalInvoicedProgressPercent(
  operationalInvoicing: SalesOrderOperationalInvoicingInput | null | undefined
): number | null {
  const raw = operationalInvoicing?.progressInvoicedPercent;
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(100, value);
}

/**
 * NF (externalId) vinculadas a mais de um pedido.
 * Puro — recebe os pares de vínculo ativo (pedido × NF).
 */
export function resolveSharedNfeExternalIds(
  pairs: Iterable<{ salesOrderId: string; nfeExternalId: number }>
): Set<number> {
  const ordersByNfe = new Map<number, Set<string>>();
  for (const pair of pairs) {
    const orders = ordersByNfe.get(pair.nfeExternalId) ?? new Set<string>();
    orders.add(pair.salesOrderId);
    ordersByNfe.set(pair.nfeExternalId, orders);
  }
  const shared = new Set<number>();
  for (const [nfeExternalId, orders] of ordersByNfe) {
    if (orders.size > 1) shared.add(nfeExternalId);
  }
  return shared;
}

function sortDates(dates: Date[]): Date[] {
  return [...dates].sort((a, b) => a.getTime() - b.getTime());
}

function buildContextFromExtractedRows(input: {
  rows: Array<{
    linkId: string;
    extracted: ExtractedSalesOrderNfe;
    processingDate: Date | null;
    issueDate: Date | null;
    value: number;
    productsValue: number;
    highlightedTaxesValue: number;
    nomusNfeId: string | null;
    /** Status oficial preferencial (NomusNfe.status). */
    officialStatus?: number | null;
  }>;
  source: SalesOrderLinkedNfeContext["source"];
  totalNetValue: number | null | undefined;
  issueDate?: Date | null;
  expectedDeliveryDate?: Date | null;
  referenceDate?: Date;
  sharedNfeExternalIds?: ReadonlySet<number>;
  operationalInvoicing?: SalesOrderOperationalInvoicingInput | null;
}): SalesOrderLinkedNfeContext {
  const reviewReasons: string[] = [];
  const referenceDate = startOfLocalDay(input.referenceDate ?? new Date());
  const plannedDate = input.expectedDeliveryDate
    ? startOfLocalDay(input.expectedDeliveryDate)
    : null;

  if (input.totalNetValue == null || !Number.isFinite(Number(input.totalNetValue)) || Number(input.totalNetValue) <= 0) {
    reviewReasons.push("Valor líquido do pedido inválido para cálculo de faturamento.");
  }
  if (!plannedDate) {
    reviewReasons.push("Sem previsão/data de entrega planejada.");
  }

  const rowStatus = (row: (typeof input.rows)[number]) =>
    row.officialStatus ?? row.extracted.nfeStatus ?? null;
  // Faturamento: exclui apenas canceladas (status 7). Status ausente mantém o
  // comportamento histórico (conta), alinhado ao motor fiscal notCancelled.
  const canceledRows = input.rows.filter((row) => isNomusNfeCancelled(rowStatus(row)));
  const billingRows = input.rows.filter((row) => !isNomusNfeCancelled(rowStatus(row)));

  const processingDates = sortDates(
    billingRows.map((row) => row.processingDate).filter((d): d is Date => d != null)
  );
  const issueDates = sortDates(
    billingRows.map((row) => row.issueDate).filter((d): d is Date => d != null)
  );

  const nfeTotalValueAll = input.rows.reduce((sum, row) => sum + row.value, 0);
  const nfeTotalValue = billingRows.reduce((sum, row) => sum + row.value, 0);
  const nfeProductsValue = billingRows.reduce((sum, row) => sum + row.productsValue, 0);
  const nfeHighlightedTaxesValue = billingRows.reduce(
    (sum, row) => sum + row.highlightedTaxesValue,
    0
  );
  const totalNet = input.totalNetValue != null ? Number(input.totalNetValue) : null;
  let invoiceCoveragePercent = computeInvoiceCoveragePercent(nfeTotalValue, totalNet);
  let isFullyInvoiced = isInvoiceCoverageComplete(nfeTotalValue, totalNet);
  const hasValidInvoice = billingRows.length > 0 && processingDates.length > 0;
  const hasCanceledInvoice = canceledRows.length > 0;
  // hasNfe para faturamento = possui NF válida; cancelada sozinha não fatura.
  const hasNfe = hasValidInvoice;
  let isPartiallyInvoiced = hasNfe && !isFullyInvoiced && nfeTotalValue > 0;
  const isNotInvoiced = !hasNfe;
  if (hasCanceledInvoice) {
    reviewReasons.push("NF cancelada vinculada ao pedido (não compõe faturamento válido).");
  }
  const headerExceedsOrderValue =
    totalNet != null &&
    totalNet > 0 &&
    nfeTotalValue > totalNet + Math.max(INVOICE_COVERAGE_TOLERANCE_ABSOLUTE, totalNet * INVOICE_COVERAGE_TOLERANCE_PERCENT);
  const hasNfeSharedAcrossOrders = billingRows.some(
    (row) => input.sharedNfeExternalIds?.has(row.extracted.nfeExternalId) === true
  );

  // Uma NF/Documento de Saída pode conter itens de vários pedidos: o cabeçalho
  // (xmlVNF) não é a parcela deste pedido. Nesses casos — e quando o cabeçalho
  // supera o valor do pedido — a cobertura vem da quantidade faturada por item
  // já consolidada pelo motor operacional, sem novo rateio aqui.
  let invoiceCoverageBasis: SalesOrderInvoiceCoverageBasis = "nfe_header_value";
  const operationalProgress = resolveOperationalInvoicedProgressPercent(
    input.operationalInvoicing
  );
  if (
    hasNfe &&
    operationalProgress != null &&
    (hasNfeSharedAcrossOrders || headerExceedsOrderValue)
  ) {
    invoiceCoverageBasis = "operational_item_quantity";
    invoiceCoveragePercent = operationalProgress;
    isFullyInvoiced =
      operationalProgress >= 100 - OPERATIONAL_INVOICED_PROGRESS_FULL_TOLERANCE;
    isPartiallyInvoiced = !isFullyInvoiced;
  }

  // Cabeçalho acima do pedido só é divergência quando a NF é exclusiva dele.
  const hasValueDivergence = headerExceedsOrderValue && !hasNfeSharedAcrossOrders;

  if (hasValueDivergence) {
    reviewReasons.push("Valor faturado excede o valor líquido do pedido além da tolerância.");
  }
  // NF processada porém sem valor fiscal: não classificar como atraso por isso —
  // o prazo segue pela DataReal, mas sinaliza revisão de dados.
  if (hasNfe && nfeTotalValue <= 0 && totalNet != null && totalNet > 0) {
    reviewReasons.push("NF vinculada sem valor fiscal.");
  }

  const completionDate = processingDates[processingDates.length - 1] ?? null;
  let isOnTime: boolean | null = null;
  let isLate: boolean | null = null;
  let daysLate: number | null = null;

  if (isFullyInvoiced && completionDate && plannedDate) {
    const diff = diffCalendarDays(completionDate, plannedDate);
    isOnTime = diff >= 0;
    isLate = diff < 0;
    daysLate = diff < 0 ? Math.abs(diff) : null;
  } else if (isPartiallyInvoiced && plannedDate) {
    const overdue = diffCalendarDays(referenceDate, plannedDate) < 0;
    isOnTime = !overdue;
    isLate = overdue;
    daysLate = overdue ? Math.abs(diffCalendarDays(referenceDate, plannedDate)) : null;
  } else if (isNotInvoiced && plannedDate) {
    const overdue = diffCalendarDays(referenceDate, plannedDate) < 0;
    isOnTime = !overdue;
    isLate = overdue;
    daysLate = overdue ? Math.abs(diffCalendarDays(referenceDate, plannedDate)) : null;
  }

  const orderIssueDate = input.issueDate ? startOfLocalDay(input.issueDate) : null;
  const firstProcessing = processingDates[0] ?? null;
  const daysToInvoice =
    orderIssueDate && firstProcessing ? Math.max(0, diffCalendarDays(orderIssueDate, firstProcessing)) : null;

  let slaStatus: SalesOrderLinkedNfeContext["slaStatus"] = "pending";
  if (reviewReasons.length > 0 && (!plannedDate || totalNet == null || totalNet <= 0)) {
    slaStatus = "review";
  } else if (isFullyInvoiced && isLate) {
    slaStatus = "late";
  } else if (isFullyInvoiced && isOnTime) {
    slaStatus = "on_time";
  } else if (isPartiallyInvoiced && isLate) {
    slaStatus = "late";
  } else if (isPartiallyInvoiced && isOnTime) {
    slaStatus = "pending";
  } else if (isNotInvoiced && isLate) {
    slaStatus = "late";
  } else {
    slaStatus = "pending";
  }

  return {
    source: input.source,
    hasNfe,
    nfeCount: input.rows.length,
    validInvoiceCount: billingRows.length,
    canceledInvoiceCount: canceledRows.length,
    hasValidInvoice,
    hasCanceledInvoice,
    nfeNumbers: input.rows
      .map((row) => row.extracted.nfeNumber)
      .filter((value): value is string => !!value?.trim()),
    nfeKeys: input.rows
      .map((row) => row.extracted.nfeKey)
      .filter((value): value is string => !!value?.trim()),
    nfeStatuses: input.rows
      .map((row) => rowStatus(row))
      .filter((value): value is number => value != null),
    nfeTipoOperacao: input.rows
      .map((row) => row.extracted.tipoOperacao)
      .filter((value): value is number => value != null),
    nfeLinks: input.rows.map((row) => ({
      id: row.linkId,
      nfeExternalId: row.extracted.nfeExternalId,
      nfeNumber: row.extracted.nfeNumber,
      nfeKey: row.extracted.nfeKey,
      nomusNfeId: row.nomusNfeId,
    })),
    firstNfeProcessingDate: firstProcessing,
    lastNfeProcessingDate: completionDate,
    firstNfeIssueDate: issueDates[0] ?? null,
    lastNfeIssueDate: issueDates[issueDates.length - 1] ?? null,
    nfeTotalValue,
    nfeTotalValueAll,
    nfeProductsValue,
    nfeHighlightedTaxesValue,
    invoiceCoveragePercent,
    invoiceCoverageBasis,
    hasNfeSharedAcrossOrders,
    isFullyInvoiced,
    isPartiallyInvoiced,
    isNotInvoiced,
    isOnTime,
    isLate,
    hasCut: isPartiallyInvoiced,
    isComplete: isFullyInvoiced,
    hasValueDivergence,
    needsDataReview: reviewReasons.length > 0,
    reviewReasons,
    daysToInvoice,
    daysLate,
    slaStatus,
    slaDays: daysToInvoice,
  };
}

export function buildSalesOrderLinkedNfeContext(input: {
  links: SalesOrderLinkedNfeLinkInput[];
  nomusNfesByExternalId?: Map<number, SalesOrderLinkedNomusNfeInput>;
  totalNetValue?: number | null;
  issueDate?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
  referenceDate?: Date;
  nomusRawResponse?: unknown;
  /** NF (externalId) vinculadas a mais de um pedido — cabeçalho não atribuível. */
  sharedNfeExternalIds?: ReadonlySet<number>;
  /** Faturamento por item do motor operacional (SalesOrderFlowSnapshot). */
  operationalInvoicing?: SalesOrderOperationalInvoicingInput | null;
}): SalesOrderLinkedNfeContext {
  const activeLinks = input.links.filter((link) => link.presentInLastPayload !== false);
  const nomusMap = input.nomusNfesByExternalId ?? new Map<number, SalesOrderLinkedNomusNfeInput>();

  if (activeLinks.length > 0) {
    const rows = activeLinks.map((link) => {
      const nomusNfe = nomusMap.get(link.nfeExternalId) ?? null;
      const extracted: ExtractedSalesOrderNfe = {
        nfeExternalId: link.nfeExternalId,
        nfeNumber: link.nfeNumber,
        nfeSerie: null,
        nfeKey: link.nfeKey,
        nfeStatus: link.nfeStatus,
        tipoOperacao: link.tipoOperacao,
        tipoEmissao: null,
        dataProcessamento: link.dataProcessamento,
        horaProcessamento: null,
        cnpjEmitente: null,
        protocolo: null,
        recibo: null,
        usuario: null,
        ambiente: null,
        finalidade: null,
        isFornecedor: null,
        rawPayload: asObject(link.rawPayload) ?? {},
      };
      const fiscal = resolveLinkedNfeFiscalBreakdown(link, nomusNfe);
      return {
        linkId: link.id,
        extracted,
        processingDate: resolveLinkedNfeProcessingDate(link, nomusNfe),
        issueDate: resolveLinkedNfeIssueDate(nomusNfe),
        value: fiscal.comparableBillingValue,
        productsValue: fiscal.productsValue ?? 0,
        highlightedTaxesValue: fiscal.highlightedTaxesValue ?? 0,
        nomusNfeId: nomusNfe?.id ?? link.nomusNfeId,
        officialStatus: nomusNfe?.status ?? link.nfeStatus ?? null,
      };
    });

    return buildContextFromExtractedRows({
      rows,
      source: "linked",
      totalNetValue: input.totalNetValue,
      issueDate: input.issueDate instanceof Date ? input.issueDate : input.issueDate ? new Date(input.issueDate) : null,
      expectedDeliveryDate:
        input.expectedDeliveryDate instanceof Date
          ? input.expectedDeliveryDate
          : input.expectedDeliveryDate
            ? new Date(input.expectedDeliveryDate)
            : null,
      referenceDate: input.referenceDate,
      sharedNfeExternalIds: input.sharedNfeExternalIds,
      operationalInvoicing: input.operationalInvoicing,
    });
  }

  const extracted = extractSalesOrderNfesFromNomusPayload(input.nomusRawResponse);
  const rawNfes = extractNomusRawNfes(input.nomusRawResponse);
  const rows = extracted.map((row, index) => {
    const raw = rawNfes[index];
    const processingDate = parseNomusBrOrIsoDate(row.dataProcessamento);
    const issueDate = parseNomusBrOrIsoDate(row.dataEmissao);
    const value =
      raw?.valor ?? readRawValue(row.rawPayload, ["xmlVNF", "vNF", "valor", "valorTotal"]) ?? 0;
    return {
      linkId: `raw-${row.nfeExternalId}`,
      extracted: row,
      processingDate,
      issueDate,
      value,
      productsValue: value,
      highlightedTaxesValue: 0,
      nomusNfeId: null,
      officialStatus: row.nfeStatus ?? null,
    };
  });

  return buildContextFromExtractedRows({
    rows,
    source: "raw_fallback",
    totalNetValue: input.totalNetValue,
    issueDate: input.issueDate instanceof Date ? input.issueDate : input.issueDate ? new Date(input.issueDate) : null,
    expectedDeliveryDate:
      input.expectedDeliveryDate instanceof Date
        ? input.expectedDeliveryDate
        : input.expectedDeliveryDate
          ? new Date(input.expectedDeliveryDate)
          : null,
    referenceDate: input.referenceDate,
    sharedNfeExternalIds: input.sharedNfeExternalIds,
    operationalInvoicing: input.operationalInvoicing,
  });
}

export async function loadSalesOrderLinkedNfeContextMap(
  orders: Array<{
    id: string;
    totalNetValue: unknown;
    issueDate?: Date | null;
    expectedDeliveryDate?: Date | null;
    nomusRawResponse?: unknown;
  }>,
  referenceDate = new Date(),
  options?: {
    /**
     * Listagem Comercial: não carrega `rawPayload` do link (JSON pesado).
     * Valores fiscais vêm de NomusNfe (xmlVNF / valorLiquido).
     */
    omitLinkRawPayload?: boolean;
  }
): Promise<Map<string, SalesOrderLinkedNfeContext>> {
  if (orders.length === 0) return new Map();

  const orderIds = orders.map((order) => order.id);
  const omitLinkRawPayload = options?.omitLinkRawPayload === true;
  const links = await prisma.salesOrderNfeLink.findMany({
    where: { salesOrderId: { in: orderIds } },
    select: {
      id: true,
      salesOrderId: true,
      nfeExternalId: true,
      nfeNumber: true,
      nfeKey: true,
      nfeStatus: true,
      tipoOperacao: true,
      dataProcessamento: true,
      presentInLastPayload: true,
      nomusNfeId: true,
      ...(omitLinkRawPayload ? {} : { rawPayload: true }),
    },
  });

  const externalIds = [...new Set(links.map((link) => link.nfeExternalId))];
  const nomusRows =
    externalIds.length > 0
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: externalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            chave: true,
            status: true,
            tipoOperacao: true,
            dataProcessamento: true,
            xmlDhEmi: true,
            valorLiquido: true,
            xmlVNF: true,
            xmlVProd: true,
            xmlVDesc: true,
          },
        })
      : [];

  const nomusByExternalId = new Map<number, SalesOrderLinkedNomusNfeInput>(
    nomusRows.map((row) => [row.externalId, row])
  );

  const linksByOrderId = new Map<string, SalesOrderLinkedNfeLinkInput[]>();
  for (const link of links) {
    const list = linksByOrderId.get(link.salesOrderId) ?? [];
    list.push(link);
    linksByOrderId.set(link.salesOrderId, list);
  }

  // NF compartilhada: considera vínculos ativos de qualquer pedido (inclusive
  // fora desta página), pois o cabeçalho da NF soma itens de todos eles.
  const [nfeOrderPairs, flowSnapshots] =
    externalIds.length > 0
      ? await Promise.all([
          prisma.salesOrderNfeLink.findMany({
            where: { nfeExternalId: { in: externalIds }, presentInLastPayload: true },
            select: { salesOrderId: true, nfeExternalId: true },
          }),
          prisma.salesOrderFlowSnapshot.findMany({
            where: { salesOrderId: { in: [...linksByOrderId.keys()] } },
            select: { salesOrderId: true, progressInvoiced: true },
          }),
        ])
      : [[], []];
  const sharedNfeExternalIds = resolveSharedNfeExternalIds(nfeOrderPairs);
  const progressInvoicedByOrderId = new Map(
    flowSnapshots.map((row) => [row.salesOrderId, decimalToNumber(row.progressInvoiced)])
  );

  const result = new Map<string, SalesOrderLinkedNfeContext>();
  for (const order of orders) {
    result.set(
      order.id,
      buildSalesOrderLinkedNfeContext({
        links: linksByOrderId.get(order.id) ?? [],
        nomusNfesByExternalId: nomusByExternalId,
        totalNetValue: decimalToNumber(order.totalNetValue),
        issueDate: order.issueDate,
        expectedDeliveryDate: order.expectedDeliveryDate,
        referenceDate,
        nomusRawResponse: order.nomusRawResponse,
        sharedNfeExternalIds,
        operationalInvoicing: progressInvoicedByOrderId.has(order.id)
          ? { progressInvoicedPercent: progressInvoicedByOrderId.get(order.id) }
          : null,
      })
    );
  }

  return result;
}

export function computeAverageLinkedNfeSlaDays(
  contexts: Iterable<SalesOrderLinkedNfeContext>
): number | null {
  const values: number[] = [];
  for (const context of contexts) {
    if (context.daysToInvoice != null && Number.isFinite(context.daysToInvoice)) {
      values.push(context.daysToInvoice);
    }
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type SalesOrderLinkedNfeContextLoader = typeof loadSalesOrderLinkedNfeContextMap;
