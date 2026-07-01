import type { CommissionRecordStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import {
  buildCommissionRecordsWhere,
  paginatedMeta,
  resolveForecastStatusIn,
  type CommissionForecastQuery,
} from "./commissionQuery.js";

export type CommissionForecastCards = {
  totalForecastAmount: number;
  ordersWaitingNfe: number;
  ordersWithoutRule: number;
  ordersWithoutSellerOrRep: number;
  forecastBaseToInvoice: number;
  orderCount: number;
};

export type CommissionForecastOrderRow = {
  orderKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  orderDate: string | null;
  customerName: string | null;
  sellerLabel: string | null;
  representativeLabel: string | null;
  orderAmount: number;
  baseAmount: number;
  ratePercent: number;
  forecastCommissionAmount: number;
  paymentTermsHint: string | null;
  nextDueDate: string | null;
  status: string;
  hasRule: boolean;
  recordIds: string[];
};

export type CommissionForecastPagePayload = {
  cards: CommissionForecastCards;
  rows: CommissionForecastOrderRow[];
  pagination: ReturnType<typeof paginatedMeta>;
};

export type CommissionForecastDetailPayload = {
  orderKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  orderDate: string | null;
  customerName: string | null;
  sellerLabel: string | null;
  representativeLabel: string | null;
  paymentTerms: string | null;
  orderNetValue: number | null;
  status: string;
  forecastReason: string;
  totalBaseAmount: number;
  totalForecastCommission: number;
  items: Array<{
    recordId: string;
    productCode: string | null;
    productName: string | null;
    commissionPersonId: string;
    commissionPersonName: string;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
    ruleId: string | null;
    ruleName: string | null;
  }>;
  installments: Array<{
    installmentNumber: number | null;
    dueDate: string | null;
    expectedAmount: number | null;
    commissionExpectedAmount: number;
  }>;
  auditIssues: Array<{
    id: string;
    severity: string;
    type: string;
    message: string;
    resolved: boolean;
    createdAt: string;
  }>;
};

type RecordWithRelations = {
  id: string;
  status: CommissionRecordStatus;
  orderCode: string | null;
  nomusOrderId: number | null;
  customerName: string | null;
  nomusSellerId: number | null;
  nomusRepresentativeId: number | null;
  baseAmount: unknown;
  ratePercent: unknown;
  commissionAmount: unknown;
  calculatedAt: Date;
  metadataJson: unknown;
  commissionPerson: { id: string; name: string };
  paymentSchedules: Array<{
    installmentNumber: number | null;
    dueDate: Date | null;
    expectedAmount: unknown;
    commissionExpectedAmount: unknown;
  }>;
};

type OrderAggregate = {
  orderKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  customerName: string | null;
  nomusSellerId: number | null;
  nomusRepresentativeId: number | null;
  statuses: Set<CommissionRecordStatus>;
  baseAmount: number;
  commissionAmount: number;
  recordIds: string[];
  latestCalculatedAt: Date;
  schedules: Array<{
    installmentNumber: number | null;
    dueDate: Date | null;
    expectedAmount: number | null;
    commissionExpectedAmount: number;
  }>;
  hasRule: boolean;
};

function buildForecastWhere(
  query: CommissionForecastQuery,
  scope: CommissionAccessScope
): Prisma.CommissionRecordWhereInput {
  const statusIn = resolveForecastStatusIn(query);
  return buildCommissionRecordsWhere(
    {
      ...query,
      statusIn,
      status: null,
    },
    scope
  );
}

function orderKeyFromRecord(row: { orderCode: string | null; nomusOrderId: number | null }): string {
  if (row.orderCode?.trim()) return row.orderCode.trim();
  if (row.nomusOrderId != null) return `nomus:${row.nomusOrderId}`;
  return "unknown";
}

function metadataRule(
  metadataJson: unknown
): { ruleId: string | null; ruleName: string | null } {
  if (!metadataJson || typeof metadataJson !== "object") {
    return { ruleId: null, ruleName: null };
  }
  const meta = metadataJson as Record<string, unknown>;
  return {
    ruleId: typeof meta.ruleId === "string" ? meta.ruleId : null,
    ruleName: typeof meta.ruleName === "string" ? meta.ruleName : null,
  };
}

function recordHasRule(metadataJson: unknown): boolean {
  return metadataRule(metadataJson).ruleId != null;
}

function resolveOrderStatus(statuses: Set<CommissionRecordStatus>): CommissionRecordStatus {
  if (statuses.has("WAITING_NFE")) return "WAITING_NFE";
  if (statuses.has("FORECAST_FROM_ORDER")) return "FORECAST_FROM_ORDER";
  if (statuses.has("SUPERSEDED_BY_OUTPUT_DOCUMENT")) return "SUPERSEDED_BY_OUTPUT_DOCUMENT";
  return [...statuses][0] ?? "FORECAST_FROM_ORDER";
}

function forecastReasonForStatus(status: CommissionRecordStatus): string {
  if (status === "WAITING_NFE") {
    return "Pedido com NF-e vinculada aguardando autorização ou documento de saída. A comissão permanece provisória até a confirmação.";
  }
  if (status === "SUPERSEDED_BY_OUTPUT_DOCUMENT") {
    return "Previsão substituída após emissão de documento de saída/NF-e autorizada.";
  }
  return "Pedido sem NF-e autorizada; comissão calculada a partir dos itens e condições do Pedido de Venda.";
}

function mergeSchedule(
  target: OrderAggregate["schedules"],
  schedule: OrderAggregate["schedules"][number]
) {
  const key = `${schedule.installmentNumber ?? "x"}|${schedule.dueDate?.toISOString() ?? ""}`;
  const existing = target.find(
    (s) =>
      `${s.installmentNumber ?? "x"}|${s.dueDate?.toISOString() ?? ""}` === key
  );
  if (existing) {
    existing.commissionExpectedAmount = roundMoney(
      existing.commissionExpectedAmount + schedule.commissionExpectedAmount
    );
    if (existing.expectedAmount == null && schedule.expectedAmount != null) {
      existing.expectedAmount = schedule.expectedAmount;
    }
    return;
  }
  target.push({ ...schedule });
}

function aggregateRecords(rows: RecordWithRelations[]): OrderAggregate[] {
  const map = new Map<string, OrderAggregate>();

  for (const row of rows) {
    const key = orderKeyFromRecord(row);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        orderKey: key,
        orderCode: row.orderCode,
        nomusOrderId: row.nomusOrderId,
        customerName: row.customerName,
        nomusSellerId: row.nomusSellerId,
        nomusRepresentativeId: row.nomusRepresentativeId,
        statuses: new Set(),
        baseAmount: 0,
        commissionAmount: 0,
        recordIds: [],
        latestCalculatedAt: row.calculatedAt,
        schedules: [],
        hasRule: false,
      };
      map.set(key, agg);
    }

    agg.statuses.add(row.status);
    agg.baseAmount = roundMoney(agg.baseAmount + decimalToNumber(row.baseAmount));
    agg.commissionAmount = roundMoney(
      agg.commissionAmount + decimalToNumber(row.commissionAmount)
    );
    agg.recordIds.push(row.id);
    if (row.calculatedAt > agg.latestCalculatedAt) {
      agg.latestCalculatedAt = row.calculatedAt;
    }
    if (row.nomusSellerId != null) agg.nomusSellerId = row.nomusSellerId;
    if (row.nomusRepresentativeId != null) {
      agg.nomusRepresentativeId = row.nomusRepresentativeId;
    }
    if (row.customerName) agg.customerName = row.customerName;
    if (recordHasRule(row.metadataJson)) agg.hasRule = true;

    for (const schedule of row.paymentSchedules) {
      mergeSchedule(agg.schedules, {
        installmentNumber: schedule.installmentNumber,
        dueDate: schedule.dueDate,
        expectedAmount:
          schedule.expectedAmount != null
            ? decimalToNumber(schedule.expectedAmount)
            : null,
        commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => b.latestCalculatedAt.getTime() - a.latestCalculatedAt.getTime()
  );
}

function filterAggregatesByHasRule(
  aggregates: OrderAggregate[],
  hasRule: boolean | null
): OrderAggregate[] {
  if (hasRule == null) return aggregates;
  return aggregates.filter((agg) => (hasRule ? agg.hasRule : !agg.hasRule));
}

async function resolvePersonNameMap(nomusIds: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(nomusIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Map();
  const persons = await prisma.commissionPerson.findMany({
    where: { nomusPersonId: { in: unique } },
    select: { nomusPersonId: true, name: true },
    orderBy: { name: "asc" },
  });
  const map = new Map<number, string>();
  for (const person of persons) {
    if (person.nomusPersonId != null && !map.has(person.nomusPersonId)) {
      map.set(person.nomusPersonId, person.name);
    }
  }
  return map;
}

async function resolveSalesOrderMap(orderCodes: string[]) {
  const unique = [...new Set(orderCodes.filter(Boolean))];
  if (unique.length === 0) return new Map<string, {
    id: string;
    issueDate: Date;
    paymentTerms: string | null;
    paymentMethod: string | null;
    totalNetValue: unknown;
    responsible: string | null;
  }>();
  const orders = await prisma.salesOrder.findMany({
    where: { orderCode: { in: unique } },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      paymentTerms: true,
      paymentMethod: true,
      totalNetValue: true,
      responsible: true,
    },
  });
  return new Map(orders.map((order) => [order.orderCode, order]));
}

function resolveSellerLabel(
  nomusSellerId: number | null,
  personMap: Map<number, string>,
  salesOrderResponsible: string | null
): string | null {
  if (nomusSellerId != null) {
    return personMap.get(nomusSellerId) ?? `Vendedor #${nomusSellerId}`;
  }
  return salesOrderResponsible?.trim() || null;
}

function resolveRepresentativeLabel(
  nomusRepresentativeId: number | null,
  personMap: Map<number, string>
): string | null {
  if (nomusRepresentativeId == null) return null;
  return (
    personMap.get(nomusRepresentativeId) ?? `Representante #${nomusRepresentativeId}`
  );
}

function resolvePaymentTermsHint(
  salesOrder: { paymentTerms: string | null; paymentMethod: string | null } | undefined
): string | null {
  if (!salesOrder) return null;
  const terms = salesOrder.paymentTerms?.trim();
  const method = salesOrder.paymentMethod?.trim();
  if (terms && method) return `${terms} · ${method}`;
  return terms || method || null;
}

function resolveNextDueDate(
  schedules: OrderAggregate["schedules"]
): string | null {
  const dated = schedules
    .filter((s) => s.dueDate)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  if (dated.length === 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = dated.find((s) => {
    const due = new Date(s.dueDate!);
    due.setHours(0, 0, 0, 0);
    return due.getTime() >= today.getTime();
  });
  return (upcoming ?? dated[0])!.dueDate!.toISOString();
}

async function countAuditOrdersWithoutRule(
  orderCodes: string[],
  query: CommissionForecastQuery
): Promise<number> {
  const where: Prisma.CommissionAuditIssueWhereInput = {
    type: "NO_COMMISSION_RULE",
    resolved: false,
  };

  if (orderCodes.length > 0) {
    where.OR = orderCodes.map((code) => ({
      metadataJson: { path: ["orderCode"], equals: code },
    }));
  } else if (query.orderCode) {
    where.OR = [
      {
        metadataJson: { path: ["orderCode"], equals: query.orderCode },
      },
    ];
  }

  const issues = await prisma.commissionAuditIssue.findMany({
    where,
    select: { metadataJson: true },
  });
  const codes = new Set<string>();
  for (const issue of issues) {
    const code = extractOrderCodeFromMetadata(issue.metadataJson);
    if (code) codes.add(code);
  }
  return codes.size;
}

function extractOrderCodeFromMetadata(metadataJson: unknown): string | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const code = (metadataJson as Record<string, unknown>).orderCode;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

async function fetchForecastRecords(
  query: CommissionForecastQuery,
  scope: CommissionAccessScope
): Promise<RecordWithRelations[]> {
  const where = buildForecastWhere(query, scope);
  return prisma.commissionRecord.findMany({
    where,
    include: {
      commissionPerson: { select: { id: true, name: true } },
      paymentSchedules: {
        where: { source: "SALES_ORDER_INSTALLMENT" },
        orderBy: [{ installmentNumber: "asc" }, { dueDate: "asc" }],
      },
    },
    orderBy: [{ calculatedAt: "desc" }, { orderCode: "asc" }],
  });
}

async function buildOrderRows(
  aggregates: OrderAggregate[],
  personMap: Map<number, string>,
  salesOrderMap: Awaited<ReturnType<typeof resolveSalesOrderMap>>
): Promise<CommissionForecastOrderRow[]> {
  return aggregates.map((agg) => {
    const salesOrder = agg.orderCode ? salesOrderMap.get(agg.orderCode) : undefined;
    const status = resolveOrderStatus(agg.statuses);
    const orderAmount =
      salesOrder != null
        ? decimalToNumber(salesOrder.totalNetValue)
        : agg.baseAmount;
    const ratePercent =
      agg.baseAmount > 0
        ? Math.round((agg.commissionAmount / agg.baseAmount) * 10000) / 100
        : 0;

    return {
      orderKey: agg.orderKey,
      orderCode: agg.orderCode,
      nomusOrderId: agg.nomusOrderId,
      localOrderId: salesOrder?.id ?? null,
      orderDate: salesOrder?.issueDate.toISOString() ?? agg.latestCalculatedAt.toISOString(),
      customerName: agg.customerName,
      sellerLabel: resolveSellerLabel(
        agg.nomusSellerId,
        personMap,
        salesOrder?.responsible ?? null
      ),
      representativeLabel: resolveRepresentativeLabel(
        agg.nomusRepresentativeId,
        personMap
      ),
      orderAmount,
      baseAmount: agg.baseAmount,
      ratePercent,
      forecastCommissionAmount: agg.commissionAmount,
      paymentTermsHint: resolvePaymentTermsHint(salesOrder),
      nextDueDate: resolveNextDueDate(agg.schedules),
      status,
      hasRule: agg.hasRule,
      recordIds: agg.recordIds,
    };
  });
}

function buildCards(
  aggregates: OrderAggregate[],
  ordersWithoutRule: number
): CommissionForecastCards {
  const orderKeysWaitingNfe = new Set<string>();
  const orderKeysWithoutSellerOrRep = new Set<string>();

  let totalForecastAmount = 0;
  let forecastBaseToInvoice = 0;

  for (const agg of aggregates) {
    totalForecastAmount = roundMoney(totalForecastAmount + agg.commissionAmount);
    forecastBaseToInvoice = roundMoney(forecastBaseToInvoice + agg.baseAmount);
    if (agg.statuses.has("WAITING_NFE")) {
      orderKeysWaitingNfe.add(agg.orderKey);
    }
    if (agg.nomusSellerId == null && agg.nomusRepresentativeId == null) {
      orderKeysWithoutSellerOrRep.add(agg.orderKey);
    }
  }

  return {
    totalForecastAmount,
    ordersWaitingNfe: orderKeysWaitingNfe.size,
    ordersWithoutRule,
    ordersWithoutSellerOrRep: orderKeysWithoutSellerOrRep.size,
    forecastBaseToInvoice,
    orderCount: aggregates.length,
  };
}

export async function listCommissionForecastPage(
  query: CommissionForecastQuery,
  scope: CommissionAccessScope
): Promise<CommissionForecastPagePayload> {
  const rows = await fetchForecastRecords(query, scope);
  let aggregates = aggregateRecords(rows);
  aggregates = filterAggregatesByHasRule(aggregates, query.hasRule);

  const orderCodes = aggregates
    .map((agg) => agg.orderCode)
    .filter((code): code is string => Boolean(code));
  const nomusIds = aggregates.flatMap((agg) =>
    [agg.nomusSellerId, agg.nomusRepresentativeId].filter(
      (id): id is number => id != null
    )
  );

  const [personMap, salesOrderMap, ordersWithoutRule] = await Promise.all([
    resolvePersonNameMap(nomusIds),
    resolveSalesOrderMap(orderCodes),
    countAuditOrdersWithoutRule(orderCodes, query),
  ]);

  const totalOrders = aggregates.length;
  const skip = (query.page - 1) * query.pageSize;
  const pageAggregates = aggregates.slice(skip, skip + query.pageSize);
  const tableRows = await buildOrderRows(pageAggregates, personMap, salesOrderMap);

  return {
    cards: buildCards(aggregates, ordersWithoutRule),
    rows: tableRows,
    pagination: paginatedMeta(totalOrders, query.page, query.pageSize),
  };
}

export async function getCommissionForecastOrderDetail(
  orderKey: string,
  query: CommissionForecastQuery,
  scope: CommissionAccessScope
): Promise<CommissionForecastDetailPayload | null> {
  const nomusMatch = orderKey.match(/^nomus:(\d+)$/);
  const baseWhere = buildForecastWhere(
    { ...query, orderCode: null, hasRule: null },
    scope
  );
  const orderWhere: Prisma.CommissionRecordWhereInput = nomusMatch
    ? { nomusOrderId: Number(nomusMatch[1]) }
    : { orderCode: orderKey };

  const filtered = await prisma.commissionRecord.findMany({
    where: { AND: [baseWhere, orderWhere] },
    include: {
      commissionPerson: { select: { id: true, name: true } },
      paymentSchedules: {
        where: { source: "SALES_ORDER_INSTALLMENT" },
        orderBy: [{ installmentNumber: "asc" }, { dueDate: "asc" }],
      },
    },
    orderBy: [{ calculatedAt: "desc" }],
  });
  if (filtered.length === 0) return null;

  const aggregates = aggregateRecords(filtered);
  const agg = aggregates[0]!;
  const orderCode = agg.orderCode;
  const nomusIds = [agg.nomusSellerId, agg.nomusRepresentativeId].filter(
    (id): id is number => id != null
  );

  const [personMap, salesOrderMap, auditIssues] = await Promise.all([
    resolvePersonNameMap(nomusIds),
    resolveSalesOrderMap(orderCode ? [orderCode] : []),
    prisma.commissionAuditIssue.findMany({
      where: {
        resolved: false,
        OR: [
          ...(orderCode
            ? [{ metadataJson: { path: ["orderCode"], equals: orderCode } }]
            : []),
          ...(agg.nomusOrderId != null
            ? [{ metadataJson: { path: ["nomusOrderId"], equals: agg.nomusOrderId } }]
            : []),
        ],
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
  ]);

  const salesOrder = orderCode ? salesOrderMap.get(orderCode) : undefined;
  const status = resolveOrderStatus(agg.statuses);

  const installments = [...agg.schedules].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  return {
    orderKey: agg.orderKey,
    orderCode: agg.orderCode,
    nomusOrderId: agg.nomusOrderId,
    localOrderId: salesOrder?.id ?? null,
    orderDate: salesOrder?.issueDate.toISOString() ?? agg.latestCalculatedAt.toISOString(),
    customerName: agg.customerName,
    sellerLabel: resolveSellerLabel(
      agg.nomusSellerId,
      personMap,
      salesOrder?.responsible ?? null
    ),
    representativeLabel: resolveRepresentativeLabel(
      agg.nomusRepresentativeId,
      personMap
    ),
    paymentTerms: resolvePaymentTermsHint(salesOrder),
    orderNetValue:
      salesOrder != null ? decimalToNumber(salesOrder.totalNetValue) : null,
    status,
    forecastReason: forecastReasonForStatus(status),
    totalBaseAmount: agg.baseAmount,
    totalForecastCommission: agg.commissionAmount,
    items: filtered.map((row) => {
      const rule = metadataRule(row.metadataJson);
      return {
        recordId: row.id,
        productCode: row.productCode ?? null,
        productName: row.productName ?? null,
        commissionPersonId: row.commissionPerson.id,
        commissionPersonName: row.commissionPerson.name,
        baseAmount: decimalToNumber(row.baseAmount),
        ratePercent: decimalToNumber(row.ratePercent),
        commissionAmount: decimalToNumber(row.commissionAmount),
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
      };
    }),
    installments: installments.map((inst) => ({
      installmentNumber: inst.installmentNumber,
      dueDate: inst.dueDate?.toISOString() ?? null,
      expectedAmount: inst.expectedAmount,
      commissionExpectedAmount: inst.commissionExpectedAmount,
    })),
    auditIssues: auditIssues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      type: issue.type,
      message: issue.message,
      resolved: issue.resolved,
      createdAt: issue.createdAt.toISOString(),
    })),
  };
}
