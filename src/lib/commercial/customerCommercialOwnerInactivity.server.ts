/**
 * Preview/apply da revisão de carteira POL-COM-001 §11.
 * Preview não grava. Apply recalcula, é idempotente e transacional por cliente.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma.js";
import { CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY } from "@/src/lib/crmCustomerCommercialOwner.js";
import {
  APPROVED_SALES_ORDER_STATUS,
  DATA_ANOMALY,
  INACTIVITY_END_REASON_LABEL,
  MISSING_INVOICE_DATE,
  NEVER_INVOICED,
  PORTFOLIO_INACTIVITY_REASON,
  PORTFOLIO_PRESERVED_REASON,
  decideCommercialOwnerInactivityAction,
  evaluateCommercialPortfolioPreservation,
  mapCrmPreviewReasonCode,
  pickInvoiceClock,
  pickLatestApprovedSalesOrder,
  portfolioInactivityDays,
  saoPauloDateIso,
  calendarDaysBetweenSaoPaulo,
  type CommercialPortfolioPreservation,
  type InvoiceDateSource,
  type LastApprovedSalesOrder,
  type LastValidInvoice,
  type PortfolioContactEvidence,
  type PortfolioInactivityAction,
  type PortfolioInvoiceCandidate,
  type PortfolioProposalEvidence,
} from "./customerCommercialOwnerInactivity.js";

export const PORTFOLIO_INACTIVITY_PERFORMED_BY = "system/portfolio-inactivity";

type OwnerRow = {
  id: string;
  customerId: string;
  isActive: boolean;
  sellerIdentityKey: string;
  sellerCanonicalName: string;
  createdAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  blockAutoAssignUntilManual: boolean;
};

type CustomerRow = {
  id: string;
  companyName: string;
  taxId: string;
  nomusExternalPersonId: number | null;
};

export type PortfolioInactivityPreviewRow = {
  customerId: string;
  customerExternalId: number | null;
  externalId: number | null;
  taxId: string;
  customerName: string;
  name: string;
  currentOwner: string | null;
  lastInvoicedSalesOrderId: string | null;
  lastInvoicedSalesOrderNumber: string | null;
  lastValidInvoiceId: string | null;
  lastValidInvoiceNumber: string | null;
  lastValidInvoiceDate: string | null;
  invoiceDateSource: InvoiceDateSource | null;
  invoiceValidity: string | null;
  stockDocumentId: string | null;
  stockDocumentValidity: string | null;
  daysSinceLastValidInvoice: number | null;
  invoiceStatus: string | null;
  invoiceCanceled: boolean | null;
  lastApprovedSalesOrderId: string | null;
  lastApprovedSalesOrderCode: string | null;
  lastApprovedIssueDate: string | null;
  daysSinceLastApprovedOrder: number | null;
  crmValid: boolean;
  crmReasonCode: string | null;
  crmEvidenceType: string | null;
  crmEvidenceId: string | null;
  crmBusinessEvidenceDate: string | null;
  evidenceType: string | null;
  evidenceId: string | null;
  evidenceStatus: string | null;
  evidenceCode: string | null;
  evidenceDate: string | null;
  businessEvidenceDate: string | null;
  evidenceAgeDays: number | null;
  evidenceDateSource: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  preservationReason: string | null;
  reasonCode: string;
  decisionReason: string;
  proposedAction: PortfolioInactivityAction | "KEEP_ACTIVE" | "NEVER_INVOICED";
  action: PortfolioInactivityAction | "KEEP_ACTIVE" | "NEVER_INVOICED";
  status: string;
};

export type PortfolioInactivityPreview = {
  referenceDate: string;
  runId: string | null;
  analyzedCustomers: number;
  customersWithActiveOwner: number;
  withinActivityWindow: number;
  inReview: number;
  preservedByCrm: number;
  removalEligible: number;
  neverInvoiced: number;
  neverApprovedSalesOrder: number;
  dataAnomaly: number;
  alreadyUnassigned: number;
  invoiceDateSourceCounts: Record<InvoiceDateSource, number>;
  crmReasonCounts: Record<string, number>;
  rows: PortfolioInactivityPreviewRow[];
};

export type PortfolioInactivityApplyResult = {
  referenceDate: string;
  runId: string;
  removed: number;
  preserved: number;
  unchanged: number;
  skippedUnassigned: number;
  neverInvoiced: number;
  neverApproved: number;
  dataAnomaly: number;
  results: Array<{
    customerId: string;
    action: PortfolioInactivityAction | "NO_CHANGE";
    reasonCode: string;
  }>;
};

function asPrisma(client: PrismaClient | Prisma.TransactionClient): PrismaClient {
  return client as PrismaClient;
}

export async function loadLastApprovedSalesOrders(
  client: PrismaClient | Prisma.TransactionClient,
  customerIds: string[]
): Promise<Map<string, LastApprovedSalesOrder>> {
  const map = new Map<string, LastApprovedSalesOrder>();
  if (customerIds.length === 0) return map;
  const rows = await asPrisma(client).salesOrder.findMany({
    where: {
      customerId: { in: customerIds },
      status: APPROVED_SALES_ORDER_STATUS,
    },
    select: { id: true, customerId: true, orderCode: true, issueDate: true, status: true },
  });
  const byCustomer = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCustomer.get(row.customerId) ?? [];
    list.push(row);
    byCustomer.set(row.customerId, list);
  }
  for (const [customerId, list] of byCustomer) {
    const latest = pickLatestApprovedSalesOrder(list);
    if (latest) map.set(customerId, latest);
  }
  return map;
}

export async function loadLastValidInvoices(
  client: PrismaClient | Prisma.TransactionClient,
  customerIds: string[]
): Promise<Map<string, LastValidInvoice>> {
  const map = new Map<string, LastValidInvoice>();
  if (customerIds.length === 0) return map;
  const db = asPrisma(client);
  const orders = await db.salesOrder.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true, customerId: true, orderCode: true },
  });
  if (orders.length === 0) return map;
  const orderIds = orders.map((row) => row.id);
  const links = await db.salesOrderNfeLink.findMany({
    where: { salesOrderId: { in: orderIds } },
    select: {
      salesOrderId: true,
      nfeExternalId: true,
      nfeNumber: true,
      nfeStatus: true,
      dataProcessamento: true,
      nomusNfeId: true,
    },
  });
  const nfeExternalIds = [...new Set(links.map((row) => row.nfeExternalId).filter((id) => Number.isFinite(id)))];
  const [nfes, stocks] = nfeExternalIds.length
    ? await Promise.all([
        db.nomusNfe.findMany({
          where: { externalId: { in: nfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            status: true,
            xmlDhEmi: true,
            dataProcessamento: true,
            xmlCancelamento: true,
          },
        }),
        db.nomusStockDocument.findMany({
          where: { idNfe: { in: nfeExternalIds } },
          select: {
            id: true,
            idNfe: true,
            isCancelled: true,
            statusRaw: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
          },
        }),
      ])
    : [[], []];

  const nfeByExternalId = new Map(nfes.map((row) => [row.externalId, row]));
  const stocksByIdNfe = new Map<number, typeof stocks>();
  for (const stock of stocks) {
    if (stock.idNfe == null) continue;
    const list = stocksByIdNfe.get(stock.idNfe) ?? [];
    list.push(stock);
    stocksByIdNfe.set(stock.idNfe, list);
  }
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const candidatesByCustomer = new Map<string, PortfolioInvoiceCandidate[]>();

  for (const link of links) {
    const order = orderById.get(link.salesOrderId);
    if (!order) continue;
    const nfe = nfeByExternalId.get(link.nfeExternalId);
    const relatedStocks = stocksByIdNfe.get(link.nfeExternalId) ?? [];
    const base = {
      salesOrderId: order.id,
      salesOrderCode: order.orderCode,
      nfeId: nfe?.id ?? link.nomusNfeId ?? null,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: nfe?.numero ?? link.nfeNumber ?? null,
      nfeStatus: nfe?.status ?? link.nfeStatus,
      xmlDhEmi: nfe?.xmlDhEmi ?? null,
      dataProcessamento: nfe?.dataProcessamento ?? link.dataProcessamento ?? null,
      xmlCancelamento: nfe?.xmlCancelamento ?? null,
    };
    const variants: PortfolioInvoiceCandidate[] = [
      {
        ...base,
        stockDocumentId: null,
        stockIsCancelled: false,
        stockStatusRaw: null,
        stockTipo: null,
        stockDataDocumento: null,
      },
      ...relatedStocks.map((stock) => ({
        ...base,
        stockDocumentId: stock.id,
        stockIsCancelled: stock.isCancelled,
        stockStatusRaw: stock.statusRaw,
        stockTipo: stock.tipoDocumentoEstoque,
        stockDataDocumento: stock.dataDocumento,
      })),
    ];
    const list = candidatesByCustomer.get(order.customerId) ?? [];
    list.push(...variants);
    candidatesByCustomer.set(order.customerId, list);
  }

  for (const [customerId, candidates] of candidatesByCustomer) {
    const clock = pickInvoiceClock(candidates);
    if (clock.invoice) map.set(customerId, clock.invoice);
  }
  return map;
}

export async function loadPortfolioCrmEvidence(
  client: PrismaClient | Prisma.TransactionClient,
  customerIds: string[]
): Promise<{
  proposals: Map<string, PortfolioProposalEvidence[]>;
  contacts: Map<string, PortfolioContactEvidence[]>;
}> {
  const proposals = new Map<string, PortfolioProposalEvidence[]>();
  const contacts = new Map<string, PortfolioContactEvidence[]>();
  if (customerIds.length === 0) return { proposals, contacts };

  const db = asPrisma(client);
  const [proposalRows, contactRows] = await Promise.all([
    db.proposal.findMany({
      where: { customerId: { in: customerIds } },
      select: {
        id: true,
        customerId: true,
        status: true,
        expectedCloseDate: true,
        nextActionAt: true,
        updatedAt: true,
        number: true,
        externalProposalCode: true,
      },
    }),
    db.commercialActivity.findMany({
      where: { customerId: { in: customerIds } },
      select: {
        id: true,
        customerId: true,
        contactDate: true,
        createdAt: true,
        outcome: true,
        reason: true,
        nextActionType: true,
        nextActionAt: true,
      },
    }),
  ]);

  for (const row of proposalRows) {
    const list = proposals.get(row.customerId) ?? [];
    list.push({
      id: row.id,
      status: String(row.status),
      expectedCloseDate: row.expectedCloseDate,
      nextActionAt: row.nextActionAt,
      updatedAt: row.updatedAt,
      number: row.number,
      externalProposalCode: row.externalProposalCode,
    });
    proposals.set(row.customerId, list);
  }
  for (const row of contactRows) {
    const list = contacts.get(row.customerId) ?? [];
    list.push({
      id: row.id,
      contactDate: row.contactDate,
      createdAt: row.createdAt,
      outcome: row.outcome,
      reason: row.reason,
      nextActionType: row.nextActionType,
      nextActionAt: row.nextActionAt,
    });
    contacts.set(row.customerId, list);
  }
  return { proposals, contacts };
}

function clockKindFromInvoice(
  invoice: LastValidInvoice | null
): "INVOICE" | "NEVER_INVOICED" | "DATA_ANOMALY" {
  if (!invoice) return "NEVER_INVOICED";
  if (invoice.invoiceDateSource === "MISSING" || invoice.invoiceDate == null) return "DATA_ANOMALY";
  return "INVOICE";
}

function decideRow(input: {
  owner: OwnerRow | null;
  lastInvoice: LastValidInvoice | null;
  preservation: CommercialPortfolioPreservation;
  referenceDate: Date;
}) {
  return decideCommercialOwnerInactivityAction({
    hasActiveOwner: Boolean(input.owner?.isActive),
    lastValidInvoice: input.lastInvoice,
    invoiceClockKind: clockKindFromInvoice(input.lastInvoice),
    referenceDate: input.referenceDate,
    preservation: input.preservation,
  });
}

function previewAction(
  decision: ReturnType<typeof decideCommercialOwnerInactivityAction>
): PortfolioInactivityAction | "KEEP_ACTIVE" | "NEVER_INVOICED" {
  if (decision.status === "ACTIVE") return "KEEP_ACTIVE";
  if (decision.status === "NEVER_INVOICED") return "NEVER_INVOICED";
  if (decision.status === "DATA_ANOMALY") return "REVIEW_REQUIRED";
  return decision.action;
}

function emptyDateSourceCounts(): Record<InvoiceDateSource, number> {
  return {
    NFE_XML_DH_EMI: 0,
    STOCK_DOCUMENT_DATE: 0,
    NFE_PROCESSING_DATE: 0,
    MISSING: 0,
  };
}

function bumpCount(map: Record<string, number>, key: string | null | undefined) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function toPreviewRow(input: {
  customer: CustomerRow;
  owner: OwnerRow | null;
  lastInvoice: LastValidInvoice | null;
  preservation: CommercialPortfolioPreservation;
  decision: ReturnType<typeof decideCommercialOwnerInactivityAction>;
}): PortfolioInactivityPreviewRow {
  const action = previewAction(input.decision);
  const invoiceDate = input.lastInvoice?.invoiceDate
    ? saoPauloDateIso(input.lastInvoice.invoiceDate)
    : null;
  const evidenceDate = input.preservation.evidenceDate
    ? saoPauloDateIso(input.preservation.evidenceDate)
    : null;
  const crmReasonCode = mapCrmPreviewReasonCode(input.preservation);
  return {
    customerId: input.customer.id,
    customerExternalId: input.customer.nomusExternalPersonId,
    externalId: input.customer.nomusExternalPersonId,
    taxId: input.customer.taxId,
    customerName: input.customer.companyName,
    name: input.customer.companyName,
    currentOwner: input.owner?.isActive ? input.owner.sellerCanonicalName : null,
    lastInvoicedSalesOrderId: input.lastInvoice?.salesOrderId ?? null,
    lastInvoicedSalesOrderNumber: input.lastInvoice?.salesOrderCode ?? null,
    lastValidInvoiceId: input.lastInvoice?.invoiceId ?? null,
    lastValidInvoiceNumber: input.lastInvoice?.invoiceNumber ?? null,
    lastValidInvoiceDate: invoiceDate,
    invoiceDateSource: input.lastInvoice?.invoiceDateSource ?? null,
    invoiceValidity: input.lastInvoice?.invoiceValidity ?? null,
    stockDocumentId: input.lastInvoice?.stockDocumentId ?? null,
    stockDocumentValidity: input.lastInvoice?.stockDocumentValidity ?? null,
    daysSinceLastValidInvoice: input.decision.daysSinceLastValidInvoice,
    invoiceStatus: input.lastInvoice?.invoiceStatus ?? null,
    invoiceCanceled: input.lastInvoice ? input.lastInvoice.invoiceCanceled : null,
    lastApprovedSalesOrderId: input.lastInvoice?.salesOrderId ?? null,
    lastApprovedSalesOrderCode: input.lastInvoice?.salesOrderCode ?? null,
    lastApprovedIssueDate: invoiceDate,
    daysSinceLastApprovedOrder: input.decision.daysSinceLastValidInvoice,
    crmValid: input.preservation.valid,
    crmReasonCode,
    crmEvidenceType: input.preservation.evidenceType,
    crmEvidenceId: input.preservation.evidenceId,
    crmBusinessEvidenceDate: evidenceDate,
    evidenceType: input.preservation.evidenceType,
    evidenceId: input.preservation.evidenceId,
    evidenceStatus: input.preservation.evidenceStatus,
    evidenceCode: input.preservation.evidenceCode,
    evidenceDate,
    businessEvidenceDate: evidenceDate,
    evidenceAgeDays: input.preservation.evidenceAgeDays,
    evidenceDateSource: input.preservation.evidenceDateSource,
    nextStep: input.preservation.nextStep,
    nextStepDate: input.preservation.nextStepDate
      ? saoPauloDateIso(input.preservation.nextStepDate)
      : null,
    preservationReason: input.preservation.preservationReason,
    reasonCode: input.decision.reasonCode,
    decisionReason: input.decision.reasonCode,
    proposedAction: action,
    action,
    status: input.decision.status,
  };
}

export async function previewCommercialOwnerInactivity(
  referenceDate: Date = new Date(),
  client: PrismaClient = defaultPrisma
): Promise<PortfolioInactivityPreview> {
  const [owners, customers] = await Promise.all([
    client.crmCustomerCommercialOwner.findMany(),
    client.customer.findMany({
      select: { id: true, companyName: true, taxId: true, nomusExternalPersonId: true },
    }),
  ]);
  const ownerByCustomer = new Map(owners.map((row) => [row.customerId, row]));
  const customerIds = customers.map((row) => row.id);
  const [lastInvoices, evidence] = await Promise.all([
    loadLastValidInvoices(client, customerIds),
    loadPortfolioCrmEvidence(client, customerIds),
  ]);

  const rows: PortfolioInactivityPreviewRow[] = [];
  let withActive = 0;
  let within = 0;
  let inReview = 0;
  let preserved = 0;
  let removal = 0;
  let neverInvoiced = 0;
  let dataAnomaly = 0;
  let unassigned = 0;
  const invoiceDateSourceCounts = emptyDateSourceCounts();
  const crmReasonCounts: Record<string, number> = {};

  for (const customer of customers as CustomerRow[]) {
    const owner = ownerByCustomer.get(customer.id) ?? null;
    const lastInvoice = lastInvoices.get(customer.id) ?? null;
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: lastInvoice?.invoiceDate ?? null,
      lastValidInvoiceDate: lastInvoice?.invoiceDate ?? null,
      proposals: evidence.proposals.get(customer.id) ?? [],
      contacts: evidence.contacts.get(customer.id) ?? [],
    });
    const decision = decideRow({ owner, lastInvoice, preservation, referenceDate });
    if (owner?.isActive) {
      withActive += 1;
      if (lastInvoice?.invoiceDateSource) invoiceDateSourceCounts[lastInvoice.invoiceDateSource] += 1;
      if (decision.reviewDue) bumpCount(crmReasonCounts, mapCrmPreviewReasonCode(preservation));
    }
    if (decision.status === "ACTIVE") within += 1;
    if (decision.reviewDue) inReview += 1;
    if (decision.status === "PRESERVED_BY_CRM") preserved += 1;
    if (decision.action === "REMOVE_OWNER") removal += 1;
    if (decision.status === "NEVER_INVOICED") neverInvoiced += 1;
    if (decision.status === "DATA_ANOMALY") dataAnomaly += 1;
    if (decision.status === "UNASSIGNED") unassigned += 1;

    const shouldList =
      Boolean(owner?.isActive) ||
      decision.reviewDue ||
      decision.status === "NEVER_INVOICED" ||
      decision.status === "DATA_ANOMALY";
    if (shouldList) {
      rows.push(toPreviewRow({ customer, owner, lastInvoice, preservation, decision }));
    }
  }

  return {
    referenceDate: saoPauloDateIso(referenceDate),
    runId: null,
    analyzedCustomers: customers.length,
    customersWithActiveOwner: withActive,
    withinActivityWindow: within,
    inReview,
    preservedByCrm: preserved,
    removalEligible: removal,
    neverInvoiced,
    neverApprovedSalesOrder: neverInvoiced,
    dataAnomaly,
    alreadyUnassigned: unassigned,
    invoiceDateSourceCounts,
    crmReasonCounts,
    rows,
  };
}

async function recordReviewAndMaybeRemove(input: {
  client: PrismaClient;
  runId: string;
  referenceDate: Date;
  customer: CustomerRow;
  owner: OwnerRow;
  lastInvoice: LastValidInvoice | null;
  preservation: CommercialPortfolioPreservation;
  decision: ReturnType<typeof decideCommercialOwnerInactivityAction>;
}): Promise<"REMOVED" | "PRESERVED" | "NO_CHANGE"> {
  if (!input.owner.isActive) return "NO_CHANGE";
  if (input.decision.status === "NEVER_INVOICED" || input.decision.status === "DATA_ANOMALY") {
    return "NO_CHANGE";
  }
  if (input.decision.action === "REVIEW_REQUIRED") return "NO_CHANGE";
  if (input.decision.action === "KEEP_OWNER" && !input.decision.reviewDue) return "NO_CHANGE";
  if (
    input.decision.action === "REMOVE_OWNER" &&
    (!input.lastInvoice?.invoiceDate || input.lastInvoice.invoiceDateSource === "MISSING")
  ) {
    return "NO_CHANGE";
  }

  const days = input.decision.daysSinceLastValidInvoice;
  const payload = {
    customerId: input.customer.id,
    previousOwnerIdentityKey: input.owner.sellerIdentityKey,
    previousOwnerName: input.owner.sellerCanonicalName,
    ownerStartedAt: input.owner.createdAt.toISOString(),
    lastInvoicedSalesOrderId: input.lastInvoice?.salesOrderId ?? null,
    lastInvoicedSalesOrderNumber: input.lastInvoice?.salesOrderCode ?? null,
    lastValidInvoiceId: input.lastInvoice?.invoiceId ?? null,
    lastValidInvoiceNumber: input.lastInvoice?.invoiceNumber ?? null,
    lastValidInvoiceDate: input.lastInvoice?.invoiceDate
      ? saoPauloDateIso(input.lastInvoice.invoiceDate)
      : null,
    invoiceDateSource: input.lastInvoice?.invoiceDateSource ?? null,
    daysSinceLastValidInvoice: days,
    invoiceStatus: input.lastInvoice?.invoiceStatus ?? null,
    invoiceCanceled: input.lastInvoice?.invoiceCanceled ?? null,
    crmValid: input.preservation.valid,
    crmReasonCode: mapCrmPreviewReasonCode(input.preservation),
    crmDecision: input.preservation.valid ? PORTFOLIO_PRESERVED_REASON : input.preservation.reasonCode,
    evidenceType: input.preservation.evidenceType,
    evidenceId: input.preservation.evidenceId,
    decisionReason: input.decision.reasonCode,
    runId: input.runId,
    analyzedAt: input.referenceDate.toISOString(),
    clockSource: "lastValidInvoiceDate",
  };

  if (input.decision.action === "KEEP_OWNER" && input.decision.reviewDue) {
    await input.client.$transaction(async (tx) => {
      await tx.crmCustomerPortfolioReview.create({
        data: {
          runId: input.runId,
          customerId: input.customer.id,
          action: "KEEP_OWNER",
          reasonCode: PORTFOLIO_PRESERVED_REASON,
          previousOwnerIdentityKey: input.owner.sellerIdentityKey,
          previousOwnerName: input.owner.sellerCanonicalName,
          ownerStartedAt: input.owner.createdAt,
          lastApprovedSalesOrderId: input.lastInvoice?.salesOrderId ?? null,
          lastApprovedSalesOrderCode: input.lastInvoice?.salesOrderCode ?? null,
          lastApprovedIssueDate: input.lastInvoice?.invoiceDate ?? null,
          daysSinceLastApprovedOrder: days,
          crmValid: true,
          evidenceType: input.preservation.evidenceType,
          evidenceId: input.preservation.evidenceId,
          evidenceDate: input.preservation.evidenceDate,
          nextReviewDate: input.preservation.nextReviewDate,
          payload,
        },
      });
      await tx.commercialAuditLog.create({
        data: {
          entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
          entityId: input.customer.id,
          action: PORTFOLIO_PRESERVED_REASON,
          fieldName: "commercialOwner",
          oldValue: input.owner.sellerCanonicalName,
          newValue: input.owner.sellerCanonicalName,
          performedBy: PORTFOLIO_INACTIVITY_PERFORMED_BY,
        },
      });
    });
    return "PRESERVED";
  }

  if (input.decision.action !== "REMOVE_OWNER") return "NO_CHANGE";

  const endedAt = input.referenceDate;
  await input.client.$transaction(async (tx) => {
    const current = await tx.crmCustomerCommercialOwner.findUnique({
      where: { customerId: input.customer.id },
    });
    if (!current?.isActive) return;
    const deactivated = await tx.crmCustomerCommercialOwner.updateMany({
      where: { customerId: input.customer.id, isActive: true },
      data: {
        isActive: false,
        blockAutoAssignUntilManual: true,
        endedAt,
        endReason: PORTFOLIO_INACTIVITY_REASON,
        notes: [current.notes, `endReason=${PORTFOLIO_INACTIVITY_REASON}`, `runId=${input.runId}`]
          .filter(Boolean)
          .join("; "),
        updatedByName: PORTFOLIO_INACTIVITY_PERFORMED_BY,
      },
    });
    if (deactivated.count === 0) return;
    await tx.crmCustomerPortfolioReview.create({
      data: {
        runId: input.runId,
        customerId: input.customer.id,
        action: "REMOVE_OWNER",
        reasonCode: PORTFOLIO_INACTIVITY_REASON,
        previousOwnerIdentityKey: current.sellerIdentityKey,
        previousOwnerName: current.sellerCanonicalName,
        ownerStartedAt: current.createdAt,
        ownerEndedAt: endedAt,
        lastApprovedSalesOrderId: input.lastInvoice?.salesOrderId ?? null,
        lastApprovedSalesOrderCode: input.lastInvoice?.salesOrderCode ?? null,
        lastApprovedIssueDate: input.lastInvoice?.invoiceDate ?? null,
        daysSinceLastApprovedOrder: days,
        crmValid: false,
        evidenceType: input.preservation.evidenceType,
        evidenceId: input.preservation.evidenceId,
        evidenceDate: input.preservation.evidenceDate,
        payload: {
          ...payload,
          ownerEndedAt: endedAt.toISOString(),
          label: INACTIVITY_END_REASON_LABEL,
        },
      },
    });
    await tx.commercialAuditLog.create({
      data: {
        entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
        entityId: input.customer.id,
        action: PORTFOLIO_INACTIVITY_REASON,
        fieldName: "commercialOwner",
        oldValue: current.sellerCanonicalName,
        newValue: "Sem responsável",
        performedBy: PORTFOLIO_INACTIVITY_PERFORMED_BY,
      },
    });
  });
  return "REMOVED";
}

export async function applyCommercialOwnerInactivity(
  referenceDate: Date = new Date(),
  client: PrismaClient = defaultPrisma
): Promise<PortfolioInactivityApplyResult> {
  const runId = randomUUID();
  const owners = await client.crmCustomerCommercialOwner.findMany({ where: { isActive: true } });
  const customerIds = owners.map((row) => row.customerId);
  const customers = customerIds.length
    ? await client.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, companyName: true, taxId: true, nomusExternalPersonId: true },
      })
    : [];
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const [lastInvoices, evidence] = await Promise.all([
    loadLastValidInvoices(client, customerIds),
    loadPortfolioCrmEvidence(client, customerIds),
  ]);

  const results: PortfolioInactivityApplyResult["results"] = [];
  let removed = 0;
  let preserved = 0;
  let unchanged = 0;
  let neverInvoiced = 0;
  let dataAnomaly = 0;

  for (const owner of owners) {
    const customer = customerById.get(owner.customerId);
    if (!customer) {
      unchanged += 1;
      results.push({ customerId: owner.customerId, action: "NO_CHANGE", reasonCode: "CUSTOMER_MISSING" });
      continue;
    }
    const lastInvoice = lastInvoices.get(owner.customerId) ?? null;
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: lastInvoice?.invoiceDate ?? null,
      lastValidInvoiceDate: lastInvoice?.invoiceDate ?? null,
      proposals: evidence.proposals.get(owner.customerId) ?? [],
      contacts: evidence.contacts.get(owner.customerId) ?? [],
    });
    const decision = decideRow({ owner, lastInvoice, preservation, referenceDate });
    if (decision.status === "NEVER_INVOICED" || decision.reasonCode === NEVER_INVOICED) {
      neverInvoiced += 1;
      results.push({
        customerId: owner.customerId,
        action: "REVIEW_REQUIRED",
        reasonCode: NEVER_INVOICED,
      });
      continue;
    }
    if (decision.status === "DATA_ANOMALY" || decision.reasonCode === MISSING_INVOICE_DATE) {
      dataAnomaly += 1;
      results.push({
        customerId: owner.customerId,
        action: "REVIEW_REQUIRED",
        reasonCode: DATA_ANOMALY,
      });
      continue;
    }
    const applied = await recordReviewAndMaybeRemove({
      client,
      runId,
      referenceDate,
      customer,
      owner,
      lastInvoice,
      preservation,
      decision,
    });
    if (applied === "REMOVED") {
      removed += 1;
      results.push({
        customerId: owner.customerId,
        action: "REMOVE_OWNER",
        reasonCode: PORTFOLIO_INACTIVITY_REASON,
      });
    } else if (applied === "PRESERVED") {
      preserved += 1;
      results.push({
        customerId: owner.customerId,
        action: "KEEP_OWNER",
        reasonCode: PORTFOLIO_PRESERVED_REASON,
      });
    } else {
      unchanged += 1;
      results.push({
        customerId: owner.customerId,
        action: "NO_CHANGE",
        reasonCode: decision.reasonCode,
      });
    }
  }

  return {
    referenceDate: saoPauloDateIso(referenceDate),
    runId,
    removed,
    preserved,
    unchanged,
    skippedUnassigned: 0,
    neverInvoiced,
    neverApproved: neverInvoiced,
    dataAnomaly,
    results,
  };
}

export function formatPortfolioInactivityPreview(preview: PortfolioInactivityPreview): string {
  const src = preview.invoiceDateSourceCounts;
  const crm = preview.crmReasonCounts;
  const lines = [
    `referenceDate=${preview.referenceDate}`,
    `analisados=${preview.analyzedCustomers}`,
    `com responsável ativo=${preview.customersWithActiveOwner}`,
    `abaixo de ${portfolioInactivityDays()} dias por NF válida=${preview.withinActivityWindow}`,
    `em revisão=${preview.inReview}`,
    `preservados por CRM=${preview.preservedByCrm}`,
    `elegíveis para remoção=${preview.removalEligible}`,
    `never invoiced=${preview.neverInvoiced}`,
    `data anomaly=${preview.dataAnomaly}`,
    `já sem responsável=${preview.alreadyUnassigned}`,
    `identidade ativos=${preview.withinActivityWindow + preview.inReview + preview.neverInvoiced + preview.dataAnomaly}/${preview.customersWithActiveOwner}`,
    "",
    `invoiceDateSource: NFE_XML_DH_EMI=${src.NFE_XML_DH_EMI} STOCK_DOCUMENT_DATE=${src.STOCK_DOCUMENT_DATE} NFE_PROCESSING_DATE=${src.NFE_PROCESSING_DATE} MISSING=${src.MISSING}`,
    `CRM: ${Object.entries(crm)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => `${key}=${value}`)
      .join(" ") || "-"}`,
    "",
  ];
  for (const row of preview.rows) {
    lines.push(
      [
        row.customerId,
        row.customerExternalId ?? row.externalId ?? "-",
        row.customerName ?? row.name,
        row.currentOwner ?? "sem responsável",
        `PV=${row.lastInvoicedSalesOrderNumber ?? "nunca"}`,
        `NF=${row.lastValidInvoiceNumber ?? "-"}`,
        `NF date=${row.lastValidInvoiceDate ?? "-"}`,
        `dateSource=${row.invoiceDateSource ?? "-"}`,
        `dias=${row.daysSinceLastValidInvoice ?? "-"}`,
        `crm=${row.crmValid ? "sim" : "não"}`,
        `crmReason=${row.crmReasonCode ?? "-"}`,
        row.reasonCode,
        `action=${row.action ?? row.proposedAction}`,
      ].join(" | ")
    );
    if ((row.proposedAction === "KEEP_OWNER" || row.action === "KEEP_OWNER") && row.crmValid) {
      lines.push(`  evidenceType=${row.evidenceType ?? "-"}`);
      lines.push(`  evidenceId=${row.evidenceId ?? "-"}`);
      lines.push(`  evidenceStatus=${row.evidenceStatus ?? "-"}`);
      if (row.evidenceCode) lines.push(`  evidenceCode=${row.evidenceCode}`);
      lines.push(`  evidenceDate=${row.evidenceDate ?? "-"}`);
      if (row.evidenceDateSource) lines.push(`  evidenceDateSource=${row.evidenceDateSource}`);
      lines.push(`  evidenceAgeDays=${row.evidenceAgeDays ?? "-"}`);
      if (row.nextStep) lines.push(`  nextStep=${row.nextStep}`);
      if (row.nextStepDate) lines.push(`  nextStepDate=${row.nextStepDate}`);
      lines.push(`  preservationReason=${row.preservationReason ?? "-"}`);
    }
  }
  return lines.join("\n");
}

export { calendarDaysBetweenSaoPaulo };
