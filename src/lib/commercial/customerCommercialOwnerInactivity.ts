/**
 * Motor puro da revisão de carteira POL-COM-001 §11.
 * Fonte normativa: DOCUMENT_INACTIVITY_DAYS. Não usa faturamento, NF, CR ou AR.
 */
import { DOCUMENT_INACTIVITY_DAYS } from "@/src/lib/commercialPolicy/commercialPolicyNormative.js";
import { getSaoPauloDateTimeParts } from "@/src/lib/brentCommodityJob.js";
import { CRM_NEXT_ACTION_NONE } from "@/src/lib/commercial/crmContactCatalog.js";

export const PORTFOLIO_INACTIVITY_POLICY_SECTION = "11" as const;
export const PORTFOLIO_INACTIVITY_REASON = "INACTIVITY_90_DAYS" as const;
export const PORTFOLIO_PRESERVED_REASON = "PORTFOLIO_REVIEW_PRESERVED" as const;
export const NEVER_APPROVED_SALES_ORDER = "NEVER_APPROVED_SALES_ORDER" as const;

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
  | "NEVER_APPROVED";

export type PortfolioInactivityAction = "KEEP_OWNER" | "REMOVE_OWNER" | "REVIEW_REQUIRED" | "NO_CHANGE";

export type LastApprovedSalesOrder = {
  id: string;
  orderCode: string;
  issueDate: Date;
  status: string;
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
  lastApprovedOrder: LastApprovedSalesOrder | null;
  referenceDate: Date;
  preservation: CommercialPortfolioPreservation;
};

export type PortfolioDecision = {
  status: PortfolioConceptualStatus;
  action: PortfolioInactivityAction;
  reasonCode: string;
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
  lastApprovedIssueDate: Date | null;
  referenceDate: Date;
  inactivityDays?: number;
}): boolean {
  if (!input.lastApprovedIssueDate) return false;
  const days = calendarDaysBetweenSaoPaulo(input.lastApprovedIssueDate, input.referenceDate);
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

export function evaluateCommercialPortfolioPreservation(input: {
  referenceDate: Date;
  lastApprovedIssueDate: Date | null;
  proposals: PortfolioProposalEvidence[];
  contacts: PortfolioContactEvidence[];
}): CommercialPortfolioPreservation {
  const nextReviewDate = firstOfNextSaoPauloMonth(input.referenceDate);

  const openProposal = [...input.proposals]
    .filter((row) => OPEN_PROPOSAL_STATUSES.has(row.status))
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
    input.lastApprovedIssueDate != null &&
    isPortfolioReviewDue({
      lastApprovedIssueDate: input.lastApprovedIssueDate,
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
    return {
      valid: false,
      reasonCode: "GENERIC_CRM_RECORD",
      evidenceType: "GENERIC_NOTE",
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

export function decideCommercialOwnerInactivityAction(input: PortfolioDecisionInput): PortfolioDecision {
  if (!input.hasActiveOwner) {
    return {
      status: "UNASSIGNED",
      action: "NO_CHANGE",
      reasonCode: "ALREADY_UNASSIGNED",
      daysSinceLastApprovedOrder: input.lastApprovedOrder
        ? calendarDaysBetweenSaoPaulo(input.lastApprovedOrder.issueDate, input.referenceDate)
        : null,
      reviewDue: false,
    };
  }

  if (!input.lastApprovedOrder) {
    return {
      status: "NEVER_APPROVED",
      action: "REVIEW_REQUIRED",
      reasonCode: NEVER_APPROVED_SALES_ORDER,
      daysSinceLastApprovedOrder: null,
      reviewDue: false,
    };
  }

  const days = calendarDaysBetweenSaoPaulo(input.lastApprovedOrder.issueDate, input.referenceDate);
  const reviewDue = days >= portfolioInactivityDays();
  if (!reviewDue) {
    return {
      status: "ACTIVE",
      action: "KEEP_OWNER",
      reasonCode: "WITHIN_ACTIVITY_WINDOW",
      daysSinceLastApprovedOrder: days,
      reviewDue: false,
    };
  }

  if (input.preservation.valid) {
    return {
      status: "PRESERVED_BY_CRM",
      action: "KEEP_OWNER",
      reasonCode: input.preservation.reasonCode,
      daysSinceLastApprovedOrder: days,
      reviewDue: true,
    };
  }

  return {
    status: "REMOVAL_ELIGIBLE",
    action: "REMOVE_OWNER",
    reasonCode: PORTFOLIO_INACTIVITY_REASON,
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
