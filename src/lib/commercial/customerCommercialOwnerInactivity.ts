/**
 * Motor puro da revisão de carteira POL-COM-001 §11.
 * Relógio operacional: última NF / Documento de Saída válido vinculado ao PV.
 * Não usa CR, AR, proposta nem SalesOrder.issueDate como compra realizada.
 */
import { DOCUMENT_INACTIVITY_DAYS } from "@/src/lib/commercialPolicy/commercialPolicyNormative.js";
import { getSaoPauloDateTimeParts } from "@/src/lib/brentCommodityJob.js";
import { CRM_NEXT_ACTION_NONE } from "@/src/lib/commercial/crmContactCatalog.js";
import { normalizeNfeStatus } from "@/src/lib/finance/nfeStatus.js";
import {
  classifyNfeValidity,
  classifyOutputDocumentValidity,
} from "@/src/lib/sales/salesOrderOperationalEvidenceContract.js";

export const PORTFOLIO_INACTIVITY_POLICY_SECTION = "11" as const;
export const PORTFOLIO_INACTIVITY_REASON = "INACTIVITY_90_DAYS" as const;
export const PORTFOLIO_PRESERVED_REASON = "PORTFOLIO_REVIEW_PRESERVED" as const;
export const NEVER_INVOICED = "NEVER_INVOICED" as const;
export const DATA_ANOMALY = "DATA_ANOMALY" as const;
export const MISSING_INVOICE_DATE = "MISSING_INVOICE_DATE" as const;
/** @deprecated alias estável: a classificação operacional passou a ser NEVER_INVOICED. */
export const NEVER_APPROVED_SALES_ORDER = NEVER_INVOICED;

export const APPROVED_SALES_ORDER_STATUS = "SENT_TO_NOMUS" as const;
export const INVALID_SALES_ORDER_STATUSES = ["CANCELLED", "ERROR"] as const;
export const UNAPPROVED_SALES_ORDER_STATUSES = ["DRAFT", "READY_TO_SEND"] as const;

export const INACTIVITY_END_REASON_LABEL = `Inatividade superior ao período de ${DOCUMENT_INACTIVITY_DAYS} dias sem justificativa comercial válida no CRM`;

export type PortfolioConceptualStatus =
  | "ACTIVE"
  | "REVIEW_DUE"
  | "PRESERVED_BY_CRM"
  | "REMOVAL_ELIGIBLE"
  | "UNASSIGNED"
  | "NEVER_APPROVED"
  | "NEVER_INVOICED"
  | "DATA_ANOMALY";

export type PortfolioInactivityAction = "KEEP_OWNER" | "REMOVE_OWNER" | "REVIEW_REQUIRED" | "NO_CHANGE";

export type LastApprovedSalesOrder = {
  id: string;
  orderCode: string;
  issueDate: Date;
  status: string;
};

export type InvoiceDateSource =
  | "NFE_XML_DH_EMI"
  | "STOCK_DOCUMENT_DATE"
  | "NFE_PROCESSING_DATE"
  | "MISSING";

export type LastValidInvoice = {
  salesOrderId: string;
  salesOrderCode: string;
  invoiceId: string | null;
  invoiceExternalId: number | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  invoiceDateSource: InvoiceDateSource;
  invoiceStatus: string;
  invoiceValidity: string;
  invoiceCanceled: boolean;
  stockDocumentId: string | null;
  stockDocumentValidity: string | null;
};

export type PortfolioInvoiceCandidate = {
  salesOrderId: string;
  salesOrderCode: string;
  nfeId: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeStatus: number | string | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  xmlCancelamento: string | null;
  stockDocumentId: string | null;
  stockIsCancelled: boolean;
  stockStatusRaw: string | null;
  stockTipo: string | null;
  stockDataDocumento: Date | null;
};

export type PortfolioProposalEvidence = {
  id: string;
  status: string;
  expectedCloseDate: Date | null;
  nextActionAt: Date | null;
  updatedAt: Date;
  number?: number | null;
  externalProposalCode?: string | null;
};

export type PortfolioContactEvidence = {
  id: string;
  contactDate: Date | null;
  createdAt: Date;
  outcome: string | null;
  reason: string | null;
  nextActionType: string | null;
  nextActionAt: Date | null;
};

export type CommercialPortfolioPreservation = {
  valid: boolean;
  reasonCode: string;
  evidenceType: string | null;
  evidenceId: string | null;
  evidenceDate: Date | null;
  nextReviewDate: Date | null;
  /** Diagnóstico de preview. Não entra na decisão KEEP/REMOVE. */
  evidenceStatus: string | null;
  evidenceCode: string | null;
  evidenceAgeDays: number | null;
  evidenceDateSource: string | null;
  nextStep: string | null;
  nextStepDate: Date | null;
  preservationReason: string | null;
};

export type PortfolioDecisionInput = {
  hasActiveOwner: boolean;
  lastValidInvoice?: LastValidInvoice | null;
  /** @deprecated fallback só para testes/API antiga; o relógio oficial é lastValidInvoice */
  lastApprovedOrder?: LastApprovedSalesOrder | null;
  invoiceClockKind?: "INVOICE" | "NEVER_INVOICED" | "DATA_ANOMALY";
  referenceDate: Date;
  preservation: CommercialPortfolioPreservation;
};

export type PortfolioDecision = {
  status: PortfolioConceptualStatus;
  action: PortfolioInactivityAction;
  reasonCode: string;
  daysSinceLastValidInvoice: number | null;
  daysSinceLastApprovedOrder: number | null;
  reviewDue: boolean;
};

const OPEN_PROPOSAL_STATUSES = new Set(["ANALYSIS", "SENT", "APPROVED"]);

const CONCRETE_COMMERCIAL_OUTCOMES = new Set([
  "INTERESTED",
  "REQUESTS_PRESENTATION",
  "REQUESTS_QUOTE",
  "REQUESTS_PROPOSAL_REVISION",
  "NEGOTIATION_ADVANCED",
  "PROPOSAL_PRESENTED",
  "PROPOSAL_ACCEPTED",
  "REQUESTS_PRICE_REVISION",
  "REQUESTS_TERM_REVISION",
  "REQUESTS_QUANTITY_CHANGE",
  "AWAITING_CUSTOMER_APPROVAL",
  "NEGOTIATION_WON",
  "REQUESTS_DISCOUNT",
  "REQUESTS_PAYMENT_CONDITION",
  "REQUESTS_DELIVERY_TERM",
  "NEW_OPPORTUNITY",
  "REQUESTS_NEW_ORDER",
  "REACTIVATED",
  "CUSTOMER_HAS_QUESTION",
  "UNDER_ANALYSIS",
  "NEEDS_CUSTOMER_REPLY",
]);

const DOCUMENTED_PAUSE_OUTCOMES = new Set(["NO_DEMAND_NOW", "REQUESTS_LATER_CONTACT", "RESUME_LATER"]);

const GENERIC_OR_TERMINAL_OUTCOMES = new Set([
  "RELATIONSHIP_MAINTAINED",
  "AWAITING_REPLY",
  "AWAITING_DECISION",
  "OTHER_RESULT",
  "NO_ACTION_NEEDED",
  "UNREACHABLE",
  "INVALID_CONTACT",
  "NOT_INTERESTED_NOW",
  "DOES_NOT_WANT_TO_RESUME",
  "NEGOTIATION_ENDED",
  "NEGOTIATION_LOST",
  "PROPOSAL_REJECTED",
  "CUSTOMER_RESPONDED",
  "MATTER_RESOLVED",
  "COMPLAINT_RESOLVED",
]);

const CONCRETE_NEXT_ACTIONS = new Set([
  "PREPARE_QUOTE",
  "SEND_PROPOSAL",
  "REVISE_PROPOSAL",
  "NEGOTIATE_PRICE",
  "NEGOTIATE_PAYMENT_TERMS",
  "CONFIRM_ORDER",
  "REACTIVATE_CUSTOMER",
  "VISIT_CUSTOMER",
  "SEND_CATALOG",
  "SEND_PRESENTATION",
  "SEND_EMAIL",
  "SEND_WHATSAPP",
  "CALL_AGAIN",
]);

export function portfolioInactivityDays(): number {
  return DOCUMENT_INACTIVITY_DAYS;
}

export function isApprovedSalesOrderStatus(status: string | null | undefined): boolean {
  return status === APPROVED_SALES_ORDER_STATUS;
}

export function isInvalidForCommercialClock(status: string | null | undefined): boolean {
  return (INVALID_SALES_ORDER_STATUSES as readonly string[]).includes(String(status ?? ""));
}

export function saoPauloDateIso(at: Date): string {
  return getSaoPauloDateTimeParts(at).dateIso;
}

export function calendarDaysBetweenSaoPaulo(from: Date, to: Date): number {
  const start = Date.parse(`${saoPauloDateIso(from)}T00:00:00.000Z`);
  const end = Date.parse(`${saoPauloDateIso(to)}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export function firstOfNextSaoPauloMonth(at: Date): Date {
  const parts = getSaoPauloDateTimeParts(at);
  const year = parts.month === 12 ? parts.year + 1 : parts.year;
  const month = parts.month === 12 ? 1 : parts.month + 1;
  const iso = `${year}-${String(month).padStart(2, "0")}-01`;
  return new Date(`${iso}T15:00:00.000Z`);
}

export function isPortfolioReviewDue(input: {
  lastValidInvoiceDate?: Date | null;
  lastApprovedIssueDate?: Date | null;
  referenceDate: Date;
  inactivityDays?: number;
}): boolean {
  const lastDate = input.lastValidInvoiceDate ?? input.lastApprovedIssueDate ?? null;
  if (!lastDate) return false;
  const days = calendarDaysBetweenSaoPaulo(lastDate, input.referenceDate);
  return days >= (input.inactivityDays ?? portfolioInactivityDays());
}

function contactInstant(contact: PortfolioContactEvidence): Date {
  return contact.contactDate ?? contact.createdAt;
}

function isFutureOrToday(date: Date | null, referenceDate: Date): boolean {
  if (!date) return false;
  return calendarDaysBetweenSaoPaulo(referenceDate, date) >= 0;
}

function isStaleContact(contact: PortfolioContactEvidence, referenceDate: Date): boolean {
  return calendarDaysBetweenSaoPaulo(contactInstant(contact), referenceDate) >= portfolioInactivityDays();
}

const NO_DIAGNOSTICS = {
  evidenceStatus: null,
  evidenceCode: null,
  evidenceAgeDays: null,
  evidenceDateSource: null,
  nextStep: null,
  nextStepDate: null,
  preservationReason: null,
} as const;

export function formatProposalEvidenceCode(proposal: PortfolioProposalEvidence): string {
  const external = proposal.externalProposalCode?.trim();
  if (external) return external;
  if (proposal.number != null) return String(proposal.number);
  return proposal.id;
}

function resolveProposalEvidenceDate(proposal: PortfolioProposalEvidence): {
  date: Date;
  source: "expectedCloseDate" | "nextActionAt" | "updatedAt";
} {
  if (proposal.expectedCloseDate) {
    return { date: proposal.expectedCloseDate, source: "expectedCloseDate" };
  }
  if (proposal.nextActionAt) {
    return { date: proposal.nextActionAt, source: "nextActionAt" };
  }
  return { date: proposal.updatedAt, source: "updatedAt" };
}

function proposalDiagnostics(
  proposal: PortfolioProposalEvidence,
  evidenceType: string,
  referenceDate: Date
): Pick<
  CommercialPortfolioPreservation,
  | "evidenceStatus"
  | "evidenceCode"
  | "evidenceAgeDays"
  | "evidenceDateSource"
  | "nextStep"
  | "nextStepDate"
  | "preservationReason"
> {
  const picked = resolveProposalEvidenceDate(proposal);
  const code = formatProposalEvidenceCode(proposal);
  const currentIso = saoPauloDateIso(proposal.updatedAt);
  return {
    evidenceStatus: proposal.status,
    evidenceCode: code,
    evidenceAgeDays: calendarDaysBetweenSaoPaulo(proposal.updatedAt, referenceDate),
    evidenceDateSource: picked.source,
    nextStep: null,
    nextStepDate: proposal.nextActionAt,
    preservationReason: `${evidenceType}: proposta ${code} em ${proposal.status}; considerada atual por ${picked.source}=${saoPauloDateIso(picked.date)} (atualizada em ${currentIso}).`,
  };
}

function contactDiagnostics(
  contact: PortfolioContactEvidence,
  evidenceType: string,
  evidenceDate: Date | null,
  dateSource: string,
  referenceDate: Date
): Pick<
  CommercialPortfolioPreservation,
  | "evidenceStatus"
  | "evidenceCode"
  | "evidenceAgeDays"
  | "evidenceDateSource"
  | "nextStep"
  | "nextStepDate"
  | "preservationReason"
> {
  const current = contactInstant(contact);
  const nextStep = contact.nextActionType?.trim() || null;
  return {
    evidenceStatus: contact.outcome?.trim() || contact.reason?.trim() || null,
    evidenceCode: null,
    evidenceAgeDays: calendarDaysBetweenSaoPaulo(current, referenceDate),
    evidenceDateSource: dateSource,
    nextStep,
    nextStepDate: contact.nextActionAt,
    preservationReason: `${evidenceType}: contato ${contact.id}; resultado=${contact.outcome ?? "-"} motivo=${contact.reason ?? "-"}; data=${saoPauloDateIso(evidenceDate ?? current)}; próximo passo=${nextStep ?? "-"}.`,
  };
}

function hasMaterialProposalEvidence(
  proposal: PortfolioProposalEvidence,
  referenceDate: Date
): boolean {
  if (!OPEN_PROPOSAL_STATUSES.has(proposal.status)) return false;
  return (
    isFutureOrToday(proposal.expectedCloseDate, referenceDate) ||
    isFutureOrToday(proposal.nextActionAt, referenceDate)
  );
}

export function evaluateCommercialPortfolioPreservation(input: {
  referenceDate: Date;
  lastApprovedIssueDate: Date | null;
  lastValidInvoiceDate?: Date | null;
  proposals: PortfolioProposalEvidence[];
  contacts: PortfolioContactEvidence[];
}): CommercialPortfolioPreservation {
  const nextReviewDate = firstOfNextSaoPauloMonth(input.referenceDate);
  const lastCommercialDate = input.lastValidInvoiceDate ?? input.lastApprovedIssueDate;

  const openProposal = [...input.proposals]
    .filter((row) => hasMaterialProposalEvidence(row, input.referenceDate))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const technicalProposal = [...input.proposals]
    .filter(
      (row) =>
        OPEN_PROPOSAL_STATUSES.has(row.status) &&
        !hasMaterialProposalEvidence(row, input.referenceDate)
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (openProposal) {
    const projectLike = openProposal.status === "ANALYSIS";
    const evidenceType = projectLike ? "ACTIVE_PROJECT_OR_HOMOLOGATION" : "ACTIVE_PROPOSAL";
    const picked = resolveProposalEvidenceDate(openProposal);
    return {
      valid: true,
      reasonCode: PORTFOLIO_PRESERVED_REASON,
      evidenceType,
      evidenceId: openProposal.id,
      evidenceDate: picked.date,
      nextReviewDate,
      ...proposalDiagnostics(openProposal, evidenceType, input.referenceDate),
    };
  }

  const recentContacts = [...input.contacts]
    .filter((row) => !isStaleContact(row, input.referenceDate))
    .sort((a, b) => contactInstant(b).getTime() - contactInstant(a).getTime());

  for (const contact of recentContacts) {
    const outcome = contact.outcome?.trim() || null;
    const nextAction = contact.nextActionType?.trim() || null;
    const futureStep = isFutureOrToday(contact.nextActionAt, input.referenceDate);

    if (outcome && DOCUMENTED_PAUSE_OUTCOMES.has(outcome) && futureStep) {
      return {
        valid: true,
        reasonCode: PORTFOLIO_PRESERVED_REASON,
        evidenceType: "DOCUMENTED_TEMPORARY_PAUSE",
        evidenceId: contact.id,
        evidenceDate: contact.nextActionAt,
        nextReviewDate,
        ...contactDiagnostics(
          contact,
          "DOCUMENTED_TEMPORARY_PAUSE",
          contact.nextActionAt,
          "nextActionAt",
          input.referenceDate
        ),
      };
    }

    if (
      outcome &&
      CONCRETE_COMMERCIAL_OUTCOMES.has(outcome) &&
      (futureStep || (nextAction && nextAction !== CRM_NEXT_ACTION_NONE && CONCRETE_NEXT_ACTIONS.has(nextAction)))
    ) {
      const evidenceType =
        outcome === "NEGOTIATION_ADVANCED" || outcome === "NEGOTIATION_WON"
          ? "ACTIVE_NEGOTIATION"
          : outcome === "PROPOSAL_PRESENTED" ||
              outcome === "PROPOSAL_ACCEPTED" ||
              outcome === "REQUESTS_PROPOSAL_REVISION"
            ? "ACTIVE_PROPOSAL"
            : "CONCRETE_COMMERCIAL_FACT";
      const evidenceDate = contact.nextActionAt ?? contactInstant(contact);
      return {
        valid: true,
        reasonCode: PORTFOLIO_PRESERVED_REASON,
        evidenceType,
        evidenceId: contact.id,
        evidenceDate,
        nextReviewDate,
        ...contactDiagnostics(
          contact,
          evidenceType,
          evidenceDate,
          contact.nextActionAt ? "nextActionAt" : "contactDate",
          input.referenceDate
        ),
      };
    }

    if (
      futureStep &&
      nextAction &&
      nextAction !== CRM_NEXT_ACTION_NONE &&
      (CONCRETE_NEXT_ACTIONS.has(nextAction) || nextAction === "WAIT_CUSTOMER_REPLY")
    ) {
      return {
        valid: true,
        reasonCode: PORTFOLIO_PRESERVED_REASON,
        evidenceType: "CONFIRMED_FUTURE_NEXT_STEP",
        evidenceId: contact.id,
        evidenceDate: contact.nextActionAt,
        nextReviewDate,
        ...contactDiagnostics(
          contact,
          "CONFIRMED_FUTURE_NEXT_STEP",
          contact.nextActionAt,
          "nextActionAt",
          input.referenceDate
        ),
      };
    }
  }

  const latest =
    recentContacts[0] ??
    [...input.contacts].sort((a, b) => contactInstant(b).getTime() - contactInstant(a).getTime())[0];
  if (!latest) {
    if (technicalProposal) {
      return {
        valid: false,
        reasonCode: "TECHNICAL_UPDATE_ONLY",
        evidenceType: "TECHNICAL_UPDATE_ONLY",
        evidenceId: technicalProposal.id,
        evidenceDate: technicalProposal.updatedAt,
        nextReviewDate: null,
        ...NO_DIAGNOSTICS,
        evidenceStatus: technicalProposal.status,
        evidenceCode: formatProposalEvidenceCode(technicalProposal),
        evidenceAgeDays: calendarDaysBetweenSaoPaulo(technicalProposal.updatedAt, input.referenceDate),
        evidenceDateSource: "updatedAt",
        preservationReason:
          "TECHNICAL_UPDATE_ONLY: proposta aberta sem expectedCloseDate/nextActionAt; updatedAt técnico não preserva.",
      };
    }
    return {
      valid: false,
      reasonCode: "NO_VALID_CRM_EVIDENCE",
      evidenceType: null,
      evidenceId: null,
      evidenceDate: null,
      nextReviewDate: null,
      ...NO_DIAGNOSTICS,
    };
  }

  if (isStaleContact(latest, input.referenceDate)) {
    return {
      valid: false,
      reasonCode: "STALE_CRM_RECORD",
      evidenceType: "STALE_RECORD",
      evidenceId: latest.id,
      evidenceDate: contactInstant(latest),
      nextReviewDate: null,
      ...NO_DIAGNOSTICS,
    };
  }

  const outcome = latest.outcome?.trim() || null;
  const createdAfterReviewDue =
    lastCommercialDate != null &&
    isPortfolioReviewDue({
      lastValidInvoiceDate: lastCommercialDate,
      referenceDate: contactInstant(latest),
    });
  if (createdAfterReviewDue && (!outcome || GENERIC_OR_TERMINAL_OUTCOMES.has(outcome))) {
    return {
      valid: false,
      reasonCode: "ARTIFICIAL_CRM_RECORD",
      evidenceType: "ARTIFICIAL_RECORD",
      evidenceId: latest.id,
      evidenceDate: contactInstant(latest),
      nextReviewDate: null,
      ...NO_DIAGNOSTICS,
    };
  }

  if (!outcome || GENERIC_OR_TERMINAL_OUTCOMES.has(outcome)) {
    const terminal =
      outcome === "NEGOTIATION_ENDED" ||
      outcome === "NEGOTIATION_LOST" ||
      outcome === "PROPOSAL_REJECTED" ||
      outcome === "DOES_NOT_WANT_TO_RESUME";
    return {
      valid: false,
      reasonCode: terminal ? "TERMINAL_RECORD" : "GENERIC_CRM_RECORD",
      evidenceType: terminal ? "TERMINAL_RECORD" : "GENERIC_NOTE",
      evidenceId: latest.id,
      evidenceDate: contactInstant(latest),
      nextReviewDate: null,
      ...NO_DIAGNOSTICS,
    };
  }

  if (!latest.nextActionAt || latest.nextActionType === CRM_NEXT_ACTION_NONE) {
    return {
      valid: false,
      reasonCode: "CRM_WITHOUT_NEXT_STEP",
      evidenceType: "NO_NEXT_STEP",
      evidenceId: latest.id,
      evidenceDate: contactInstant(latest),
      nextReviewDate: null,
      ...NO_DIAGNOSTICS,
    };
  }

  return {
    valid: false,
    reasonCode: "NO_VALID_CRM_EVIDENCE",
    evidenceType: null,
    evidenceId: latest.id,
    evidenceDate: contactInstant(latest),
    nextReviewDate: null,
    ...NO_DIAGNOSTICS,
  };
}

function invoiceFromApprovedOrder(order: LastApprovedSalesOrder): LastValidInvoice {
  return {
    salesOrderId: order.id,
    salesOrderCode: order.orderCode,
    invoiceId: null,
    invoiceExternalId: null,
    invoiceNumber: null,
    invoiceDate: order.issueDate,
    invoiceDateSource: "NFE_XML_DH_EMI",
    invoiceStatus: order.status,
    invoiceValidity: "AUTHORIZED",
    invoiceCanceled: false,
    stockDocumentId: null,
    stockDocumentValidity: null,
  };
}

function resolveLastValidInvoice(input: PortfolioDecisionInput): LastValidInvoice | null {
  if (input.lastValidInvoice !== undefined) return input.lastValidInvoice;
  return input.lastApprovedOrder ? invoiceFromApprovedOrder(input.lastApprovedOrder) : null;
}

function isInvoiceDateAnomaly(invoice: LastValidInvoice | null, clockKind?: PortfolioDecisionInput["invoiceClockKind"]): boolean {
  if (clockKind === "DATA_ANOMALY") return true;
  if (!invoice) return false;
  return invoice.invoiceDateSource === "MISSING" || invoice.invoiceDate == null;
}

function decisionDays(invoice: LastValidInvoice | null, referenceDate: Date): number | null {
  return invoice?.invoiceDate ? calendarDaysBetweenSaoPaulo(invoice.invoiceDate, referenceDate) : null;
}

export function decideCommercialOwnerInactivityAction(input: PortfolioDecisionInput): PortfolioDecision {
  const invoice = resolveLastValidInvoice(input);
  const days = decisionDays(invoice, input.referenceDate);

  if (!input.hasActiveOwner) {
    return {
      status: "UNASSIGNED",
      action: "NO_CHANGE",
      reasonCode: "ALREADY_UNASSIGNED",
      daysSinceLastValidInvoice: days,
      daysSinceLastApprovedOrder: days,
      reviewDue: false,
    };
  }

  if (isInvoiceDateAnomaly(invoice, input.invoiceClockKind)) {
    return {
      status: "DATA_ANOMALY",
      action: "REVIEW_REQUIRED",
      reasonCode: MISSING_INVOICE_DATE,
      daysSinceLastValidInvoice: null,
      daysSinceLastApprovedOrder: null,
      reviewDue: false,
    };
  }

  if (!invoice || input.invoiceClockKind === "NEVER_INVOICED") {
    return {
      status: "NEVER_INVOICED",
      action: "REVIEW_REQUIRED",
      reasonCode: NEVER_INVOICED,
      daysSinceLastValidInvoice: null,
      daysSinceLastApprovedOrder: null,
      reviewDue: false,
    };
  }

  const reviewDue = days != null && days >= portfolioInactivityDays();
  if (!reviewDue) {
    return {
      status: "ACTIVE",
      action: "KEEP_OWNER",
      reasonCode: "WITHIN_ACTIVITY_WINDOW",
      daysSinceLastValidInvoice: days,
      daysSinceLastApprovedOrder: days,
      reviewDue: false,
    };
  }

  if (input.preservation.valid) {
    return {
      status: "PRESERVED_BY_CRM",
      action: "KEEP_OWNER",
      reasonCode: input.preservation.reasonCode,
      daysSinceLastValidInvoice: days,
      daysSinceLastApprovedOrder: days,
      reviewDue: true,
    };
  }

  return {
    status: "REMOVAL_ELIGIBLE",
    action: "REMOVE_OWNER",
    reasonCode: PORTFOLIO_INACTIVITY_REASON,
    daysSinceLastValidInvoice: days,
    daysSinceLastApprovedOrder: days,
    reviewDue: true,
  };
}

export function pickLatestApprovedSalesOrder(
  orders: Array<{ id: string; orderCode: string; issueDate: Date; status: string }>
): LastApprovedSalesOrder | null {
  const approved = orders
    .filter((row) => isApprovedSalesOrderStatus(row.status))
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());
  return approved[0] ?? null;
}

/** Rejeita epoch/1970 e datas inválidas — nunca são compra comercial. */
export function isUsableInvoiceDate(value: Date | null | undefined): value is Date {
  if (!value || Number.isNaN(value.getTime())) return false;
  return value.getTime() > 0;
}

export function classifyPortfolioNfeValidity(candidate: PortfolioInvoiceCandidate) {
  const normalized = normalizeNfeStatus({
    status: candidate.nfeStatus,
    xmlCancelamento: candidate.xmlCancelamento,
  });
  return classifyNfeValidity({
    statusNormalized: normalized.statusNormalized,
    isCanceled: normalized.isCanceled || Boolean(candidate.xmlCancelamento?.trim()),
    isValidForBilling: normalized.isValidForBilling,
    statusRaw: candidate.nfeStatus,
  });
}

export function classifyPortfolioStockValidity(candidate: PortfolioInvoiceCandidate) {
  if (!candidate.stockDocumentId) return null;
  return classifyOutputDocumentValidity({
    isCancelled: candidate.stockIsCancelled,
    statusRaw: candidate.stockStatusRaw,
    tipoDocumentoEstoque: candidate.stockTipo,
    idNfe: candidate.nfeExternalId,
  });
}

/**
 * Data canônica da compra. Contrato fiscal do IndusCost (Faturamento):
 * COALESCE(xmlDhEmi, dataProcessamento). dataProcessamento vem do payload Nomus
 * da NF-e, não do syncedAt da sincronização. dataDocumento de DS válido só entra
 * se a NF não tiver data própria.
 */
export function resolveInvoiceBusinessDate(candidate: PortfolioInvoiceCandidate): {
  date: Date | null;
  source: InvoiceDateSource;
} {
  if (isUsableInvoiceDate(candidate.xmlDhEmi)) {
    return { date: candidate.xmlDhEmi, source: "NFE_XML_DH_EMI" };
  }
  if (isUsableInvoiceDate(candidate.dataProcessamento)) {
    return { date: candidate.dataProcessamento, source: "NFE_PROCESSING_DATE" };
  }
  const stockValidity = classifyPortfolioStockValidity(candidate);
  if (stockValidity === "VALID" && isUsableInvoiceDate(candidate.stockDataDocumento)) {
    return { date: candidate.stockDataDocumento, source: "STOCK_DOCUMENT_DATE" };
  }
  return { date: null, source: "MISSING" };
}

export function portfolioInvoiceIssueDate(candidate: PortfolioInvoiceCandidate): Date | null {
  return resolveInvoiceBusinessDate(candidate).date;
}

export function isAuthorizedPortfolioInvoice(candidate: PortfolioInvoiceCandidate): boolean {
  if (classifyPortfolioNfeValidity(candidate) !== "AUTHORIZED") return false;
  const stockValidity = classifyPortfolioStockValidity(candidate);
  if (stockValidity === "CANCELLED" || stockValidity === "RETURN" || stockValidity === "TRANSFER") {
    return false;
  }
  return true;
}

export function isValidPortfolioInvoice(candidate: PortfolioInvoiceCandidate): boolean {
  return isAuthorizedPortfolioInvoice(candidate) && resolveInvoiceBusinessDate(candidate).date != null;
}

function toLastValidInvoice(
  candidate: PortfolioInvoiceCandidate,
  resolved: { date: Date | null; source: InvoiceDateSource }
): LastValidInvoice {
  const nfeValidity = classifyPortfolioNfeValidity(candidate);
  const stockValidity = classifyPortfolioStockValidity(candidate);
  return {
    salesOrderId: candidate.salesOrderId,
    salesOrderCode: candidate.salesOrderCode,
    invoiceId: candidate.nfeId ?? candidate.stockDocumentId,
    invoiceExternalId: candidate.nfeExternalId,
    invoiceNumber: candidate.nfeNumber,
    invoiceDate: resolved.date,
    invoiceDateSource: resolved.source,
    invoiceStatus: String(candidate.nfeStatus ?? nfeValidity),
    invoiceValidity: nfeValidity,
    invoiceCanceled: nfeValidity === "CANCELLED",
    stockDocumentId: candidate.stockDocumentId,
    stockDocumentValidity: stockValidity,
  };
}

export function pickLatestValidInvoice(candidates: PortfolioInvoiceCandidate[]): LastValidInvoice | null {
  const valid = candidates
    .filter(isValidPortfolioInvoice)
    .map((row) => ({ row, resolved: resolveInvoiceBusinessDate(row) }))
    .filter((item): item is { row: PortfolioInvoiceCandidate; resolved: { date: Date; source: InvoiceDateSource } } =>
      item.resolved.date != null
    )
    .sort((a, b) => b.resolved.date.getTime() - a.resolved.date.getTime());
  const latest = valid[0];
  if (!latest) return null;
  return toLastValidInvoice(latest.row, latest.resolved);
}

export function pickInvoiceClock(candidates: PortfolioInvoiceCandidate[]): {
  kind: "INVOICE" | "DATA_ANOMALY" | "NEVER_INVOICED";
  invoice: LastValidInvoice | null;
} {
  const dated = pickLatestValidInvoice(candidates);
  if (dated) return { kind: "INVOICE", invoice: dated };
  const authorizedWithoutDate = candidates.find(
    (row) => isAuthorizedPortfolioInvoice(row) && resolveInvoiceBusinessDate(row).source === "MISSING"
  );
  if (authorizedWithoutDate) {
    return {
      kind: "DATA_ANOMALY",
      invoice: toLastValidInvoice(authorizedWithoutDate, { date: null, source: "MISSING" }),
    };
  }
  return { kind: "NEVER_INVOICED", invoice: null };
}

export function mapCrmPreviewReasonCode(preservation: CommercialPortfolioPreservation): string {
  if (preservation.valid) {
    switch (preservation.evidenceType) {
      case "ACTIVE_PROPOSAL":
        return "ACTIVE_PROPOSAL";
      case "ACTIVE_NEGOTIATION":
        return "ACTIVE_NEGOTIATION";
      case "CONFIRMED_FUTURE_NEXT_STEP":
        return "VALID_NEXT_STEP";
      case "DOCUMENTED_TEMPORARY_PAUSE":
        return "TEMPORARY_PAUSE";
      case "ACTIVE_PROJECT_OR_HOMOLOGATION":
        return "ACTIVE_PROJECT";
      case "CONCRETE_COMMERCIAL_FACT":
        return "RECENT_MATERIAL_CONTACT";
      default:
        return preservation.evidenceType ?? PORTFOLIO_PRESERVED_REASON;
    }
  }
  switch (preservation.reasonCode) {
    case "NO_VALID_CRM_EVIDENCE":
      return "NO_CRM_EVIDENCE";
    case "STALE_CRM_RECORD":
      return "STALE_RECORD";
    case "GENERIC_CRM_RECORD":
      return "GENERIC_RECORD";
    case "TERMINAL_RECORD":
      return "TERMINAL_RECORD";
    case "ARTIFICIAL_CRM_RECORD":
      return "ARTIFICIAL_RETENTION_RECORD";
    case "CRM_WITHOUT_NEXT_STEP":
      return "MISSING_NEXT_STEP";
    case "TECHNICAL_UPDATE_ONLY":
      return "TECHNICAL_UPDATE_ONLY";
    default:
      return preservation.reasonCode;
  }
}
