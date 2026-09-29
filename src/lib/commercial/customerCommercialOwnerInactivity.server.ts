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
  INACTIVITY_END_REASON_LABEL,
  NEVER_APPROVED_SALES_ORDER,
  PORTFOLIO_INACTIVITY_REASON,
  PORTFOLIO_PRESERVED_REASON,
  calendarDaysBetweenSaoPaulo,
  decideCommercialOwnerInactivityAction,
  evaluateCommercialPortfolioPreservation,
  pickLatestApprovedSalesOrder,
  portfolioInactivityDays,
  saoPauloDateIso,
  type CommercialPortfolioPreservation,
  type LastApprovedSalesOrder,
  type PortfolioContactEvidence,
  type PortfolioInactivityAction,
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
  externalId: number | null;
  taxId: string;
  name: string;
  currentOwner: string | null;
  lastApprovedSalesOrderId: string | null;
  lastApprovedSalesOrderCode: string | null;
  lastApprovedIssueDate: string | null;
  daysSinceLastApprovedOrder: number | null;
  crmValid: boolean;
  evidenceType: string | null;
  evidenceId: string | null;
  reasonCode: string;
  proposedAction: PortfolioInactivityAction;
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
  neverApprovedSalesOrder: number;
  alreadyUnassigned: number;
  rows: PortfolioInactivityPreviewRow[];
};

export type PortfolioInactivityApplyResult = {
  referenceDate: string;
  runId: string;
  removed: number;
  preserved: number;
  unchanged: number;
  skippedUnassigned: number;
  neverApproved: number;
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

function decideRow(input: {
  owner: OwnerRow | null;
  lastApproved: LastApprovedSalesOrder | null;
  preservation: CommercialPortfolioPreservation;
  referenceDate: Date;
}) {
  return decideCommercialOwnerInactivityAction({
    hasActiveOwner: Boolean(input.owner?.isActive),
    lastApprovedOrder: input.lastApproved,
    referenceDate: input.referenceDate,
    preservation: input.preservation,
  });
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
  const [lastOrders, evidence] = await Promise.all([
    loadLastApprovedSalesOrders(client, customerIds),
    loadPortfolioCrmEvidence(client, customerIds),
  ]);

  const rows: PortfolioInactivityPreviewRow[] = [];
  let withActive = 0;
  let within = 0;
  let inReview = 0;
  let preserved = 0;
  let removal = 0;
  let neverApproved = 0;
  let unassigned = 0;

  for (const customer of customers as CustomerRow[]) {
    const owner = ownerByCustomer.get(customer.id) ?? null;
    const lastApproved = lastOrders.get(customer.id) ?? null;
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: lastApproved?.issueDate ?? null,
      proposals: evidence.proposals.get(customer.id) ?? [],
      contacts: evidence.contacts.get(customer.id) ?? [],
    });
    const decision = decideRow({ owner, lastApproved, preservation, referenceDate });
    if (owner?.isActive) withActive += 1;
    if (decision.status === "ACTIVE") within += 1;
    if (decision.reviewDue) inReview += 1;
    if (decision.status === "PRESERVED_BY_CRM") preserved += 1;
    if (decision.action === "REMOVE_OWNER") removal += 1;
    if (decision.reasonCode === NEVER_APPROVED_SALES_ORDER) neverApproved += 1;
    if (decision.status === "UNASSIGNED") unassigned += 1;

    if (decision.reviewDue || decision.reasonCode === NEVER_APPROVED_SALES_ORDER) {
      rows.push({
        customerId: customer.id,
        externalId: customer.nomusExternalPersonId,
        taxId: customer.taxId,
        name: customer.companyName,
        currentOwner: owner?.isActive ? owner.sellerCanonicalName : null,
        lastApprovedSalesOrderId: lastApproved?.id ?? null,
        lastApprovedSalesOrderCode: lastApproved?.orderCode ?? null,
        lastApprovedIssueDate: lastApproved ? saoPauloDateIso(lastApproved.issueDate) : null,
        daysSinceLastApprovedOrder: decision.daysSinceLastApprovedOrder,
        crmValid: preservation.valid,
        evidenceType: preservation.evidenceType,
        evidenceId: preservation.evidenceId,
        reasonCode: decision.reasonCode,
        proposedAction: decision.action,
        status: decision.status,
      });
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
    neverApprovedSalesOrder: neverApproved,
    alreadyUnassigned: unassigned,
    rows,
  };
}

async function recordReviewAndMaybeRemove(input: {
  client: PrismaClient;
  runId: string;
  referenceDate: Date;
  customer: CustomerRow;
  owner: OwnerRow;
  lastApproved: LastApprovedSalesOrder | null;
  preservation: CommercialPortfolioPreservation;
  decision: ReturnType<typeof decideCommercialOwnerInactivityAction>;
}): Promise<"REMOVED" | "PRESERVED" | "NO_CHANGE"> {
  if (!input.owner.isActive) return "NO_CHANGE";
  if (input.decision.action === "REVIEW_REQUIRED") return "NO_CHANGE";
  if (input.decision.action === "KEEP_OWNER" && !input.decision.reviewDue) return "NO_CHANGE";

  const days = input.decision.daysSinceLastApprovedOrder;
  const payload = {
    customerId: input.customer.id,
    previousOwnerIdentityKey: input.owner.sellerIdentityKey,
    previousOwnerName: input.owner.sellerCanonicalName,
    ownerStartedAt: input.owner.createdAt.toISOString(),
    lastApprovedSalesOrderId: input.lastApproved?.id ?? null,
    lastApprovedIssueDate: input.lastApproved ? saoPauloDateIso(input.lastApproved.issueDate) : null,
    daysSinceLastApprovedOrder: days,
    crmValid: input.preservation.valid,
    evidenceType: input.preservation.evidenceType,
    evidenceId: input.preservation.evidenceId,
    runId: input.runId,
    analyzedAt: input.referenceDate.toISOString(),
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
          lastApprovedSalesOrderId: input.lastApproved?.id ?? null,
          lastApprovedSalesOrderCode: input.lastApproved?.orderCode ?? null,
          lastApprovedIssueDate: input.lastApproved?.issueDate ?? null,
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
    await tx.crmCustomerCommercialOwner.update({
      where: { customerId: input.customer.id },
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
        lastApprovedSalesOrderId: input.lastApproved?.id ?? null,
        lastApprovedSalesOrderCode: input.lastApproved?.orderCode ?? null,
        lastApprovedIssueDate: input.lastApproved?.issueDate ?? null,
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
  const [lastOrders, evidence] = await Promise.all([
    loadLastApprovedSalesOrders(client, customerIds),
    loadPortfolioCrmEvidence(client, customerIds),
  ]);

  const results: PortfolioInactivityApplyResult["results"] = [];
  let removed = 0;
  let preserved = 0;
  let unchanged = 0;
  let neverApproved = 0;

  for (const owner of owners) {
    const customer = customerById.get(owner.customerId);
    if (!customer) {
      unchanged += 1;
      results.push({ customerId: owner.customerId, action: "NO_CHANGE", reasonCode: "CUSTOMER_MISSING" });
      continue;
    }
    const lastApproved = lastOrders.get(owner.customerId) ?? null;
    const preservation = evaluateCommercialPortfolioPreservation({
      referenceDate,
      lastApprovedIssueDate: lastApproved?.issueDate ?? null,
      proposals: evidence.proposals.get(owner.customerId) ?? [],
      contacts: evidence.contacts.get(owner.customerId) ?? [],
    });
    const decision = decideRow({ owner, lastApproved, preservation, referenceDate });
    if (decision.reasonCode === NEVER_APPROVED_SALES_ORDER) {
      neverApproved += 1;
      results.push({
        customerId: owner.customerId,
        action: "REVIEW_REQUIRED",
        reasonCode: NEVER_APPROVED_SALES_ORDER,
      });
      continue;
    }
    const applied = await recordReviewAndMaybeRemove({
      client,
      runId,
      referenceDate,
      customer,
      owner,
      lastApproved,
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
    neverApproved,
    results,
  };
}

export function formatPortfolioInactivityPreview(preview: PortfolioInactivityPreview): string {
  const lines = [
    `referenceDate=${preview.referenceDate}`,
    `analisados=${preview.analyzedCustomers}`,
    `com responsável ativo=${preview.customersWithActiveOwner}`,
    `abaixo de ${portfolioInactivityDays()} dias=${preview.withinActivityWindow}`,
    `em revisão=${preview.inReview}`,
    `preservados por CRM=${preview.preservedByCrm}`,
    `elegíveis para remoção=${preview.removalEligible}`,
    `sem PV aprovado=${preview.neverApprovedSalesOrder}`,
    `já sem responsável=${preview.alreadyUnassigned}`,
    "",
  ];
  for (const row of preview.rows) {
    lines.push(
      [
        row.customerId,
        row.externalId ?? "-",
        row.name,
        row.currentOwner ?? "sem responsável",
        row.lastApprovedSalesOrderCode ?? "nunca",
        `dias=${row.daysSinceLastApprovedOrder ?? "-"}`,
        `crm=${row.crmValid ? "sim" : "não"}`,
        row.evidenceType ?? "-",
        row.reasonCode,
        row.proposedAction,
      ].join(" | ")
    );
  }
  return lines.join("\n");
}

export { calendarDaysBetweenSaoPaulo };
