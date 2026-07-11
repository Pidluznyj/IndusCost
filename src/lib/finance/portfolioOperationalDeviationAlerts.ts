/**
 * Alertas operacionais de desvio — Central de Auditoria da Carteira (read-only).
 *
 * Identifica lacunas entre pedido planejado, entrega, documento, NF, CR e baixa.
 * Não altera Fluxo de Caixa, Contas a Receber oficial nem faz write.
 *
 * Regras isoladas e testáveis; consomem evidências já materializadas / fulfillment map.
 */

import type { PortfolioOrderFulfillmentMap } from "./portfolioOrderFulfillmentMap.js";

export type OperationalDeviationSeverity = "INFO" | "WARNING" | "CRITICAL";

export type OperationalDeviationAlertCode =
  | "ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO"
  | "RECEBIMENTO_PREVISTO_PROXIMO_SEM_CR"
  | "DOCUMENTO_PARCIAL"
  | "DOCUMENTO_COM_EXCEDENTE"
  | "DOCUMENTO_COM_PRODUTO_FORA_PEDIDO"
  | "NF_DOCUMENTO_SEM_CR"
  | "CR_DIFERE_DA_CONDICAO_PEDIDO"
  | "BAIXA_RECENTE_NAO_REFLETIDA";

export type OperationalDeviationAlert = {
  code: OperationalDeviationAlertCode;
  severity: OperationalDeviationSeverity;
  title: string;
  message: string;
  actionRecommendation: string;
  affectedValue: number | null;
  affectedItems: string[];
  evidenceSource: string;
};

export type OperationalDeviationItemHint = {
  productCode?: string | null;
  sku?: string | null;
  description?: string | null;
  expectedDate?: string | null;
  orderedQuantity?: number | null;
  remainingQuantity?: number | null;
  excessQuantity?: number | null;
};

export type BuildOperationalDeviationAlertsInput = {
  orderCode: string;
  orderValue: number;
  asOfDate?: string | null;
  expectedDeliveryDate?: string | null;
  forecastDate?: string | null;
  forecastSource?: string | null;
  hasStockDocument: boolean;
  hasNfe: boolean;
  hasReceivable: boolean;
  hasOpenReceivable?: boolean;
  receivedValue?: number | null;
  openReceivableValue?: number | null;
  receivableDueDate?: string | null;
  receivableSettlementDate?: string | null;
  /** Diferença material CR vs previsão do pedido (dias). Default 7. */
  crDueDiffThresholdDays?: number;
  /** Horizonte “recebimento próximo” (dias). Default 15. */
  nearReceiptHorizonDays?: number;
  fulfillmentMap?: PortfolioOrderFulfillmentMap | null;
  items?: readonly OperationalDeviationItemHint[] | null;
  /**
   * Evidência objetiva de baixa/settlement posterior à run materializada.
   * Sem isso, BAIXA_RECENTE_NAO_REFLETIDA NÃO é emitido.
   */
  settlementEvidenceAfterRun?: boolean | null;
  /** Run usada não é a SUCCESS mais recente. */
  runIsLatest?: boolean | null;
  /** Flag explícita de dado desatualizado (ex.: DADO_DESATUALIZADO / freshness). */
  dataStaleFlag?: boolean | null;
};

const NEAR_RECEIPT_DEFAULT_DAYS = 15;
const CR_DIFF_DEFAULT_DAYS = 7;
const DELIVERY_OVERDUE_CRITICAL_DAYS = 60;

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toIsoDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 86_400_000);
}

function formatBrDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function itemLabel(it: OperationalDeviationItemHint): string {
  const code = (it.productCode ?? it.sku ?? "").trim();
  if (code) return code;
  const desc = (it.description ?? "").trim();
  if (desc) return desc.slice(0, 40);
  return "item do pedido";
}

function hasCr(input: BuildOperationalDeviationAlertsInput): boolean {
  if (input.hasReceivable) return true;
  if (input.hasOpenReceivable) return true;
  if (toNumber(input.openReceivableValue) > 0.01) return true;
  if (toNumber(input.receivedValue) > 0.01) return true;
  const map = input.fulfillmentMap;
  if (map) {
    const s = map.fulfillmentSummary;
    if (toNumber(s.receivableTotalValue ?? s.receivableTotal) > 0.01) return true;
    if (toNumber(s.openReceivableValue) > 0.01) return true;
    if (toNumber(s.receivedValue) > 0.01) return true;
    if ((map.receivablesCoverage?.length ?? 0) > 0) return true;
  }
  return false;
}

function hasDocumentOrNfe(input: BuildOperationalDeviationAlertsInput): boolean {
  if (input.hasNfe || input.hasStockDocument) return true;
  const map = input.fulfillmentMap;
  if (!map) return false;
  return (map.stockDocumentsCoverage?.length ?? 0) > 0;
}

/**
 * Detecta desvios operacionais entre planejamento e evidências materializadas.
 */
export function buildOperationalDeviationAlerts(
  input: BuildOperationalDeviationAlertsInput
): OperationalDeviationAlert[] {
  const asOf = toIsoDate(input.asOfDate) ?? startOfDayIso();
  const alerts: OperationalDeviationAlert[] = [];
  const map = input.fulfillmentMap ?? null;
  const orderCode = input.orderCode || "pedido";
  const orderValue = round2(toNumber(input.orderValue));
  const nearHorizon = input.nearReceiptHorizonDays ?? NEAR_RECEIPT_DEFAULT_DAYS;
  const crDiffThreshold = input.crDueDiffThresholdDays ?? CR_DIFF_DEFAULT_DAYS;

  const coverageItems =
    map?.orderItemsCoverage?.map((r) => ({
      productCode: r.productCode,
      sku: r.sku,
      description: r.description,
      expectedDate: null as string | null,
      orderedQuantity: r.orderedQuantity,
      remainingQuantity: r.remainingQuantity,
      excessQuantity: r.excessQuantityForThisProduct,
    })) ?? [];

  const hintItems = [...(input.items ?? [])];
  const items: OperationalDeviationItemHint[] =
    hintItems.length > 0
      ? hintItems.map((h) => {
          const match = coverageItems.find(
            (c) =>
              (h.productCode && c.productCode === h.productCode) ||
              (h.sku && c.sku === h.sku)
          );
          return {
            ...h,
            remainingQuantity: h.remainingQuantity ?? match?.remainingQuantity ?? null,
            orderedQuantity: h.orderedQuantity ?? match?.orderedQuantity ?? null,
            excessQuantity: h.excessQuantity ?? match?.excessQuantity ?? null,
          };
        })
      : coverageItems;

  // 1) ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO
  if (!input.hasStockDocument && !(map && map.stockDocumentsCoverage.some((d) => d.stockDocumentExternalId != null))) {
    const overdueItems = items.filter((it) => {
      const expected = toIsoDate(it.expectedDate);
      return expected != null && expected < asOf;
    });
    const orderExpected = toIsoDate(input.expectedDeliveryDate);
    const orderOverdue = orderExpected != null && orderExpected < asOf;

    if (overdueItems.length > 0 || orderOverdue) {
      const worstDate =
        overdueItems
          .map((it) => toIsoDate(it.expectedDate))
          .filter((d): d is string => Boolean(d))
          .sort()[0] ?? orderExpected;
      const overdueDays = worstDate ? daysBetween(worstDate, asOf) : 0;
      const severity: OperationalDeviationSeverity =
        overdueDays > DELIVERY_OVERDUE_CRITICAL_DAYS ? "CRITICAL" : "WARNING";
      const labels = overdueItems.length
        ? overdueItems.map(itemLabel)
        : [orderCode];
      const sample = overdueItems[0];
      const sampleLabel = sample ? itemLabel(sample) : orderCode;
      const sampleDate = formatBrDate(
        toIsoDate(sample?.expectedDate) ?? orderExpected
      );
      alerts.push({
        code: "ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO",
        severity,
        title: "Entrega prevista vencida sem documento",
        message: `Item ${sampleLabel} tinha entrega prevista para ${sampleDate}, mas não encontramos documento de saída até a última atualização. Valide com Comercial/PCP se o pedido ainda é real ou se a previsão deve ser atualizada.`,
        actionRecommendation:
          "Confirmar com Comercial/PCP a entrega real ou atualizar a data prevista no pedido.",
        affectedValue: orderValue,
        affectedItems: labels,
        evidenceSource: "expectedDeliveryDate / item.expectedDate · ausência de documento de saída",
      });
    }
  }

  // 2) RECEBIMENTO_PREVISTO_PROXIMO_SEM_CR
  if (!hasCr(input)) {
    const receiptDate =
      toIsoDate(input.forecastDate) ?? toIsoDate(input.expectedDeliveryDate);
    if (receiptDate) {
      const delta = daysBetween(asOf, receiptDate);
      if (delta >= 0 && delta <= nearHorizon) {
        alerts.push({
          code: "RECEBIMENTO_PREVISTO_PROXIMO_SEM_CR",
          severity: "WARNING",
          title: "Recebimento próximo sem Contas a Receber",
          message: `O pedido ${orderCode} tem recebimento previsto para ${formatBrDate(receiptDate)} (próximos ${nearHorizon} dias), mas ainda não há Contas a Receber vinculado. Sem CR, o valor não está formalizado financeiramente.`,
          actionRecommendation:
            "Verificar faturamento e abertura do Contas a Receber antes de tratar como caixa previsto.",
          affectedValue: orderValue,
          affectedItems: [orderCode],
          evidenceSource: "forecastDate/expectedDeliveryDate · ausência de CR",
        });
      }
    }
  }

  // 3) DOCUMENTO_PARCIAL
  const op = map?.operationalStatus;
  const remaining =
    map?.fulfillmentSummary.totalRemainingQuantity ??
    map?.fulfillmentSummary.remainingQuantity ??
    null;
  const isPartial =
    op === "OP_PARCIALMENTE_ATENDIDO" ||
    (remaining != null && remaining > 0.000001 && hasDocumentOrNfe(input));
  if (isPartial && hasDocumentOrNfe(input)) {
    const pending = items
      .filter((it) => toNumber(it.remainingQuantity) > 0.000001)
      .map(itemLabel);
    alerts.push({
      code: "DOCUMENTO_PARCIAL",
      severity: "WARNING",
      title: "Documento parcial",
      message: `Já existe documento de saída para o pedido ${orderCode}, mas nem todos os itens/quantidades foram atendidos. Ainda há saldo pendente de entrega.`,
      actionRecommendation:
        "Conferir remessas restantes com PCP/Expedição e atualizar o vínculo do pedido.",
      affectedValue: orderValue,
      affectedItems: pending.length ? pending : [orderCode],
      evidenceSource: "fulfillmentMap.operationalStatus / remainingQuantity",
    });
  }

  // 4) DOCUMENTO_COM_EXCEDENTE
  const excessQty =
    map?.fulfillmentSummary.totalExcessQuantity ??
    items.reduce((s, it) => s + toNumber(it.excessQuantity), 0);
  const hasExcess =
    Boolean(map?.fulfillmentSummary.hasExcessQuantity) ||
    excessQty > 0.000001 ||
    op === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE" ||
    (map?.technicalAlerts ?? []).includes("QUANTIDADE_EXCEDENTE_DOCUMENTO");
  if (hasExcess) {
    const excessItems = items
      .filter((it) => toNumber(it.excessQuantity) > 0.000001)
      .map(itemLabel);
    alerts.push({
      code: "DOCUMENTO_COM_EXCEDENTE",
      severity: "WARNING",
      title: "Documento com quantidade excedente",
      message: `Os documentos de saída somam quantidade maior que a pedida no ${orderCode}. O excedente não aumenta o valor do pedido e deve ser tratado à parte.`,
      actionRecommendation:
        "Revisar remessa/vínculo: conferir se houve envio a maior ou produto de outro pedido.",
      affectedValue: round2(toNumber(map?.fulfillmentSummary.attributedOrderValue)),
      affectedItems: excessItems.length ? excessItems : [orderCode],
      evidenceSource: "fulfillmentSummary.totalExcessQuantity / surplusItems",
    });
  }

  // 5) DOCUMENTO_COM_PRODUTO_FORA_PEDIDO
  const hasOutside =
    Boolean(map?.fulfillmentSummary.hasProductsOutsideOrder) ||
    (map?.technicalAlerts ?? []).includes("PRODUTO_FORA_DO_PEDIDO") ||
    (map?.stockDocumentsCoverage ?? []).some(
      (d) => (d.itemsOutsideOrder?.length ?? d.unmatchedItems?.length ?? 0) > 0
    );
  if (hasOutside) {
    const outsideLabels: string[] = [];
    for (const doc of map?.stockDocumentsCoverage ?? []) {
      for (const x of doc.itemsOutsideOrder ?? doc.unmatchedItems ?? []) {
        outsideLabels.push(
          String(x.productCode ?? x.productExternalId ?? x.externalProductId ?? "produto")
        );
      }
    }
    alerts.push({
      code: "DOCUMENTO_COM_PRODUTO_FORA_PEDIDO",
      severity: "WARNING",
      title: "Produto fora do pedido no documento",
      message: `Há produto no documento de saída que não existe no pedido ${orderCode}. Esse valor não fecha item do pedido e não deve ser somado à carteira do PD.`,
      actionRecommendation:
        "Validar vínculo pedido×documento com Comercial/Fiscal; separar remessa de outro pedido se for o caso.",
      affectedValue: round2(
        toNumber(map?.fulfillmentSummary.nfeHeaderNotAttributedToOrderValue ?? map?.fulfillmentSummary.nfeHeaderNotAttributed)
      ),
      affectedItems: outsideLabels.length ? [...new Set(outsideLabels)] : [orderCode],
      evidenceSource: "stockDocumentsCoverage.itemsOutsideOrder",
    });
  }

  // 6) NF_DOCUMENTO_SEM_CR
  if (hasDocumentOrNfe(input) && !hasCr(input)) {
    alerts.push({
      code: "NF_DOCUMENTO_SEM_CR",
      severity: "WARNING",
      title: "NF/documento sem Contas a Receber",
      message: `O pedido ${orderCode} já tem NF ou documento de saída, mas ainda não encontramos Contas a Receber vinculado. A operação avançou; o financeiro formal pode estar atrasado.`,
      actionRecommendation:
        "Cobrar abertura/sincronização do Contas a Receber e rebuild da conciliação.",
      affectedValue: orderValue,
      affectedItems: [orderCode],
      evidenceSource: "hasNfe/hasStockDocument · ausência de CR",
    });
  }

  // 7) CR_DIFERE_DA_CONDICAO_PEDIDO
  const crDue = toIsoDate(input.receivableDueDate);
  const orderForecast = toIsoDate(input.forecastDate) ?? toIsoDate(input.expectedDeliveryDate);
  const forecastSource = (input.forecastSource ?? "").toUpperCase();
  if (
    crDue &&
    orderForecast &&
    crDue !== orderForecast &&
    forecastSource !== "RECEIVABLE"
  ) {
    const diff = Math.abs(daysBetween(orderForecast, crDue));
    if (diff >= crDiffThreshold) {
      const severity: OperationalDeviationSeverity =
        diff >= 30 ? "WARNING" : "INFO";
      alerts.push({
        code: "CR_DIFERE_DA_CONDICAO_PEDIDO",
        severity,
        title: "Vencimento do CR difere da previsão do pedido",
        message: `O Contas a Receber do pedido ${orderCode} vence em ${formatBrDate(crDue)}, enquanto a previsão do pedido apontava ${formatBrDate(orderForecast)} (diferença de ${diff} dia(s)). O vencimento do CR é a âncora financeira.`,
        actionRecommendation:
          "Usar o vencimento do CR para o forecast; alinhar Comercial se a condição do pedido estiver desatualizada.",
        affectedValue: round2(
          toNumber(input.openReceivableValue) || orderValue
        ),
        affectedItems: [orderCode],
        evidenceSource: "receivableDueDate vs forecastDate/expectedDeliveryDate",
      });
    }
  }

  // 8) BAIXA_RECENTE_NAO_REFLETIDA — só com evidência objetiva (não inventar)
  if (input.settlementEvidenceAfterRun === true) {
    alerts.push({
      code: "BAIXA_RECENTE_NAO_REFLETIDA",
      severity: "WARNING",
      title: "Possível baixa recente ainda não refletida",
      message: `Há indício objetivo de que a baixa/recebimento do pedido ${orderCode} pode estar mais recente do que a run materializada desta tela. O valor só aparece aqui após sincronizar o Contas a Receber e reconstruir a conciliação.`,
      actionRecommendation:
        "Sincronizar Contas a Receber e reconstruir a conciliação antes de decidir com base neste número.",
      affectedValue: round2(toNumber(input.openReceivableValue) || orderValue),
      affectedItems: [orderCode],
      evidenceSource: "settlementEvidenceAfterRun / frescor da run",
    });
  }

  return alerts;
}

/** Codes em ordem estável para testes/UI. */
export const OPERATIONAL_DEVIATION_ALERT_CODES: OperationalDeviationAlertCode[] = [
  "ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO",
  "RECEBIMENTO_PREVISTO_PROXIMO_SEM_CR",
  "DOCUMENTO_PARCIAL",
  "DOCUMENTO_COM_EXCEDENTE",
  "DOCUMENTO_COM_PRODUTO_FORA_PEDIDO",
  "NF_DOCUMENTO_SEM_CR",
  "CR_DIFERE_DA_CONDICAO_PEDIDO",
  "BAIXA_RECENTE_NAO_REFLETIDA",
];
