/**
 * Mapeamento e validação de CommercialActivity para APIs REST.
 */

import type { Prisma } from "@prisma/client";
import { safeCommercialNumber } from "@/src/lib/customerCommercialSalesOrderView";

export const COMMERCIAL_ACTIVITY_API_INCLUDE = {
  Proposal: { select: { number: true, title: true, status: true } },
  SalesOrder: {
    select: {
      id: true,
      orderCode: true,
      status: true,
      issueDate: true,
      totalNetValue: true,
    },
  },
} as const;

export type CommercialActivityApiRow = {
  id: string;
  activityType: string;
  subject: string | null;
  description: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  status: string;
  priority: number | null;
  assignedTo: string | null;
  closeReason: string | null;
  contactDate: Date | null;
  channel: string | null;
  reason: string | null;
  outcome: string | null;
  nextActionAt: Date | null;
  nextActionDescription: string | null;
  createdByName: string | null;
  createdByPhone: string | null;
  createdByEmail: string | null;
  createdAt: Date;
  salesOrderId?: string | null;
  proposalId?: string | null;
  Proposal: {
    number: number;
    title: string | null;
    status: string;
  } | null;
  SalesOrder: {
    id: string;
    orderCode: string;
    status: string;
    issueDate: Date;
    totalNetValue: unknown;
  } | null;
};

export function mapCommercialActivityForApi(row: CommercialActivityApiRow) {
  const proposal = row.Proposal
    ? {
        number: row.Proposal.number,
        title: row.Proposal.title,
        status: row.Proposal.status,
      }
    : null;

  const salesOrder = row.SalesOrder
    ? {
        id: row.SalesOrder.id,
        orderCode: row.SalesOrder.orderCode,
        status: row.SalesOrder.status,
        issueDate: row.SalesOrder.issueDate.toISOString(),
        totalNetValue: safeCommercialNumber(row.SalesOrder.totalNetValue),
      }
    : null;

  return {
    id: row.id,
    activityType: row.activityType,
    subject: row.subject,
    description: row.description,
    scheduledAt: row.scheduledAt,
    completedAt: row.completedAt,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assignedTo,
    closeReason: row.closeReason,
    contactDate: row.contactDate,
    channel: row.channel,
    reason: row.reason,
    outcome: row.outcome,
    nextActionAt: row.nextActionAt,
    nextActionDescription: row.nextActionDescription,
    createdByName: row.createdByName,
    createdByPhone: row.createdByPhone,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt,
    salesOrderId: row.salesOrderId ?? null,
    proposalId: row.proposalId ?? null,
    proposal,
    salesOrder,
  };
}

export function parseOptionalUuidField(raw: unknown): string | null | undefined | "INVALID" {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return "INVALID";
  const t = raw.trim();
  if (!t) return null;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRe.test(t) ? t : "INVALID";
}

export async function resolveCommercialActivitySalesOrderLink(
  customerId: string,
  salesOrderId: string | null | undefined,
  prismaClient: {
    salesOrder: {
      findFirst: (args: {
        where: { id: string; customerId: string };
        select: { id: true };
      }) => Promise<{ id: string } | null>;
    };
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (salesOrderId == null || salesOrderId === undefined) return { ok: true };
  const order = await prismaClient.salesOrder.findFirst({
    where: { id: salesOrderId, customerId },
    select: { id: true },
  });
  if (!order) {
    return { ok: false, error: "salesOrderId não pertence ao cliente informado." };
  }
  return { ok: true };
}

export async function resolveCommercialActivityProposalLink(
  customerId: string,
  proposalId: string | null | undefined,
  prismaClient: {
    proposal: {
      findFirst: (args: {
        where: { id: string; customerId: string };
        select: { id: true };
      }) => Promise<{ id: string } | null>;
    };
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (proposalId == null || proposalId === undefined) return { ok: true };
  const proposal = await prismaClient.proposal.findFirst({
    where: { id: proposalId, customerId },
    select: { id: true },
  });
  if (!proposal) {
    return { ok: false, error: "proposalId não pertence ao cliente informado." };
  }
  return { ok: true };
}

export function applyCommercialActivitySalesOrderToCreate(
  data: Prisma.CommercialActivityCreateInput,
  salesOrderId: string | null | undefined
) {
  if (salesOrderId === undefined) return;
  if (salesOrderId === null) return;
  data.SalesOrder = { connect: { id: salesOrderId } };
}

export function applyCommercialActivityProposalToCreate(
  data: Prisma.CommercialActivityCreateInput,
  proposalId: string | null | undefined
) {
  if (proposalId === undefined) return;
  if (proposalId === null) return;
  data.Proposal = { connect: { id: proposalId } };
}

export function applyCommercialActivitySalesOrderToUpdate(
  data: Prisma.CommercialActivityUpdateInput,
  salesOrderId: string | null | undefined
) {
  if (salesOrderId === undefined) return;
  if (salesOrderId === null) {
    data.SalesOrder = { disconnect: true };
    return;
  }
  data.SalesOrder = { connect: { id: salesOrderId } };
}

export function applyCommercialActivityProposalToUpdate(
  data: Prisma.CommercialActivityUpdateInput,
  proposalId: string | null | undefined
) {
  if (proposalId === undefined) return;
  if (proposalId === null) {
    data.Proposal = { disconnect: true };
    return;
  }
  data.Proposal = { connect: { id: proposalId } };
}

/** SQL de backfill proposalId → salesOrderId (usado na migration e testes). */
export const COMMERCIAL_ACTIVITY_SALES_ORDER_BACKFILL_SQL = `
UPDATE "CommercialActivity" ca
SET "salesOrderId" = so.id
FROM "SalesOrder" so
WHERE ca."proposalId" IS NOT NULL
  AND ca."salesOrderId" IS NULL
  AND so."proposalId" = ca."proposalId"
`;
