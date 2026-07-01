import type {
  CommissionAuditIssueSeverity,
  CommissionAuditIssueType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber } from "./commission-money.js";
import { calculateCommissions } from "./commission-calculation-service.server.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import type { CommissionAuditQuery } from "./commissionQuery.js";
import { paginatedMeta } from "./commissionQuery.js";

export { CommissionValidationError };

export type CommissionAuditCards = {
  criticalOpenCount: number;
  warningOpenCount: number;
  infoOpenCount: number;
  resolvedInPeriodCount: number;
  ordersWithoutRuleCount: number;
  nfesWithoutOutputDocumentCount: number;
  nfesWithoutReceivableCount: number;
};

export type CommissionAuditListItem = {
  id: string;
  severity: string;
  type: string;
  entityType: string;
  entityId: string | null;
  message: string;
  metadataJson: unknown;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  orderCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  commissionPersonId: string | null;
  commissionPersonName: string | null;
  involvedAmount: number | null;
  suggestedAction: string;
};

export type CommissionAuditPagePayload = {
  cards: CommissionAuditCards;
  rows: CommissionAuditListItem[];
  items: CommissionAuditListItem[];
  pagination: ReturnType<typeof paginatedMeta>;
};

type MetadataFields = {
  orderCode: string | null;
  nfeNumber: string | null;
  nfeExternalId: number | null;
  customerName: string | null;
  commissionPersonId: string | null;
  commissionPersonName: string | null;
  amount: number | null;
  receivableId: number | null;
  localOrderId: string | null;
  commissionRecordId: string | null;
};

function parseMetadata(metadataJson: unknown): MetadataFields {
  const empty: MetadataFields = {
    orderCode: null,
    nfeNumber: null,
    nfeExternalId: null,
    customerName: null,
    commissionPersonId: null,
    commissionPersonName: null,
    amount: null,
    receivableId: null,
    localOrderId: null,
    commissionRecordId: null,
  };
  if (!metadataJson || typeof metadataJson !== "object") return empty;
  const m = metadataJson as Record<string, unknown>;
  const str = (key: string) =>
    typeof m[key] === "string" && (m[key] as string).trim() ? (m[key] as string).trim() : null;
  const num = (key: string) => {
    const v = m[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  return {
    orderCode: str("orderCode"),
    nfeNumber: str("nfeNumber"),
    nfeExternalId: num("nfeExternalId"),
    customerName: str("customerName"),
    commissionPersonId: str("commissionPersonId"),
    commissionPersonName: str("commissionPersonName"),
    amount: num("commissionAmount") ?? num("amount") ?? num("involvedAmount"),
    receivableId: num("receivableId"),
    localOrderId: str("localOrderId"),
    commissionRecordId: str("commissionRecordId"),
  };
}

function resolvePeriod(query: CommissionAuditQuery): { from: Date; to: Date } | null {
  if (query.from && query.to) return { from: query.from, to: query.to };
  if (query.year != null && query.month != null) {
    return {
      from: new Date(Date.UTC(query.year, query.month - 1, 1)),
      to: new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999)),
    };
  }
  if (query.year != null) {
    return {
      from: new Date(Date.UTC(query.year, 0, 1)),
      to: new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999)),
    };
  }
  return null;
}

function buildAuditWhere(query: CommissionAuditQuery): Prisma.CommissionAuditIssueWhereInput {
  const and: Prisma.CommissionAuditIssueWhereInput[] = [];
  if (query.resolved != null) and.push({ resolved: query.resolved });
  if (query.severity) {
    and.push({ severity: query.severity as CommissionAuditIssueSeverity });
  }
  if (query.type) {
    and.push({ type: query.type as CommissionAuditIssueType });
  }
  const period = resolvePeriod(query);
  if (period) {
    and.push({ createdAt: { gte: period.from, lte: period.to } });
  }
  if (query.orderCode) {
    and.push({
      OR: [
        { message: { contains: query.orderCode, mode: "insensitive" } },
        { metadataJson: { path: ["orderCode"], equals: query.orderCode } },
      ],
    });
  }
  if (query.nfeNumber) {
    and.push({
      OR: [
        { message: { contains: query.nfeNumber, mode: "insensitive" } },
        { metadataJson: { path: ["nfeNumber"], equals: query.nfeNumber } },
      ],
    });
  }
  if (query.customer) {
    and.push({
      OR: [
        { message: { contains: query.customer, mode: "insensitive" } },
        { metadataJson: { path: ["customerName"], equals: query.customer } },
      ],
    });
  }
  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

function suggestedActionForType(type: string): string {
  switch (type) {
    case "ORDER_WITHOUT_SELLER":
      return "Cadastre ou vincule o vendedor do pedido em Pessoas Comissionadas.";
    case "ORDER_WITHOUT_REPRESENTATIVE":
      return "Verifique o payload Nomus do pedido ou cadastre o representante.";
    case "NO_COMMISSION_RULE":
      return "Configure uma regra de comissão aplicável ao beneficiário.";
    case "ORDER_WITHOUT_NFE":
      return "Aguarde autorização da NF-e ou verifique integração Nomus.";
    case "NFE_WITHOUT_OUTPUT_DOCUMENT":
      return "Sincronize ou vincule o Documento de Saída da NF-e.";
    case "NFE_WITHOUT_RECEIVABLE":
      return "Verifique Contas a Receber vinculadas à NF-e.";
    case "OUTPUT_DOCUMENT_WITHOUT_ORDER_MATCH":
      return "Revise o vínculo entre documento de saída e pedido.";
    case "RECEIVABLE_WITHOUT_NFE":
      return "Revise o vínculo da Conta a Receber com a NF-e.";
    case "CANCELLED_NFE_WITH_ACTIVE_COMMISSION":
      return "Reprocesse ou estorne comissões ativas da NF-e cancelada.";
    case "RECEIVED_WITHOUT_RELEASE":
      return "Reprocesse liberação por recebimento.";
    case "PAID_WITHOUT_RELEASE":
      return "Revise pagamento e liberação — comissão paga sem valor liberado.";
    case "DIVERGENT_AMOUNT":
      return "Compare base de cálculo, percentual e valores liberados.";
    case "MANUAL_REVIEW_REQUIRED":
      return "Analise manualmente o registro antes de liberar ou pagar.";
    default:
      return "Revise o contexto e reprocesse o período se necessário.";
  }
}

async function appendCommissionPersonFilter(
  where: Prisma.CommissionAuditIssueWhereInput,
  commissionPersonId: string
): Promise<Prisma.CommissionAuditIssueWhereInput> {
  const recordIds = await prisma.commissionRecord.findMany({
    where: { commissionPersonId },
    select: { id: true },
  });
  const personOr: Prisma.CommissionAuditIssueWhereInput[] = [
    { metadataJson: { path: ["commissionPersonId"], equals: commissionPersonId } },
  ];
  if (recordIds.length > 0) {
    personOr.push({
      entityType: "CommissionRecord",
      entityId: { in: recordIds.map((r) => r.id) },
    });
  }
  return { AND: [where, { OR: personOr }] };
}

async function enrichAuditRows(
  rows: Array<{
    id: string;
    severity: string;
    type: string;
    entityType: string;
    entityId: string | null;
    message: string;
    metadataJson: unknown;
    resolved: boolean;
    resolvedAt: Date | null;
    createdAt: Date;
  }>
): Promise<CommissionAuditListItem[]> {
  const recordIds = rows
    .filter((r) => r.entityType === "CommissionRecord" && r.entityId)
    .map((r) => r.entityId!);
  const orderIds = rows
    .filter((r) => r.entityType === "SalesOrder" && r.entityId)
    .map((r) => r.entityId!);

  const [records, orders] = await Promise.all([
    recordIds.length
      ? prisma.commissionRecord.findMany({
          where: { id: { in: recordIds } },
          select: {
            id: true,
            orderCode: true,
            nfeNumber: true,
            customerName: true,
            commissionAmount: true,
            commissionPersonId: true,
            commissionPerson: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    orderIds.length
      ? prisma.salesOrder.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            orderCode: true,
            Customer: { select: { companyName: true, tradeName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const recordMap = new Map(records.map((r) => [r.id, r]));
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return rows
    .map((row) => {
      const meta = parseMetadata(row.metadataJson);
      let orderCode = meta.orderCode;
      let nfeNumber = meta.nfeNumber;
      let customerName = meta.customerName;
      let commissionPersonId = meta.commissionPersonId;
      let commissionPersonName = meta.commissionPersonName;
      let involvedAmount = meta.amount;

      if (row.entityType === "CommissionRecord" && row.entityId) {
        const rec = recordMap.get(row.entityId);
        if (rec) {
          orderCode = orderCode ?? rec.orderCode;
          nfeNumber = nfeNumber ?? rec.nfeNumber;
          customerName = customerName ?? rec.customerName;
          commissionPersonId = commissionPersonId ?? rec.commissionPersonId;
          commissionPersonName = commissionPersonName ?? rec.commissionPerson.name;
          involvedAmount = involvedAmount ?? decimalToNumber(rec.commissionAmount);
        }
      }
      if (row.entityType === "SalesOrder" && row.entityId) {
        const order = orderMap.get(row.entityId);
        if (order) {
          orderCode = orderCode ?? order.orderCode;
          customerName =
            customerName ?? order.Customer.tradeName ?? order.Customer.companyName;
        }
      }

      return {
        id: row.id,
        severity: row.severity,
        type: row.type,
        entityType: row.entityType,
        entityId: row.entityId,
        message: row.message,
        metadataJson: row.metadataJson,
        resolved: row.resolved,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        orderCode,
        nfeNumber,
        customerName,
        commissionPersonId,
        commissionPersonName,
        involvedAmount,
        suggestedAction: suggestedActionForType(row.type),
      };
    });
}

async function computeCards(
  baseWhere: Prisma.CommissionAuditIssueWhereInput,
  period: { from: Date; to: Date } | null
): Promise<CommissionAuditCards> {
  const openWhere = (extra: Prisma.CommissionAuditIssueWhereInput) => ({
    AND: [baseWhere, { resolved: false }, extra],
  });

  const [
    criticalOpenCount,
    warningOpenCount,
    infoOpenCount,
    resolvedInPeriodCount,
    ordersWithoutRuleCount,
    nfesWithoutOutputDocumentCount,
    nfesWithoutReceivableCount,
  ] = await Promise.all([
    prisma.commissionAuditIssue.count({
      where: openWhere({ severity: "CRITICAL" }),
    }),
    prisma.commissionAuditIssue.count({
      where: openWhere({ severity: "WARNING" }),
    }),
    prisma.commissionAuditIssue.count({
      where: openWhere({ severity: "INFO" }),
    }),
    period
      ? prisma.commissionAuditIssue.count({
          where: {
            AND: [
              baseWhere,
              { resolved: true },
              { resolvedAt: { gte: period.from, lte: period.to } },
            ],
          },
        })
      : prisma.commissionAuditIssue.count({
          where: { AND: [baseWhere, { resolved: true }] },
        }),
    prisma.commissionAuditIssue.count({
      where: openWhere({ type: "NO_COMMISSION_RULE" }),
    }),
    prisma.commissionAuditIssue.count({
      where: openWhere({ type: "NFE_WITHOUT_OUTPUT_DOCUMENT" }),
    }),
    prisma.commissionAuditIssue.count({
      where: openWhere({ type: "NFE_WITHOUT_RECEIVABLE" }),
    }),
  ]);

  return {
    criticalOpenCount,
    warningOpenCount,
    infoOpenCount,
    resolvedInPeriodCount,
    ordersWithoutRuleCount,
    nfesWithoutOutputDocumentCount,
    nfesWithoutReceivableCount,
  };
}

export async function listCommissionAuditPage(
  query: CommissionAuditQuery
): Promise<CommissionAuditPagePayload> {
  let where = buildAuditWhere(query);
  if (query.commissionPersonId) {
    where = await appendCommissionPersonFilter(where, query.commissionPersonId);
  }
  const period = resolvePeriod(query);
  const skip = (query.page - 1) * query.pageSize;

  let baseWhereForCards = buildAuditWhere({
    ...query,
    resolved: undefined,
    type: undefined,
    severity: undefined,
  });
  if (query.commissionPersonId) {
    baseWhereForCards = await appendCommissionPersonFilter(
      baseWhereForCards,
      query.commissionPersonId
    );
  }

  const [cards, total, rows] = await Promise.all([
    computeCards(baseWhereForCards, period),
    prisma.commissionAuditIssue.count({ where }),
    prisma.commissionAuditIssue.findMany({
      where,
      orderBy: [
        { resolved: "asc" },
        { severity: "desc" },
        { createdAt: "desc" },
      ],
      skip,
      take: query.pageSize,
    }),
  ]);

  const items = await enrichAuditRows(rows);
  return {
    cards,
    rows: items,
    items,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function listCommissionAuditIssues(query: CommissionAuditQuery) {
  const payload = await listCommissionAuditPage(query);
  return { items: payload.items, pagination: payload.pagination };
}

export async function getCommissionAuditIssueById(id: string): Promise<CommissionAuditListItem> {
  const row = await prisma.commissionAuditIssue.findUnique({ where: { id } });
  if (!row) {
    throw new CommissionValidationError("NOT_FOUND", "Issue de auditoria não encontrada.");
  }
  const [item] = await enrichAuditRows([row]);
  if (!item) {
    throw new CommissionValidationError("NOT_FOUND", "Issue de auditoria não encontrada.");
  }
  return item;
}

export async function resolveCommissionAuditIssue(id: string) {
  const existing = await prisma.commissionAuditIssue.findUnique({ where: { id } });
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Issue de auditoria não encontrada.");
  }
  const row = await prisma.commissionAuditIssue.update({
    where: { id },
    data: { resolved: true, resolvedAt: new Date() },
  });
  const [item] = await enrichAuditRows([row]);
  return item ?? {
    id: row.id,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function reopenCommissionAuditIssue(id: string) {
  const existing = await prisma.commissionAuditIssue.findUnique({ where: { id } });
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Issue de auditoria não encontrada.");
  }
  const row = await prisma.commissionAuditIssue.update({
    where: { id },
    data: { resolved: false, resolvedAt: null },
  });
  const [item] = await enrichAuditRows([row]);
  return item ?? {
    id: row.id,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function rerunCommissionAudit(input: {
  from: Date;
  to: Date;
}): Promise<{ runId: string; summary: Awaited<ReturnType<typeof calculateCommissions>>["summary"] }> {
  const { runId, summary } = await calculateCommissions(prisma, {
    from: input.from,
    to: input.to,
    mode: "FULL_RECALC",
  });
  return { runId, summary };
}
