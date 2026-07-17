/**
 * DS-03.9 — Resolver financeiro read-only de Documento de Saída.
 *
 * Precedência oficial: CR real > condição comprovada do Documento > previsão do Pedido.
 * Fonte oficial do CR: NomusAccountsReceivable (via NF / sourceInvoiceId).
 * Não inventa parcelas nem vencimentos. Não altera dados financeiros.
 * Evita dupla contagem Documento × NF × CR.
 */

import {
  classifyNfeVsReceivablesSum,
  classifyReceivableDueStatus,
  classifyReceivableSettlement,
  moneyCentsToNumber,
  resolveFinancialEvidenceWithoutDoubleCount,
  toMoneyCents,
  type FinancialEvidenceSource,
  type ReceivableDueStatus,
  type ReceivableSettlementStatus,
} from "@/src/lib/output-documents/auditOutputDocumentsFinancial.js";
import { isNomusNfeCancelledStatus } from "@/src/lib/output-documents/auditOutputDocumentsLinks.js";

/* -------------------------------------------------------------------- */
/*  Status e DTOs                                                         */
/* -------------------------------------------------------------------- */

export type OutputDocumentFinancialStatus =
  | "aguardando_cr"
  | "cr_em_aberto"
  | "parcialmente_recebido"
  | "recebido"
  | "vencido"
  | "sem_informacao_financeira"
  | "cancelado";

export type OutputDocumentFinancialOrigin = FinancialEvidenceSource;

export type OutputDocumentFinancialTitleDto = {
  receivableExternalId: number;
  sourceInvoiceId: number | null;
  amountReceivableCents: number;
  amountReceivable: number;
  amountReceivedCents: number;
  amountReceived: number;
  balanceReceivableCents: number;
  balanceReceivable: number;
  dueDate: string | null;
  settlementDate: string | null;
  settlement: ReceivableSettlementStatus;
  dueStatus: ReceivableDueStatus;
  alerts: string[];
};

export type OutputDocumentFinancialStatusResult = {
  stockDocumentExternalId: number;
  status: OutputDocumentFinancialStatus;
  statusReasons: string[];
  /** Origem sem dupla contagem (CR > documento > pedido). */
  financialOrigin: OutputDocumentFinancialOrigin;
  financialOriginReasons: string[];
  nfeExternalId: number | null;
  nfeCancelled: boolean;
  documentCancelled: boolean;
  /** Totais oficiais do CR (não soma Documento+CR). */
  receivableTotalCents: number;
  receivableTotal: number;
  openCents: number;
  open: number;
  receivedCents: number;
  received: number;
  /** Próximo vencimento entre títulos em aberto/parcial — nunca inventado. */
  nextDueDate: string | null;
  titles: OutputDocumentFinancialTitleDto[];
  /** Quantidade de títulos CR (parcelas oficiais). */
  installmentCount: number;
  /** Condição do documento só como evidência textual local (sem parcelas inventadas). */
  documentPaymentTermsRaw: string | null;
  hasDocumentPaymentTermsEvidence: boolean;
  /** Previsão do pedido (centavos) — só entra se CR/documento não cobrirem. */
  orderForecastCents: number;
  orderForecast: number;
  dominantCoverageCents: number;
  dominantCoverage: number;
  nfeVsReceivables:
    | "ok"
    | "arredondamento"
    | "divergente"
    | "sem_titulos"
    | "sem_nfe_valor"
    | "nao_aplicavel";
  alerts: string[];
};

/* -------------------------------------------------------------------- */
/*  Input                                                                 */
/* -------------------------------------------------------------------- */

export type OutputDocumentFinancialReceivableInput = {
  id?: string | null;
  externalId: number;
  sourceInvoiceId?: number | null;
  amountReceivable?: unknown;
  amountReceived?: unknown;
  balanceReceivable?: unknown;
  dueDate?: Date | string | null;
  settlementDate?: Date | string | null;
  /** Flag operacional Nomus (não é quitação). */
  status?: boolean | null;
};

export type OutputDocumentFinancialStatusInput = {
  stockDocumentExternalId: number;
  idNfe?: number | null;
  isCancelled?: boolean;
  /** Condição local do documento (string). Sem parsing de parcelas. */
  paymentTermsRaw?: string | null;
  /** Valor do documento (stage) — evidência, não inventa títulos. */
  documentTotalValue?: unknown;
  /** Valor da NF local (quando conhecido). */
  nfeValue?: unknown;
  nfeStatus?: number | null;
  /** Títulos CR oficiais ligados à NF. */
  receivables?: ReadonlyArray<OutputDocumentFinancialReceivableInput>;
  /**
   * Previsão financeira do pedido (centavos ou valor).
   * Só usada na precedência; nunca gera parcelas/vencimentos.
   */
  orderForecastValue?: unknown;
  referenceDate?: Date;
};

/* -------------------------------------------------------------------- */
/*  Helpers                                                               */
/* -------------------------------------------------------------------- */

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(String(value).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function dedupeReceivables(
  rows: ReadonlyArray<OutputDocumentFinancialReceivableInput>
): OutputDocumentFinancialReceivableInput[] {
  const byExt = new Map<number, OutputDocumentFinancialReceivableInput>();
  for (const row of rows) {
    if (!Number.isFinite(row.externalId) || row.externalId <= 0) continue;
    if (!byExt.has(row.externalId)) byExt.set(row.externalId, row);
  }
  return [...byExt.values()].sort((a, b) => a.externalId - b.externalId);
}

function deriveBalanceCents(row: OutputDocumentFinancialReceivableInput): {
  amountReceivableCents: number;
  amountReceivedCents: number;
  balanceReceivableCents: number;
} {
  const amountReceivableCents = toMoneyCents(row.amountReceivable);
  const amountReceivedCents = toMoneyCents(row.amountReceived);
  let balanceReceivableCents = toMoneyCents(row.balanceReceivable);
  // Se balance ausente, deriva sem inventar recebimentos além do informado.
  if (row.balanceReceivable == null && row.amountReceivable != null) {
    balanceReceivableCents = Math.max(
      0,
      amountReceivableCents - amountReceivedCents
    );
  }
  return { amountReceivableCents, amountReceivedCents, balanceReceivableCents };
}

/**
 * Agrega status do documento a partir dos títulos oficiais.
 * Prioridade: vencido > parcialmente_recebido > recebido > cr_em_aberto.
 */
export function aggregateDocumentFinancialStatusFromTitles(
  titles: ReadonlyArray<Pick<OutputDocumentFinancialTitleDto, "settlement" | "dueStatus">>
): {
  status: Exclude<
    OutputDocumentFinancialStatus,
    "aguardando_cr" | "sem_informacao_financeira" | "cancelado"
  >;
  reasons: string[];
} {
  if (titles.length === 0) {
    return { status: "cr_em_aberto", reasons: ["Sem títulos para agregar."] };
  }

  const hasOverdue = titles.some((t) => t.dueStatus === "vencido");
  const allReceived = titles.every((t) => t.settlement === "recebido");
  const anyReceived = titles.some((t) => t.settlement === "recebido");
  const anyPartial = titles.some((t) => t.settlement === "parcial");
  const anyOpen = titles.some((t) => t.settlement === "aberto");

  if (hasOverdue) {
    return {
      status: "vencido",
      reasons: ["Há título CR em aberto/parcial com vencimento passado."],
    };
  }
  if (allReceived) {
    return {
      status: "recebido",
      reasons: ["Todos os títulos CR estão recebidos."],
    };
  }
  if (anyPartial || (anyReceived && anyOpen)) {
    return {
      status: "parcialmente_recebido",
      reasons: ["Há recebimento parcial ou mistura de títulos abertos e recebidos."],
    };
  }
  return {
    status: "cr_em_aberto",
    reasons: ["Títulos CR em aberto sem recebimento."],
  };
}

/* -------------------------------------------------------------------- */
/*  Core                                                                  */
/* -------------------------------------------------------------------- */

/**
 * Resolve a situação financeira oficial do Documento de Saída (read-only).
 */
export function resolveOutputDocumentFinancialStatus(
  input: OutputDocumentFinancialStatusInput
): OutputDocumentFinancialStatusResult {
  const referenceDate = input.referenceDate ?? new Date();
  const alerts: string[] = [];
  const statusReasons: string[] = [];

  const documentCancelled = input.isCancelled === true;
  const nfeExternalId =
    typeof input.idNfe === "number" && input.idNfe > 0 ? input.idNfe : null;
  const nfeCancelled = isNomusNfeCancelledStatus(input.nfeStatus);
  const paymentTermsRaw =
    typeof input.paymentTermsRaw === "string" && input.paymentTermsRaw.trim()
      ? input.paymentTermsRaw.trim()
      : null;
  const hasDocumentPaymentTermsEvidence = paymentTermsRaw != null;

  const receivables = dedupeReceivables(input.receivables ?? []);
  const titles: OutputDocumentFinancialTitleDto[] = [];

  for (const row of receivables) {
    const money = deriveBalanceCents(row);
    const settlement = classifyReceivableSettlement(money);
    const dueDate = toDate(row.dueDate);
    const dueStatus = classifyReceivableDueStatus({
      dueDate,
      referenceDate,
      settlement: settlement.status,
    });
    const titleAlerts: string[] = [];
    if (dueStatus === "vencido") titleAlerts.push("RECEIVABLE_OVERDUE");
    if (dueStatus === "sem_vencimento" && settlement.status !== "recebido") {
      titleAlerts.push("RECEIVABLE_WITHOUT_DUE_DATE");
    }

    titles.push({
      receivableExternalId: row.externalId,
      sourceInvoiceId: row.sourceInvoiceId ?? nfeExternalId,
      amountReceivableCents: money.amountReceivableCents,
      amountReceivable: moneyCentsToNumber(money.amountReceivableCents),
      amountReceivedCents: money.amountReceivedCents,
      amountReceived: moneyCentsToNumber(money.amountReceivedCents),
      balanceReceivableCents: Math.max(0, money.balanceReceivableCents),
      balanceReceivable: moneyCentsToNumber(Math.max(0, money.balanceReceivableCents)),
      dueDate: toIsoDate(dueDate),
      settlementDate: toIsoDate(row.settlementDate),
      settlement: settlement.status,
      dueStatus,
      alerts: titleAlerts,
    });
  }

  const receivableTotalCents = titles.reduce(
    (s, t) => s + t.amountReceivableCents,
    0
  );
  const openCents = titles
    .filter((t) => t.settlement !== "recebido")
    .reduce((s, t) => s + t.balanceReceivableCents, 0);
  const receivedCents = titles.reduce((s, t) => s + t.amountReceivedCents, 0);

  const nextDueDate = (() => {
    const openDates = titles
      .filter((t) => t.settlement !== "recebido" && t.dueDate)
      .map((t) => t.dueDate!)
      .sort((a, b) => a.localeCompare(b));
    return openDates[0] ?? null;
  })();

  const documentCents = hasDocumentPaymentTermsEvidence
    ? toMoneyCents(input.documentTotalValue)
    : 0;
  const orderForecastCents = toMoneyCents(input.orderForecastValue);
  const evidence = resolveFinancialEvidenceWithoutDoubleCount({
    receivableCents: receivableTotalCents,
    documentCents,
    orderForecastCents,
  });

  const nfeValueCents = toMoneyCents(input.nfeValue);
  const nfeVs =
    nfeExternalId == null
      ? ({ status: "nao_aplicavel" as const, reasons: ["Sem NF."] })
      : titles.length === 0
        ? ({ status: "sem_titulos" as const, reasons: ["NF sem títulos CR."] })
        : classifyNfeVsReceivablesSum({
            nfeValueCents,
            titlesAmountReceivableCents: receivableTotalCents,
          });

  // Alertas de vínculo
  if (documentCancelled) alerts.push("DOCUMENT_CANCELLED");
  if (nfeCancelled) alerts.push("NFE_CANCELLED");
  if (nfeExternalId == null) alerts.push("DOCUMENT_WITHOUT_NFE");
  if (nfeExternalId != null && titles.length === 0 && !nfeCancelled) {
    alerts.push("NFE_WITHOUT_RECEIVABLES");
  }
  if (titles.some((t) => t.dueStatus === "vencido")) {
    alerts.push("RECEIVABLE_OVERDUE");
  }
  if (nfeVs.status === "divergente") {
    alerts.push("NFE_RECEIVABLE_SUM_DIVERGENT");
  }
  if (evidence.wouldDoubleCountIfSummed) {
    alerts.push("FINANCIAL_DOUBLE_COUNT_PREVENTED");
  }
  if (
    nfeExternalId == null &&
    titles.length === 0 &&
    !hasDocumentPaymentTermsEvidence &&
    orderForecastCents <= 0
  ) {
    alerts.push("FINANCIAL_LINK_UNRESOLVED");
  }

  // Status do documento
  let status: OutputDocumentFinancialStatus;
  if (documentCancelled || nfeCancelled) {
    status = "cancelado";
    statusReasons.push(
      documentCancelled
        ? "Documento de Saída marcado como cancelado no stage."
        : "NF-e vinculada cancelada (status 7)."
    );
  } else if (titles.length > 0) {
    const agg = aggregateDocumentFinancialStatusFromTitles(titles);
    status = agg.status;
    statusReasons.push(...agg.reasons);
  } else if (nfeExternalId != null) {
    status = "aguardando_cr";
    statusReasons.push(
      "NF presente, mas nenhum NomusAccountsReceivable com sourceInvoiceId correspondente."
    );
  } else {
    status = "sem_informacao_financeira";
    statusReasons.push(
      "Sem NF e sem títulos CR oficiais; condição/previsão não inventam parcelas."
    );
  }

  return {
    stockDocumentExternalId: input.stockDocumentExternalId,
    status,
    statusReasons,
    financialOrigin: evidence.source,
    financialOriginReasons: evidence.reasons,
    nfeExternalId,
    nfeCancelled,
    documentCancelled,
    receivableTotalCents,
    receivableTotal: moneyCentsToNumber(receivableTotalCents),
    openCents,
    open: moneyCentsToNumber(openCents),
    receivedCents,
    received: moneyCentsToNumber(receivedCents),
    nextDueDate,
    titles,
    installmentCount: titles.length,
    documentPaymentTermsRaw: paymentTermsRaw,
    hasDocumentPaymentTermsEvidence,
    orderForecastCents,
    orderForecast: moneyCentsToNumber(orderForecastCents),
    dominantCoverageCents: evidence.dominantCoverageCents,
    dominantCoverage: moneyCentsToNumber(evidence.dominantCoverageCents),
    nfeVsReceivables: nfeVs.status,
    alerts: [...new Set(alerts)],
  };
}
