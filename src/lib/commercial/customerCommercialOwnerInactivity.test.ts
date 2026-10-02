import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOCUMENT_INACTIVITY_DAYS } from "@/src/lib/commercialPolicy/commercialPolicyNormative.js";
import {
  APPROVED_SALES_ORDER_STATUS,
  NEVER_APPROVED_SALES_ORDER,
  NEVER_INVOICED,
  DATA_ANOMALY,
  MISSING_ASSIGNMENT_START,
  MISSING_INVOICE_DATE,
  NEVER_INVOICED_REVIEW_DUE,
  NEVER_INVOICED_WITHIN_GRACE,
  PORTFOLIO_INACTIVITY_REASON,
  PORTFOLIO_PRESERVED_REASON,
  calendarDaysBetweenSaoPaulo,
  decideCommercialOwnerInactivityAction,
  evaluateCommercialPortfolioPreservation,
  isApprovedSalesOrderStatus,
  isInvalidForCommercialClock,
  isPortfolioReviewDue,
  pickLatestApprovedSalesOrder,
  pickLatestValidInvoice,
  pickInvoiceClock,
  resolveInvoiceBusinessDate,
  portfolioInactivityDays,
  resolvePortfolioInactivityClock,
  saoPauloDateIso,
  type PortfolioInvoiceCandidate,
} from "./customerCommercialOwnerInactivity.js";
import {
  PORTFOLIO_INACTIVITY_REGISTERED_JOB,
  PORTFOLIO_INACTIVITY_SCHEDULE_DAY,
  PORTFOLIO_INACTIVITY_SCHEDULE_HOUR,
  PORTFOLIO_INACTIVITY_SCHEDULE_MINUTE,
  isPortfolioInactivityScheduledMinute,
} from "./customerCommercialOwnerInactivityJob.js";
import { getSaoPauloDateTimeParts } from "@/src/lib/brentCommodityJob.js";
import { isAutoAssignBlockedByInactivity } from "./crmCommercialOwnerAutoAssign.js";

function spNoon(isoDate: string): Date {
  return new Date(`${isoDate}T15:00:00.000Z`);
}

const LAST_PV = spNoon("2026-06-01");
const EMPTY_PRESERVATION = evaluateCommercialPortfolioPreservation({
  referenceDate: spNoon("2026-08-30"),
  lastApprovedIssueDate: LAST_PV,
  proposals: [],
  contacts: [],
});

describe("POL-COM-001 §11 — PV aprovado e 90 dias corridos", () => {
  it("usa uma única fonte normativa para os 90 dias", () => {
    assert.equal(portfolioInactivityDays(), 90);
    assert.equal(portfolioInactivityDays(), DOCUMENT_INACTIVITY_DAYS);
  });

  it("PV aprovado é SENT_TO_NOMUS; rascunho e cancelado não", () => {
    assert.equal(isApprovedSalesOrderStatus(APPROVED_SALES_ORDER_STATUS), true);
    assert.equal(isApprovedSalesOrderStatus("DRAFT"), false);
    assert.equal(isApprovedSalesOrderStatus("READY_TO_SEND"), false);
    assert.equal(isInvalidForCommercialClock("CANCELLED"), true);
    assert.equal(isInvalidForCommercialClock("ERROR"), true);
  });

  it("89 dias não entra em revisão", () => {
    const referenceDate = spNoon("2026-08-29");
    assert.equal(calendarDaysBetweenSaoPaulo(LAST_PV, referenceDate), 89);
    assert.equal(isPortfolioReviewDue({ lastApprovedIssueDate: LAST_PV, referenceDate }), false);
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-1", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "ACTIVE");
    assert.equal(decision.action, "KEEP_OWNER");
  });

  it("90 dias entra em revisão", () => {
    const referenceDate = spNoon("2026-08-30");
    assert.equal(calendarDaysBetweenSaoPaulo(LAST_PV, referenceDate), 90);
    assert.equal(isPortfolioReviewDue({ lastApprovedIssueDate: LAST_PV, referenceDate }), true);
  });

  it("91 dias entra em revisão", () => {
    const referenceDate = spNoon("2026-08-31");
    assert.equal(calendarDaysBetweenSaoPaulo(LAST_PV, referenceDate), 91);
    assert.equal(isPortfolioReviewDue({ lastApprovedIssueDate: LAST_PV, referenceDate }), true);
  });

  it("novo PV aprovado reinicia a contagem", () => {
    const newer = pickLatestApprovedSalesOrder([
      { id: "old", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      { id: "new", orderCode: "PV-2", issueDate: spNoon("2026-08-20"), status: "SENT_TO_NOMUS" },
    ]);
    assert.equal(newer?.id, "new");
    assert.equal(
      isPortfolioReviewDue({ lastApprovedIssueDate: newer!.issueDate, referenceDate: spNoon("2026-08-30") }),
      false
    );
  });

  it("PV criado mas não aprovado não reinicia", () => {
    const latest = pickLatestApprovedSalesOrder([
      { id: "old", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      { id: "draft", orderCode: "PV-2", issueDate: spNoon("2026-08-20"), status: "DRAFT" },
      { id: "ready", orderCode: "PV-3", issueDate: spNoon("2026-08-21"), status: "READY_TO_SEND" },
    ]);
    assert.equal(latest?.id, "old");
  });

  it("PV cancelado não entra no relógio comercial", () => {
    const latest = pickLatestApprovedSalesOrder([
      { id: "old", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      { id: "cancel", orderCode: "PV-2", issueDate: spNoon("2026-08-20"), status: "CANCELLED" },
    ]);
    assert.equal(latest?.id, "old");
  });

  it("timezone SP não muda o dia civil na virada UTC", () => {
    const almostNextUtcDay = new Date("2026-06-02T02:30:00.000Z");
    assert.equal(saoPauloDateIso(almostNextUtcDay), "2026-06-01");
    const reference = new Date("2026-08-30T02:30:00.000Z");
    assert.equal(saoPauloDateIso(reference), "2026-08-29");
    assert.equal(calendarDaysBetweenSaoPaulo(almostNextUtcDay, reference), 89);
    assert.equal(isPortfolioReviewDue({ lastApprovedIssueDate: almostNextUtcDay, referenceDate: reference }), false);
  });
});

describe("POL-COM-001 §11 — CRM estruturado", () => {
  const referenceDate = spNoon("2026-08-30");

  it("negociação ativa preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c1",
          contactDate: spNoon("2026-08-20"),
          createdAt: spNoon("2026-08-20"),
          outcome: "NEGOTIATION_ADVANCED",
          reason: "NEGOTIATION",
          nextActionType: "NEGOTIATE_PRICE",
          nextActionAt: spNoon("2026-09-05"),
        },
      ],
    });
    assert.equal(preservation.valid, true);
    assert.equal(preservation.evidenceType, "ACTIVE_NEGOTIATION");
  });

  it("proposta válida preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [
        {
          id: "p1",
          status: "SENT",
          number: 4412,
          externalProposalCode: "PP-4412",
          expectedCloseDate: spNoon("2026-09-15"),
          nextActionAt: spNoon("2026-09-10"),
          updatedAt: spNoon("2026-08-18"),
        },
      ],
      contacts: [],
    });
    assert.equal(preservation.valid, true);
    assert.equal(preservation.evidenceType, "ACTIVE_PROPOSAL");
    assert.equal(preservation.evidenceId, "p1");
    assert.equal(preservation.evidenceStatus, "SENT");
    assert.equal(preservation.evidenceCode, "PP-4412");
    assert.equal(preservation.evidenceDateSource, "expectedCloseDate");
    assert.equal(saoPauloDateIso(preservation.evidenceDate!), "2026-09-15");
    assert.equal(preservation.evidenceAgeDays, 12);
    assert.equal(saoPauloDateIso(preservation.nextStepDate!), "2026-09-10");
    assert.match(preservation.preservationReason ?? "", /PP-4412/);
    assert.match(preservation.preservationReason ?? "", /SENT/);
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-1", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      referenceDate,
      preservation,
    });
    assert.equal(decision.action, "KEEP_OWNER");
  });

  it("projeto/homologação em análise preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [
        {
          id: "p2",
          status: "ANALYSIS",
          expectedCloseDate: spNoon("2026-10-01"),
          nextActionAt: null,
          updatedAt: spNoon("2026-08-10"),
        },
      ],
      contacts: [],
    });
    assert.equal(preservation.valid, true);
    assert.equal(preservation.evidenceType, "ACTIVE_PROJECT_OR_HOMOLOGATION");
  });

  it("programação futura confirmada preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c2",
          contactDate: spNoon("2026-08-15"),
          createdAt: spNoon("2026-08-15"),
          outcome: "AWAITING_DECISION",
          reason: "FOLLOW_UP",
          nextActionType: "CONFIRM_ORDER",
          nextActionAt: spNoon("2026-09-20"),
        },
      ],
    });
    assert.equal(preservation.valid, true);
    assert.equal(preservation.evidenceType, "CONFIRMED_FUTURE_NEXT_STEP");
  });

  it("paralisação temporária documentada preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c3",
          contactDate: spNoon("2026-08-12"),
          createdAt: spNoon("2026-08-12"),
          outcome: "NO_DEMAND_NOW",
          reason: "REACTIVATION",
          nextActionType: "REACTIVATE_CUSTOMER",
          nextActionAt: spNoon("2026-10-01"),
        },
      ],
    });
    assert.equal(preservation.valid, true);
    assert.equal(preservation.evidenceType, "DOCUMENTED_TEMPORARY_PAUSE");
  });

  it("próximo passo e data futura coerentes preservam", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c4",
          contactDate: spNoon("2026-08-22"),
          createdAt: spNoon("2026-08-22"),
          outcome: "AWAITING_REPLY",
          reason: "FOLLOW_UP",
          nextActionType: "WAIT_CUSTOMER_REPLY",
          nextActionAt: spNoon("2026-09-08"),
        },
      ],
    });
    assert.equal(preservation.valid, true);
    assert.equal(preservation.evidenceType, "CONFIRMED_FUTURE_NEXT_STEP");
  });

  it("anotação genérica não preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c5",
          contactDate: spNoon("2026-08-20"),
          createdAt: spNoon("2026-08-20"),
          outcome: "RELATIONSHIP_MAINTAINED",
          reason: "RELATIONSHIP",
          nextActionType: "NONE",
          nextActionAt: null,
        },
      ],
    });
    assert.equal(preservation.valid, false);
    assert.equal(preservation.reasonCode, "GENERIC_CRM_RECORD");
  });

  it("anotação artificial não preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c6",
          contactDate: spNoon("2026-08-30"),
          createdAt: spNoon("2026-08-30"),
          outcome: "OTHER_RESULT",
          reason: "OTHER",
          nextActionType: "NONE",
          nextActionAt: null,
        },
      ],
    });
    assert.equal(preservation.valid, false);
    assert.equal(preservation.reasonCode, "ARTIFICIAL_CRM_RECORD");
  });

  it("registro desatualizado não preserva", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [],
      contacts: [
        {
          id: "c7",
          contactDate: spNoon("2026-04-01"),
          createdAt: spNoon("2026-04-01"),
          outcome: "NEGOTIATION_ADVANCED",
          reason: "NEGOTIATION",
          nextActionType: "NEGOTIATE_PRICE",
          nextActionAt: spNoon("2026-04-20"),
        },
      ],
    });
    assert.equal(preservation.valid, false);
    assert.equal(preservation.reasonCode, "STALE_CRM_RECORD");
  });

  it("sem CRM válido remove o responsável exclusivo", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-1", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.action, "REMOVE_OWNER");
    assert.equal(decision.reasonCode, PORTFOLIO_INACTIVITY_REASON);
    assert.equal(decision.status, "REMOVAL_ELIGIBLE");
  });

  it("cliente sem responsável não gera remoção", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: false,
      lastApprovedOrder: { id: "so-1", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.action, "NO_CHANGE");
    assert.equal(decision.status, "UNASSIGNED");
  });

  it("nunca faturou e sem data de início da atribuição é anomalia: não remove", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: null,
      lastValidInvoice: null,
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.action, "REVIEW_REQUIRED");
    assert.equal(decision.status, "DATA_ANOMALY");
    assert.equal(decision.reasonCode, MISSING_ASSIGNMENT_START);
    assert.equal(decision.clockSource, null);
    assert.equal(NEVER_APPROVED_SALES_ORDER, NEVER_INVOICED);
  });

  it("preservado num mês pode ser removido se o CRM deixar de ser válido", () => {
    const preserved = evaluateCommercialPortfolioPreservation({
      referenceDate: spNoon("2026-08-30"),
      lastApprovedIssueDate: LAST_PV,
      proposals: [{ id: "p1", status: "SENT", expectedCloseDate: spNoon("2026-09-05"), nextActionAt: null, updatedAt: spNoon("2026-08-20") }],
      contacts: [],
    });
    assert.equal(preserved.valid, true);
    const later = evaluateCommercialPortfolioPreservation({
      referenceDate: spNoon("2026-10-01"),
      lastApprovedIssueDate: LAST_PV,
      proposals: [{ id: "p1", status: "EXPIRED", expectedCloseDate: spNoon("2026-09-05"), nextActionAt: null, updatedAt: spNoon("2026-08-20") }],
      contacts: [],
    });
    assert.equal(later.valid, false);
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-1", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      referenceDate: spNoon("2026-10-01"),
      preservation: later,
    });
    assert.equal(decision.action, "REMOVE_OWNER");
    assert.equal(decision.reasonCode, PORTFOLIO_INACTIVITY_REASON);
  });

  it("CRM válido registra preservação, não remoção", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [
        {
          id: "p1",
          status: "SENT",
          expectedCloseDate: spNoon("2026-09-12"),
          nextActionAt: spNoon("2026-09-05"),
          updatedAt: spNoon("2026-08-01"),
        },
      ],
      contacts: [],
    });
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-1", orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" },
      lastValidInvoice: {
        salesOrderId: "so-1",
        salesOrderCode: "PV-1",
        invoiceId: "nfe-1",
        invoiceExternalId: 1,
        invoiceNumber: "1",
        invoiceDate: LAST_PV,
        invoiceDateSource: "NFE_XML_DH_EMI",
        invoiceStatus: "4",
        invoiceValidity: "AUTHORIZED",
        invoiceCanceled: false,
        stockDocumentId: null,
        stockDocumentValidity: null,
      },
      referenceDate,
      preservation,
    });
    assert.equal(preservation.valid, true);
    assert.equal(decision.action, "KEEP_OWNER");
    assert.equal(decision.status, "PRESERVED_BY_CRM");
    assert.equal(decision.reasonCode, PORTFOLIO_PRESERVED_REASON);
    assert.ok(preservation.nextReviewDate);
  });

  it("Proposal.updatedAt técnico não preserva sozinho", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      proposals: [{ id: "p-tech", status: "SENT", expectedCloseDate: null, nextActionAt: null, updatedAt: spNoon("2026-08-28") }],
      contacts: [],
    });
    assert.equal(preservation.valid, false);
    assert.equal(preservation.reasonCode, "TECHNICAL_UPDATE_ONLY");
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: {
        salesOrderId: "so-1",
        salesOrderCode: "PV-1",
        invoiceId: "nfe-1",
        invoiceExternalId: 1,
        invoiceNumber: "1",
        invoiceDate: LAST_PV,
        invoiceDateSource: "NFE_XML_DH_EMI",
        invoiceStatus: "4",
        invoiceValidity: "AUTHORIZED",
        invoiceCanceled: false,
        stockDocumentId: null,
        stockDocumentValidity: null,
      },
      referenceDate,
      preservation,
    });
    assert.equal(decision.action, "REMOVE_OWNER");
  });
});

describe("autoassign e agenda", () => {
  it("não restaura owner removido por inatividade", () => {
    assert.equal(
      isAutoAssignBlockedByInactivity({ isActive: false, blockAutoAssignUntilManual: true }),
      true
    );
    assert.equal(
      isAutoAssignBlockedByInactivity({ isActive: true, blockAutoAssignUntilManual: false }),
      false
    );
  });

  it("agenda oficial é 04:10 do dia 01 em America/Sao_Paulo", () => {
    const onSchedule = getSaoPauloDateTimeParts(new Date("2026-10-01T07:10:00.000Z"));
    assert.equal(isPortfolioInactivityScheduledMinute(onSchedule), true);
    const otherDay = getSaoPauloDateTimeParts(new Date("2026-10-02T07:10:00.000Z"));
    assert.equal(isPortfolioInactivityScheduledMinute(otherDay), false);
  });
});

describe("POL-COM-001 §11 — relógio por NF / Documento de Saída válido", () => {
  const referenceDate = spNoon("2026-08-30");

  function candidate(overrides: Record<string, unknown> = {}) {
    return {
      salesOrderId: "so-old",
      salesOrderCode: "PD 02100",
      nfeId: "nfe-1",
      nfeExternalId: 111222,
      nfeNumber: "111222",
      nfeStatus: 4,
      xmlDhEmi: spNoon("2026-06-01"),
      dataProcessamento: spNoon("2026-06-01"),
      xmlCancelamento: null,
      stockDocumentId: "st-1",
      stockIsCancelled: false,
      stockStatusRaw: "emitido",
      stockTipo: "saida",
      stockDataDocumento: spNoon("2026-06-01"),
      ...overrides,
    };
  }

  function invoiceAt(iso: string) {
    return {
      salesOrderId: "so-1",
      salesOrderCode: "PD 02710",
      invoiceId: "nfe-1",
      invoiceExternalId: 123456,
      invoiceNumber: "123456",
      invoiceDate: spNoon(iso),
      invoiceDateSource: "NFE_XML_DH_EMI" as const,
      invoiceStatus: "4",
      invoiceValidity: "AUTHORIZED",
      invoiceCanceled: false,
      stockDocumentId: "st-1",
      stockDocumentValidity: "VALID",
    };
  }

  it("PV SENT_TO_NOMUS sem NF não reinicia o relógio", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-new", orderCode: "PD 02710", issueDate: spNoon("2026-08-20"), status: "SENT_TO_NOMUS" },
      lastValidInvoice: null,
      assignmentStartedAt: spNoon("2026-08-01"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    // PV recente sem NF não vira relógio: o cliente segue "nunca faturou", contado da atribuição.
    assert.equal(decision.neverInvoiced, true);
    assert.equal(decision.clockSource, "ASSIGNMENT_START");
    assert.equal(decision.status, "NEVER_INVOICED_WITHIN_GRACE");
    assert.equal(decision.daysSinceLastValidInvoice, null);
    assert.equal(pickLatestValidInvoice([]), null);
  });

  it("PV com NF válida reinicia o relógio", () => {
    const latest = pickLatestValidInvoice([candidate({ xmlDhEmi: spNoon("2026-08-20") })]);
    assert.equal(latest?.invoiceNumber, "111222");
    assert.equal(
      isPortfolioReviewDue({ lastValidInvoiceDate: latest!.invoiceDate, referenceDate }),
      false
    );
  });

  it("NF cancelada não conta", () => {
    assert.equal(
      pickLatestValidInvoice([
        candidate({ nfeStatus: 7, xmlCancelamento: "<canc/>" }),
        candidate({ nfeStatus: 7, stockIsCancelled: true }),
      ]),
      null
    );
  });

  it("PV com NF válida antiga + PV recente sem NF usa a NF antiga", () => {
    const latest = pickLatestValidInvoice([
      candidate({ salesOrderId: "so-old", xmlDhEmi: spNoon("2026-05-01") }),
    ]);
    assert.equal(latest?.salesOrderId, "so-old");
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-new", orderCode: "PD 02710", issueDate: spNoon("2026-08-20"), status: "SENT_TO_NOMUS" },
      lastValidInvoice: latest,
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.reviewDue, true);
    assert.equal(decision.daysSinceLastValidInvoice, 121);
  });

  it("duas NFs válidas usa a mais recente", () => {
    const latest = pickLatestValidInvoice([
      candidate({ nfeId: "a", nfeNumber: "1", xmlDhEmi: spNoon("2026-06-01") }),
      candidate({ nfeId: "b", nfeNumber: "2", nfeExternalId: 2, xmlDhEmi: spNoon("2026-07-15") }),
    ]);
    assert.equal(latest?.invoiceNumber, "2");
    assert.equal(saoPauloDateIso(latest!.invoiceDate), "2026-07-15");
  });

  it("NF válida + NF cancelada posterior usa a válida", () => {
    const latest = pickLatestValidInvoice([
      candidate({ nfeId: "valid", nfeNumber: "123456", xmlDhEmi: spNoon("2026-06-01") }),
      candidate({
        nfeId: "canc",
        nfeNumber: "999",
        nfeExternalId: 999,
        nfeStatus: 7,
        xmlDhEmi: spNoon("2026-07-15"),
        xmlCancelamento: "<canc/>",
        stockIsCancelled: true,
      }),
    ]);
    assert.equal(latest?.invoiceNumber, "123456");
    assert.equal(saoPauloDateIso(latest!.invoiceDate), "2026-06-01");
  });

  it("faturamento parcial com NF válida conta", () => {
    const latest = pickLatestValidInvoice([
      candidate({ nfeNumber: "parcial", xmlDhEmi: spNoon("2026-08-01") }),
    ]);
    assert.ok(latest);
    assert.equal(
      isPortfolioReviewDue({ lastValidInvoiceDate: latest!.invoiceDate, referenceDate }),
      false
    );
  });

  it("cliente sem NF válida é nunca faturado e usa o relógio da atribuição", () => {
    assert.equal(pickInvoiceClock([]).kind, NEVER_INVOICED);
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: null,
      invoiceClockKind: "NEVER_INVOICED",
      assignmentStartedAt: spNoon("2026-07-01"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.neverInvoiced, true);
    assert.equal(decision.clockSource, "ASSIGNMENT_START");
    assert.equal(decision.daysSinceInactivityClock, 60);
    assert.equal(decision.action, "KEEP_OWNER");
  });

  it("89 dias desde NF válida não revisa", () => {
    const invoice = invoiceAt("2026-06-01");
    assert.equal(calendarDaysBetweenSaoPaulo(invoice.invoiceDate, spNoon("2026-08-29")), 89);
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: invoice,
      referenceDate: spNoon("2026-08-29"),
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "ACTIVE");
    assert.equal(decision.action, "KEEP_OWNER");
  });

  it("90 dias desde NF válida revisa", () => {
    assert.equal(
      isPortfolioReviewDue({ lastValidInvoiceDate: spNoon("2026-06-01"), referenceDate: spNoon("2026-08-30") }),
      true
    );
  });

  it("91 dias desde NF válida revisa", () => {
    assert.equal(
      isPortfolioReviewDue({ lastValidInvoiceDate: spNoon("2026-06-01"), referenceDate: spNoon("2026-08-31") }),
      true
    );
  });

  it("revisão + CRM válido preserva o responsável", () => {
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: LAST_PV,
      lastValidInvoiceDate: LAST_PV,
      proposals: [
        {
          id: "p1",
          status: "SENT",
          expectedCloseDate: spNoon("2026-09-15"),
          nextActionAt: spNoon("2026-09-10"),
          updatedAt: spNoon("2026-08-18"),
        },
      ],
      contacts: [],
    });
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: invoiceAt("2026-06-01"),
      referenceDate,
      preservation,
    });
    assert.equal(decision.action, "KEEP_OWNER");
    assert.equal(decision.status, "PRESERVED_BY_CRM");
  });

  it("revisão + CRM inválido remove o responsável", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: invoiceAt("2026-05-01"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.action, "REMOVE_OWNER");
    assert.equal(decision.status, "REMOVAL_ELIGIBLE");
    assert.equal(decision.daysSinceLastValidInvoice, 121);
  });

  it("timezone SP não muda o dia civil da NF na virada UTC", () => {
    const invoiceAlmostNextUtcDay = new Date("2026-06-02T02:30:00.000Z");
    assert.equal(saoPauloDateIso(invoiceAlmostNextUtcDay), "2026-06-01");
    const reference = new Date("2026-08-30T02:30:00.000Z");
    assert.equal(calendarDaysBetweenSaoPaulo(invoiceAlmostNextUtcDay, reference), 89);
    assert.equal(
      isPortfolioReviewDue({ lastValidInvoiceDate: invoiceAlmostNextUtcDay, referenceDate: reference }),
      false
    );
  });

  it("xmlDhEmi presente usa XML como fonte", () => {
    const latest = pickLatestValidInvoice([
      candidate({
        xmlDhEmi: spNoon("2026-08-20"),
        dataProcessamento: spNoon("2026-09-01"),
        stockDataDocumento: spNoon("2026-07-01"),
      }),
    ]);
    assert.equal(latest?.invoiceDateSource, "NFE_XML_DH_EMI");
    assert.equal(saoPauloDateIso(latest!.invoiceDate!), "2026-08-20");
  });

  it("xmlDhEmi ausente e DS válido usa dataDocumento", () => {
    const latest = pickLatestValidInvoice([
      candidate({
        xmlDhEmi: null,
        dataProcessamento: null,
        stockDataDocumento: spNoon("2026-07-15"),
        stockIsCancelled: false,
        stockStatusRaw: "emitido",
      }),
    ]);
    assert.equal(latest?.invoiceDateSource, "STOCK_DOCUMENT_DATE");
    assert.equal(saoPauloDateIso(latest!.invoiceDate!), "2026-07-15");
  });

  it("somente dataProcessamento usa fallback Nomus da NF", () => {
    const latest = pickLatestValidInvoice([
      candidate({
        xmlDhEmi: null,
        dataProcessamento: spNoon("2026-08-10"),
        stockDocumentId: null,
        stockDataDocumento: null,
      }),
    ]);
    assert.equal(latest?.invoiceDateSource, "NFE_PROCESSING_DATE");
  });

  it("NF autorizada sem data utilizável é DATA_ANOMALY, nunca 1970", () => {
    const clock = pickInvoiceClock([
      candidate({
        xmlDhEmi: new Date(0),
        dataProcessamento: null,
        stockDataDocumento: null,
        stockDocumentId: null,
      }),
    ]);
    assert.equal(clock.kind, "DATA_ANOMALY");
    assert.equal(clock.invoice?.invoiceDateSource, "MISSING");
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: clock.invoice,
      invoiceClockKind: "DATA_ANOMALY",
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "DATA_ANOMALY");
    assert.equal(decision.action, "REVIEW_REQUIRED");
    assert.equal(decision.reasonCode, MISSING_INVOICE_DATE);
    assert.notEqual(decision.action, "REMOVE_OWNER");
  });

  it("uma NFe com DS cancelado e DS válido continua contando o válido", () => {
    const latest = pickLatestValidInvoice([
      candidate({
        stockDocumentId: "st-canc",
        stockIsCancelled: true,
        stockStatusRaw: "cancelado",
        xmlDhEmi: spNoon("2026-08-01"),
      }),
      candidate({
        stockDocumentId: "st-ok",
        stockIsCancelled: false,
        stockStatusRaw: "emitido",
        xmlDhEmi: spNoon("2026-08-01"),
      }),
    ]);
    assert.equal(latest?.stockDocumentId, "st-ok");
    assert.ok(latest);
  });

  it("todos os DS cancelados não usam o documento; NF autorizada ainda conta", () => {
    const nfeOnly = candidate({
      stockDocumentId: null,
      stockIsCancelled: false,
      xmlDhEmi: spNoon("2026-08-01"),
    });
    const cancelled = candidate({
      stockDocumentId: "st-canc",
      stockIsCancelled: true,
      stockStatusRaw: "cancelado",
      xmlDhEmi: spNoon("2026-08-01"),
    });
    const latest = pickLatestValidInvoice([cancelled, nfeOnly]);
    assert.equal(latest?.stockDocumentId, null);
    assert.equal(latest?.invoiceDateSource, "NFE_XML_DH_EMI");
  });

  it("NF AUTHORIZED sem DS conta como faturamento", () => {
    const latest = pickLatestValidInvoice([
      candidate({
        stockDocumentId: null,
        stockIsCancelled: false,
        stockStatusRaw: null,
        stockTipo: null,
        stockDataDocumento: null,
        xmlDhEmi: spNoon("2026-08-20"),
      }),
    ]);
    assert.ok(latest);
    assert.equal(latest?.stockDocumentId, null);
    assert.equal(latest?.invoiceValidity, "AUTHORIZED");
  });
});

describe("POL-COM-001 §11 — dois relógios: última NF válida × início da atribuição", () => {
  const referenceDate = spNoon("2026-08-30");
  const NO_CRM = (assignmentClockDate: Date | null = null) =>
    evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: null,
      assignmentClockDate,
      proposals: [],
      contacts: [],
    });

  function invoiceAt(iso: string) {
    return {
      salesOrderId: "so-1",
      salesOrderCode: "PD 02710",
      invoiceId: "nfe-1",
      invoiceExternalId: 123456,
      invoiceNumber: "123456",
      invoiceDate: spNoon(iso),
      invoiceDateSource: "NFE_XML_DH_EMI" as const,
      invoiceStatus: "4",
      invoiceValidity: "AUTHORIZED",
      invoiceCanceled: false,
      stockDocumentId: "st-1",
      stockDocumentValidity: "VALID",
    };
  }

  function candidate(overrides: Partial<PortfolioInvoiceCandidate> = {}): PortfolioInvoiceCandidate {
    return {
      salesOrderId: "so-old",
      salesOrderCode: "PD 02100",
      nfeId: "nfe-1",
      nfeExternalId: 111222,
      nfeNumber: "111222",
      nfeStatus: 4,
      xmlDhEmi: spNoon("2026-06-01"),
      dataProcessamento: spNoon("2026-06-01"),
      xmlCancelamento: null,
      stockDocumentId: "st-1",
      stockIsCancelled: false,
      stockStatusRaw: "emitido",
      stockTipo: "saida",
      stockDataDocumento: spNoon("2026-06-01"),
      ...overrides,
    };
  }

  function neverInvoiced(assignmentStartedAt: Date, preservation = NO_CRM(assignmentStartedAt), at = referenceDate) {
    return decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: null,
      invoiceClockKind: "NEVER_INVOICED",
      assignmentStartedAt,
      referenceDate: at,
      preservation,
    });
  }

  it("caso 1: nunca faturou, atribuição há 89 dias, sem CRM → mantém", () => {
    const decision = neverInvoiced(spNoon("2026-06-02"));
    assert.equal(decision.daysSinceInactivityClock, 89);
    assert.equal(decision.status, "NEVER_INVOICED_WITHIN_GRACE");
    assert.equal(decision.reasonCode, NEVER_INVOICED_WITHIN_GRACE);
    assert.equal(decision.neverInvoicedStage, NEVER_INVOICED_WITHIN_GRACE);
    assert.equal(decision.action, "KEEP_OWNER");
    assert.equal(decision.reviewDue, false);
  });

  it("caso 2: nunca faturou, atribuição há exatamente 90 dias, sem CRM → REMOVE_OWNER", () => {
    const decision = neverInvoiced(spNoon("2026-06-01"));
    assert.equal(decision.daysSinceInactivityClock, 90);
    assert.equal(decision.action, "REMOVE_OWNER");
    assert.equal(decision.status, "REMOVAL_ELIGIBLE");
    assert.equal(decision.reasonCode, PORTFOLIO_INACTIVITY_REASON);
    assert.equal(decision.neverInvoicedStage, NEVER_INVOICED_REVIEW_DUE);
    assert.equal(decision.clockSource, "ASSIGNMENT_START");
    // Campos legados de NF não recebem "dias desde a atribuição".
    assert.equal(decision.daysSinceLastValidInvoice, null);
    assert.equal(decision.daysSinceLastApprovedOrder, null);
  });

  it("caso 3: nunca faturou, atribuição há 91 dias, sem CRM → REMOVE_OWNER", () => {
    const decision = neverInvoiced(spNoon("2026-05-31"));
    assert.equal(decision.daysSinceInactivityClock, 91);
    assert.equal(decision.action, "REMOVE_OWNER");
  });

  it("caso 4: nunca faturou, ≥ 90 dias, CRM válido → KEEP_OWNER / PRESERVED", () => {
    const start = spNoon("2026-05-12");
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: null,
      assignmentClockDate: start,
      proposals: [
        { id: "p1", status: "SENT", expectedCloseDate: spNoon("2026-09-15"), nextActionAt: spNoon("2026-09-10"), updatedAt: spNoon("2026-08-18") },
      ],
      contacts: [],
    });
    assert.equal(preservation.valid, true);
    const decision = neverInvoiced(start, preservation);
    assert.equal(decision.daysSinceInactivityClock, 110);
    assert.equal(decision.action, "KEEP_OWNER");
    assert.equal(decision.status, "PRESERVED_BY_CRM");
    assert.equal(decision.reasonCode, PORTFOLIO_PRESERVED_REASON);
    assert.equal(decision.reviewDue, true);
    assert.ok(preservation.nextReviewDate);
  });

  it("caso 5: nunca faturou, ≥ 90 dias, só anotação genérica/artificial → REMOVE_OWNER", () => {
    const start = spNoon("2026-05-01");
    const generic = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: null,
      assignmentClockDate: start,
      proposals: [],
      contacts: [
        { id: "c1", contactDate: spNoon("2026-07-10"), createdAt: spNoon("2026-07-10"), outcome: "RELATIONSHIP_MAINTAINED", reason: "RELATIONSHIP", nextActionType: "NONE", nextActionAt: null },
      ],
    });
    assert.equal(generic.valid, false);
    assert.equal(generic.reasonCode, "GENERIC_CRM_RECORD");
    assert.equal(neverInvoiced(start, generic).action, "REMOVE_OWNER");
    // Registro criado depois do gatilho só para segurar a carteira: mesmo tratamento do cliente faturado.
    const artificial = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: null,
      assignmentClockDate: start,
      proposals: [],
      contacts: [
        { id: "c2", contactDate: spNoon("2026-08-29"), createdAt: spNoon("2026-08-29"), outcome: "OTHER_RESULT", reason: "OTHER", nextActionType: "NONE", nextActionAt: null },
      ],
    });
    assert.equal(artificial.valid, false);
    assert.equal(artificial.reasonCode, "ARTIFICIAL_CRM_RECORD");
    assert.equal(neverInvoiced(start, artificial).action, "REMOVE_OWNER");
    // Atualização técnica de proposta, sem previsão nem próxima ação, também não segura.
    const technical = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: null,
      assignmentClockDate: start,
      proposals: [{ id: "p-tech", status: "SENT", expectedCloseDate: null, nextActionAt: null, updatedAt: spNoon("2026-08-28") }],
      contacts: [],
    });
    assert.equal(technical.valid, false);
    assert.equal(neverInvoiced(start, technical).action, "REMOVE_OWNER");
  });

  it("o relógio da atribuição não muda o que é CRM válido", () => {
    const contacts = [
      { id: "c1", contactDate: spNoon("2026-08-20"), createdAt: spNoon("2026-08-20"), outcome: "NEGOTIATION_ADVANCED", reason: "NEGOTIATION", nextActionType: "NEGOTIATE_PRICE", nextActionAt: spNoon("2026-09-05") },
    ];
    const withClock = evaluateCommercialPortfolioPreservation({ referenceDate, lastApprovedIssueDate: null, assignmentClockDate: spNoon("2026-05-01"), proposals: [], contacts });
    const withoutClock = evaluateCommercialPortfolioPreservation({ referenceDate, lastApprovedIssueDate: null, proposals: [], contacts });
    assert.deepEqual(withClock, withoutClock);
    assert.equal(withClock.valid, true);
  });

  it("caso 6: última NF válida há 89 dias com atribuição antiga → mantém pela NF", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: invoiceAt("2026-06-02"),
      assignmentStartedAt: spNoon("2025-01-10"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "ACTIVE");
    assert.equal(decision.action, "KEEP_OWNER");
    assert.equal(decision.clockSource, "LAST_VALID_INVOICE");
    assert.equal(decision.daysSinceInactivityClock, 89);
    assert.equal(decision.neverInvoiced, false);
  });

  it("caso 7: última NF válida há exatamente 90 dias, sem CRM → REMOVE_OWNER", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: invoiceAt("2026-06-01"),
      assignmentStartedAt: spNoon("2025-01-10"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.daysSinceLastValidInvoice, 90);
    assert.equal(decision.action, "REMOVE_OWNER");
    assert.equal(decision.clockSource, "LAST_VALID_INVOICE");
    assert.equal(decision.neverInvoicedStage, null);
  });

  it("caso 8: NF há 120 dias e responsável assumiu há 10 dias → revisão pela NF; a atribuição não reinicia o prazo", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: invoiceAt("2026-05-02"),
      assignmentStartedAt: spNoon("2026-08-20"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.clockSource, "LAST_VALID_INVOICE");
    assert.equal(saoPauloDateIso(decision.clockDate!), "2026-05-02");
    assert.equal(decision.daysSinceInactivityClock, 120);
    assert.equal(decision.reviewDue, true);
    assert.equal(decision.action, "REMOVE_OWNER");
  });

  it("resolvePortfolioInactivityClock: NF tem prioridade; sem NF usa a atribuição; anomalia nunca vira nunca faturado", () => {
    const start = spNoon("2026-08-20");
    assert.deepEqual(
      resolvePortfolioInactivityClock({ lastValidInvoice: invoiceAt("2026-05-02"), assignmentStartedAt: start, referenceDate }),
      { kind: "LAST_VALID_INVOICE", date: spNoon("2026-05-02"), days: 120 }
    );
    assert.deepEqual(
      resolvePortfolioInactivityClock({ lastValidInvoice: null, assignmentStartedAt: start, referenceDate }),
      { kind: "ASSIGNMENT_START", date: start, days: 10 }
    );
    const anomaly = pickInvoiceClock([
      candidate({ xmlDhEmi: null, dataProcessamento: null, stockDocumentId: null, stockDataDocumento: null }),
    ]);
    assert.deepEqual(
      resolvePortfolioInactivityClock({ lastValidInvoice: anomaly.invoice, invoiceClockKind: anomaly.kind, assignmentStartedAt: spNoon("2025-01-01"), referenceDate }),
      { kind: "DATA_ANOMALY", date: null, days: null }
    );
    assert.equal(resolvePortfolioInactivityClock({ lastValidInvoice: null, assignmentStartedAt: null, referenceDate }).kind, "DATA_ANOMALY");
    assert.equal(resolvePortfolioInactivityClock({ lastValidInvoice: null, assignmentStartedAt: new Date(0), referenceDate }).kind, "DATA_ANOMALY");
  });

  it("caso 15: DATA_ANOMALY nunca remove, mesmo com atribuição antiga e sem CRM", () => {
    const clock = pickInvoiceClock([
      candidate({ xmlDhEmi: new Date(0), dataProcessamento: null, stockDocumentId: null, stockDataDocumento: null }),
    ]);
    assert.equal(clock.kind, "DATA_ANOMALY");
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: clock.invoice,
      invoiceClockKind: clock.kind,
      assignmentStartedAt: spNoon("2025-01-01"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "DATA_ANOMALY");
    assert.equal(decision.action, "REVIEW_REQUIRED");
    assert.equal(decision.reasonCode, MISSING_INVOICE_DATE);
    assert.equal(decision.neverInvoiced, false);
    assert.equal(decision.clockSource, null);
  });

  it("caso 16: NF cancelada não reinicia o relógio — vale a NF válida anterior ou, sem nenhuma, a atribuição", () => {
    const cancelled = candidate({ nfeId: "canc", nfeNumber: "999", nfeExternalId: 999, nfeStatus: 7, xmlDhEmi: spNoon("2026-08-15"), xmlCancelamento: "<canc/>", stockIsCancelled: true });
    const withOlderValid = pickInvoiceClock([candidate({ xmlDhEmi: spNoon("2026-05-01") }), cancelled]);
    assert.equal(withOlderValid.kind, "INVOICE");
    const byInvoice = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: withOlderValid.invoice,
      invoiceClockKind: withOlderValid.kind,
      assignmentStartedAt: spNoon("2026-08-01"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(byInvoice.daysSinceLastValidInvoice, 121);
    assert.equal(byInvoice.action, "REMOVE_OWNER");
    const onlyCancelled = pickInvoiceClock([cancelled]);
    assert.equal(onlyCancelled.kind, NEVER_INVOICED);
    assert.equal(onlyCancelled.invoice, null);
    const byAssignment = neverInvoiced(spNoon("2026-05-01"));
    assert.equal(byAssignment.clockSource, "ASSIGNMENT_START");
    assert.equal(byAssignment.action, "REMOVE_OWNER");
  });

  it("caso 17: faturamento parcial com NF válida reinicia o relógio", () => {
    const partial = pickInvoiceClock([
      candidate({ xmlDhEmi: spNoon("2026-05-01") }),
      candidate({ nfeId: "parcial", nfeNumber: "parcial", nfeExternalId: 333, xmlDhEmi: spNoon("2026-08-10"), dataProcessamento: spNoon("2026-08-10"), stockDataDocumento: spNoon("2026-08-10") }),
    ]);
    assert.equal(partial.invoice?.invoiceNumber, "parcial");
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: partial.invoice,
      invoiceClockKind: partial.kind,
      assignmentStartedAt: spNoon("2025-01-01"),
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "ACTIVE");
    assert.equal(decision.daysSinceInactivityClock, 20);
  });

  it("caso 19: fronteira 89/90 da atribuição em dias civis de America/Sao_Paulo", () => {
    // 02/06 02:30Z ainda é 01/06 em São Paulo; 30/08 02:30Z ainda é 29/08.
    const startAlmostNextUtcDay = new Date("2026-06-02T02:30:00.000Z");
    assert.equal(saoPauloDateIso(startAlmostNextUtcDay), "2026-06-01");
    const at89 = neverInvoiced(startAlmostNextUtcDay, NO_CRM(startAlmostNextUtcDay), new Date("2026-08-30T02:30:00.000Z"));
    assert.equal(at89.daysSinceInactivityClock, 89);
    assert.equal(at89.action, "KEEP_OWNER");
    const at90 = neverInvoiced(startAlmostNextUtcDay, NO_CRM(startAlmostNextUtcDay), new Date("2026-08-30T03:00:00.000Z"));
    assert.equal(at90.daysSinceInactivityClock, 90);
    assert.equal(at90.action, "REMOVE_OWNER");
  });

  it("exemplo A: atribuído em 10/10 — rotinas de 01/11, 01/12 e 01/01 mantêm; 01/02 remove", () => {
    const start = spNoon("2026-10-10");
    const run = (iso: string) => neverInvoiced(start, NO_CRM(start), new Date(`${iso}T07:10:00.000Z`));
    assert.deepEqual(
      ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"].map((iso) => [run(iso).daysSinceInactivityClock, run(iso).action]),
      [
        [22, "KEEP_OWNER"],
        [52, "KEEP_OWNER"],
        [83, "KEEP_OWNER"],
        [114, "REMOVE_OWNER"],
      ]
    );
  });

  it("caso 20: a agenda continua no dia 01, 04:10, America/Sao_Paulo", () => {
    assert.equal(PORTFOLIO_INACTIVITY_SCHEDULE_DAY, 1);
    assert.equal(PORTFOLIO_INACTIVITY_SCHEDULE_HOUR, 4);
    assert.equal(PORTFOLIO_INACTIVITY_SCHEDULE_MINUTE, 10);
    assert.equal(PORTFOLIO_INACTIVITY_REGISTERED_JOB.id, "crm-owner-inactivity-review");
    assert.equal(PORTFOLIO_INACTIVITY_REGISTERED_JOB.cronExpression, "10 4 1 * *");
    assert.equal(PORTFOLIO_INACTIVITY_REGISTERED_JOB.timezone, "America/Sao_Paulo");
    assert.equal(isPortfolioInactivityScheduledMinute(getSaoPauloDateTimeParts(new Date("2027-02-01T07:10:00.000Z"))), true);
    assert.equal(isPortfolioInactivityScheduledMinute(getSaoPauloDateTimeParts(new Date("2027-02-01T07:11:00.000Z"))), false);
    assert.equal(isPortfolioInactivityScheduledMinute(getSaoPauloDateTimeParts(new Date("2027-02-01T04:10:00.000Z"))), false);
  });
});
