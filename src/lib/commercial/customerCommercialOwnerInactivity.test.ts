import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOCUMENT_INACTIVITY_DAYS } from "@/src/lib/commercialPolicy/commercialPolicyNormative.js";
import {
  APPROVED_SALES_ORDER_STATUS,
  NEVER_APPROVED_SALES_ORDER,
  NEVER_INVOICED,
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
  portfolioInactivityDays,
  saoPauloDateIso,
} from "./customerCommercialOwnerInactivity.js";
import { isPortfolioInactivityScheduledMinute } from "./customerCommercialOwnerInactivityJob.js";
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

  it("nunca teve PV aprovado não remove automaticamente", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: null,
      lastValidInvoice: null,
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.action, "REVIEW_REQUIRED");
    assert.equal(decision.reasonCode, NEVER_APPROVED_SALES_ORDER);
    assert.equal(decision.reasonCode, NEVER_INVOICED);
    assert.equal(decision.status, "NEVER_INVOICED");
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
        invoiceStatus: "4",
        invoiceCanceled: false,
        stockDocumentId: null,
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
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: {
        salesOrderId: "so-1",
        salesOrderCode: "PV-1",
        invoiceId: "nfe-1",
        invoiceExternalId: 1,
        invoiceNumber: "1",
        invoiceDate: LAST_PV,
        invoiceStatus: "4",
        invoiceCanceled: false,
        stockDocumentId: null,
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
      invoiceStatus: "4",
      invoiceCanceled: false,
      stockDocumentId: "st-1",
    };
  }

  it("PV SENT_TO_NOMUS sem NF não reinicia o relógio", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastApprovedOrder: { id: "so-new", orderCode: "PD 02710", issueDate: spNoon("2026-08-20"), status: "SENT_TO_NOMUS" },
      lastValidInvoice: null,
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "NEVER_INVOICED");
    assert.equal(decision.action, "REVIEW_REQUIRED");
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

  it("cliente sem NF válida é NEVER_INVOICED", () => {
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: null,
      referenceDate,
      preservation: EMPTY_PRESERVATION,
    });
    assert.equal(decision.status, "NEVER_INVOICED");
    assert.equal(decision.reasonCode, NEVER_INVOICED);
    assert.equal(decision.action, "REVIEW_REQUIRED");
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
});
