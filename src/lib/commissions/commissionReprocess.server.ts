/**
 * Reprocessamento de comissões — persistência e orquestração.
 * Motor oficial: materializeCommissionForSalesOrder + rebuildCommissionReceivableSchedule.
 * Vendedor = SalesOrder.externalSellerId (Pedido de Venda Nomus). Proposal não é fonte de vendedor.
 * Nunca muta comissão já paga/fechada (lifecycle "paid").
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import {
  aggregateCommissionReprocessSummary,
  assertCanPreviewCommissionReprocess,
  assertCanReprocessCommission,
  buildCommissionReprocessDiff,
  classifyCommissionReprocessLifecycle,
  COMMISSION_REPROCESS_APPLY_KIND,
  COMMISSION_REPROCESS_ENGINE,
  COMMISSION_REPROCESS_LOCK_KEY,
  COMMISSION_REPROCESS_PREVIEW_KIND,
  defaultCommissionReprocessFilters,
  groupReprocessAffected,
  hashCommissionReprocessFilters,
  resolveReprocessRowDecision,
  roundCommissionMoney,
  type CommissionReprocessApplyResult,
  type CommissionReprocessDiffRow,
  type CommissionReprocessFilters,
  type CommissionReprocessPreviewResult,
} from "./commissionReprocess.js";
import { materializeCommissionForSalesOrder } from "./commissionOrderMaterializer.server.js";
import { rebuildCommissionReceivableSchedule } from "./commissionReceivableScheduler.server.js";

/** Teto de pedidos analisados por rodada de preview/apply — protege contra varreduras sem filtro. */
export const MAX_ORDERS = 2000;

/** TTL do lock operacional — evita lock "travado" por falha sem finally executado (ex.: crash do processo). */
const REPROCESS_LOCK_TTL_MS = 15 * 60 * 1000;

const REPROCESS_PAID_RECORD_STATUSES = ["PAID_PARTIAL", "PAID_TOTAL"] as const;

export class CommissionReprocessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CommissionReprocessError";
    this.code = code;
    this.status = status;
  }
}

export type CommissionReprocessRunInput = {
  filters: Partial<CommissionReprocessFilters> & Record<string, unknown>;
  userId: string;
  userRole: string;
  permissions?: string[];
};

export type CommissionReprocessApplyInput = CommissionReprocessRunInput & {
  reason: string;
  runToken?: string | null;
};

/** Normaliza filtros brutos (API/CLI) para o shape puro usado no motor de reprocessamento. */
export function normalizeCommissionReprocessFilters(
  raw: Partial<CommissionReprocessFilters> & Record<string, unknown>
): CommissionReprocessFilters {
  return defaultCommissionReprocessFilters({
    from: raw.from ?? null,
    to: raw.to ?? null,
    dateAxis: (raw.dateAxis as CommissionReprocessFilters["dateAxis"]) ?? "issue",
    customerExternalId: raw.customerExternalId ?? null,
    sellerExternalId: raw.sellerExternalId ?? null,
    salesOrderCode: raw.salesOrderCode ?? null,
    productCode: raw.productCode ?? null,
    priceTableId: raw.priceTableId ?? null,
    statuses: (raw.statuses as CommissionReprocessFilters["statuses"]) ?? undefined,
    includeConfirmedNotPaid: raw.includeConfirmedNotPaid ?? true,
    includeReleasedNotPaid: raw.includeReleasedNotPaid ?? false,
    includePaid: raw.includePaid ?? false,
  });
}

function parseFilterDateBoundary(value: string, endOfDay: boolean): Date | null {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const iso = isDateOnly
    ? `${value.trim()}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : value;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildDateRangeFilter(
  from: string | null,
  to: string | null
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) {
    const gte = parseFilterDateBoundary(from, false);
    if (gte) range.gte = gte;
  }
  if (to) {
    const lte = parseFilterDateBoundary(to, true);
    if (lte) range.lte = lte;
  }
  return Object.keys(range).length > 0 ? range : undefined;
}

function resolvePeriodBound(from: string | null, to: string | null, which: "start" | "end"): Date {
  const raw = which === "start" ? from : to;
  if (raw) {
    const parsed = parseFilterDateBoundary(raw, which === "end");
    if (parsed) return parsed;
  }
  return new Date();
}

/**
 * NFs cujo recebimento ocorreu na janela pedida (eixo `settlement` do reprocesso).
 *
 * A competência do reprocesso passou a ser a DATA REAL DO RECEBIMENTO: reprocessar
 * julho tem de alcançar o CR recebido em 31/07 mesmo que a baixa tenha saído em
 * 03/08. `settlementDate` não participa mais desta seleção.
 */
async function resolveReceiptNfeExternalIds(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusReceivableReceipt">,
  dateRange: { gte?: Date; lte?: Date } | undefined
): Promise<number[]> {
  const receipts = await db.nomusReceivableReceipt.findMany({
    where: dateRange ? { receiptDate: dateRange } : {},
    select: { receivableExternalId: true },
    distinct: ["receivableExternalId"],
  });
  const receivableIds = receipts.map((row) => row.receivableExternalId);
  if (receivableIds.length === 0) return [];

  const rows = await db.nomusAccountsReceivable.findMany({
    where: {
      externalId: { in: receivableIds },
      sourceInvoiceId: { not: null },
    },
    select: { sourceInvoiceId: true },
    distinct: ["sourceInvoiceId"],
  });
  return rows
    .map((row) => row.sourceInvoiceId)
    .filter((value): value is number => value != null);
}

async function resolvePriceTableProductIds(
  db: Pick<PrismaClient, "priceTableItem">,
  priceTableId: string
): Promise<string[]> {
  const rows = await db.priceTableItem.findMany({
    where: { PriceTableVersion: { priceTableId } },
    select: { productId: true },
    distinct: ["productId"],
  });
  return rows.map((row) => row.productId);
}

type FindAffectedOrdersDb = Pick<
  PrismaClient,
  "salesOrder" | "nomusAccountsReceivable" | "nomusReceivableReceipt" | "priceTableItem"
>;

/**
 * Localiza pedidos de venda afetados pelos filtros de reprocessamento.
 * dateAxis: issue = SalesOrder.issueDate; nfe = SalesOrderNfeLink.dataProcessamento;
 * settlement = NomusReceivableReceipt.receiptDate (recebimento real, via nfeExternalId da NF vinculada).
 * priceTableId: Proposal.priceTableId OU produtos do pedido presentes na tabela de preço.
 */
export async function findAffectedCommissionSalesOrderIds(
  db: FindAffectedOrdersDb,
  filters: CommissionReprocessFilters
): Promise<string[]> {
  const where: Prisma.SalesOrderWhereInput = {};
  const dateRange = buildDateRangeFilter(filters.from, filters.to);

  if (filters.customerExternalId != null) {
    where.externalCustomerId = filters.customerExternalId;
  }
  if (filters.sellerExternalId != null) {
    where.externalSellerId = filters.sellerExternalId;
  }
  if (filters.salesOrderCode) {
    where.orderCode = { contains: filters.salesOrderCode, mode: "insensitive" };
  }

  if (filters.dateAxis === "issue" && dateRange) {
    where.issueDate = dateRange;
  } else if (filters.dateAxis === "nfe") {
    where.nfeLinks = { some: dateRange ? { dataProcessamento: dateRange } : {} };
  } else if (filters.dateAxis === "settlement") {
    const settledNfeIds = await resolveReceiptNfeExternalIds(db, dateRange);
    where.nfeLinks = { some: { nfeExternalId: { in: settledNfeIds.length > 0 ? settledNfeIds : [-1] } } };
  }

  if (filters.productCode) {
    const code = filters.productCode.trim();
    where.items = {
      some: {
        OR: [
          { skuSnapshot: { equals: code, mode: "insensitive" } },
          { Product: { sku: { equals: code, mode: "insensitive" } } },
        ],
      },
    };
  }

  if (filters.priceTableId) {
    const priceTableProductIds = await resolvePriceTableProductIds(db, filters.priceTableId);
    const priceTableOr: Prisma.SalesOrderWhereInput[] = [
      { Proposal: { priceTableId: filters.priceTableId } },
    ];
    if (priceTableProductIds.length > 0) {
      priceTableOr.push({ items: { some: { productId: { in: priceTableProductIds } } } });
    }
    where.OR = priceTableOr;
  }

  const rows = await db.salesOrder.findMany({
    where,
    select: { id: true },
    orderBy: { issueDate: "desc" },
    take: MAX_ORDERS,
  });

  return rows.map((row) => row.id);
}

type OrderContextRow = {
  id: string;
  orderCode: string;
  externalCustomerId: number | null;
  externalSellerId: number | null;
  externalSalesOrderId: number | null;
  customerName: string | null;
  sellerName: string | null;
  currentAmount: number;
  nfeExternalIds: number[];
};

type LoadOrderContextDb = Pick<PrismaClient, "salesOrder">;

async function loadOrderContextRows(
  db: LoadOrderContextDb,
  orderIds: string[]
): Promise<OrderContextRow[]> {
  if (orderIds.length === 0) return [];

  const rows = await db.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderCode: true,
      externalCustomerId: true,
      externalSellerId: true,
      externalSalesOrderId: true,
      nomusSellerName: true,
      Customer: { select: { companyName: true, tradeName: true } },
      nfeLinks: { select: { nfeExternalId: true } },
      commissionOrderSnapshots: {
        where: { status: "ACTIVE" },
        select: { totalFinalCommissionAmount: true, canonicalSellerName: true },
      },
    },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  return orderIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row != null)
    .map((row) => ({
      id: row.id,
      orderCode: row.orderCode,
      externalCustomerId: row.externalCustomerId,
      externalSellerId: row.externalSellerId,
      externalSalesOrderId: row.externalSalesOrderId,
      customerName: row.Customer?.tradeName ?? row.Customer?.companyName ?? null,
      sellerName: row.nomusSellerName ?? row.commissionOrderSnapshots[0]?.canonicalSellerName ?? null,
      currentAmount: roundCommissionMoney(
        row.commissionOrderSnapshots.reduce(
          (sum, snapshot) => sum + decimalToNumber(snapshot.totalFinalCommissionAmount),
          0
        )
      ),
      nfeExternalIds: row.nfeLinks.map((link) => link.nfeExternalId),
    }));
}

type LifecycleSignals = {
  settledOrderIds: Set<string>;
  closedLedgerOrderIds: Set<string>;
  paidRecordOrderIds: Set<string>;
};

type LoadLifecycleSignalsDb = Pick<
  PrismaClient,
  | "nomusAccountsReceivable"
  | "nomusReceivableReceipt"
  | "commissionReceiptLedgerLine"
  | "commissionRecord"
>;

/** Títulos das NFs informadas que já tiveram recebimento real OU baixa. */
async function loadReceivablesWithFinancialMovement(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusReceivableReceipt">,
  nfeIds: number[]
): Promise<Array<{ sourceInvoiceId: number | null }>> {
  const receivables = await db.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: { in: nfeIds } },
    select: { externalId: true, sourceInvoiceId: true, settlementDate: true },
  });
  if (receivables.length === 0) return [];

  const receiptRows = await db.nomusReceivableReceipt.findMany({
    where: { receivableExternalId: { in: receivables.map((row) => row.externalId) } },
    select: { receivableExternalId: true },
    distinct: ["receivableExternalId"],
  });
  const withReceipt = new Set(receiptRows.map((row) => row.receivableExternalId));

  return receivables
    .filter((row) => row.settlementDate != null || withReceipt.has(row.externalId))
    .map((row) => ({ sourceInvoiceId: row.sourceInvoiceId }));
}

/**
 * Sinais oficiais de ciclo de vida: recebível com movimento financeiro (recebimento
 * real OU baixa), lançado no ledger de fechamento por recebimento (closingId) ou já
 * com CommissionRecord pago (PAID_PARTIAL/TOTAL).
 *
 * Aqui o sinal é BOOLEANO ("houve movimento"), não de competência mensal — por isso
 * a baixa continua contando: um título recebido sem baixa passou a contar também.
 */
async function loadLifecycleSignals(
  db: LoadLifecycleSignalsDb,
  orders: OrderContextRow[]
): Promise<LifecycleSignals> {
  const allNfeIds = [...new Set(orders.flatMap((order) => order.nfeExternalIds))];
  const externalOrderIds = [
    ...new Set(
      orders
        .map((order) => order.externalSalesOrderId)
        .filter((value): value is number => value != null)
    ),
  ];

  const [settledReceivables, ledgerLines, paidRecords] = await Promise.all([
    allNfeIds.length > 0
      ? loadReceivablesWithFinancialMovement(db, allNfeIds)
      : Promise.resolve([]),
    externalOrderIds.length > 0
      ? db.commissionReceiptLedgerLine.findMany({
          where: { nomusOrderId: { in: externalOrderIds }, closingId: { not: null } },
          select: { nomusOrderId: true },
        })
      : Promise.resolve([]),
    externalOrderIds.length > 0
      ? db.commissionRecord.findMany({
          where: {
            nomusOrderId: { in: externalOrderIds },
            status: { in: [...REPROCESS_PAID_RECORD_STATUSES] },
          },
          select: { nomusOrderId: true },
        })
      : Promise.resolve([]),
  ]);

  const settledNfeIds = new Set(
    settledReceivables.map((row) => row.sourceInvoiceId).filter((v): v is number => v != null)
  );
  const closedLedgerExternalIds = new Set(
    ledgerLines.map((row) => row.nomusOrderId).filter((v): v is number => v != null)
  );
  const paidExternalIds = new Set(
    paidRecords.map((row) => row.nomusOrderId).filter((v): v is number => v != null)
  );

  const settledOrderIds = new Set<string>();
  const closedLedgerOrderIds = new Set<string>();
  const paidRecordOrderIds = new Set<string>();

  for (const order of orders) {
    if (order.nfeExternalIds.some((id) => settledNfeIds.has(id))) {
      settledOrderIds.add(order.id);
    }
    if (order.externalSalesOrderId != null && closedLedgerExternalIds.has(order.externalSalesOrderId)) {
      closedLedgerOrderIds.add(order.id);
    }
    if (order.externalSalesOrderId != null && paidExternalIds.has(order.externalSalesOrderId)) {
      paidRecordOrderIds.add(order.id);
    }
  }

  return { settledOrderIds, closedLedgerOrderIds, paidRecordOrderIds };
}

type EvaluateRowDb = Pick<PrismaClient, "commissionOrderSnapshot" | "$transaction">;

async function evaluateReprocessRow(
  db: EvaluateRowDb,
  order: OrderContextRow,
  signals: LifecycleSignals,
  filters: CommissionReprocessFilters
): Promise<CommissionReprocessDiffRow> {
  const lifecycle = classifyCommissionReprocessLifecycle({
    hasNfe: order.nfeExternalIds.length > 0,
    hasSettledReceivable: signals.settledOrderIds.has(order.id),
    inClosedLedger: signals.closedLedgerOrderIds.has(order.id),
    paidRecord: signals.paidRecordOrderIds.has(order.id),
  });

  const base = {
    salesOrderId: order.id,
    orderCode: order.orderCode,
    customerName: order.customerName,
    customerExternalId: order.externalCustomerId,
    sellerName: order.sellerName,
    sellerExternalId: order.externalSellerId,
    lifecycle,
    currentAmount: order.currentAmount,
  };

  try {
    const materialized = await materializeCommissionForSalesOrder(db as unknown as PrismaClient, {
      salesOrderId: order.id,
      dryRun: true,
    });
    const recalculatedAmount = roundCommissionMoney(materialized.preview.totalFinalCommissionAmount);
    const difference = buildCommissionReprocessDiff(order.currentAmount, recalculatedAmount);
    const decision = resolveReprocessRowDecision({
      lifecycle,
      difference,
      includeConfirmedNotPaid: filters.includeConfirmedNotPaid,
      includeReleasedNotPaid: filters.includeReleasedNotPaid,
      includePaid: filters.includePaid,
    });

    return {
      ...base,
      recalculatedAmount,
      difference,
      changed: decision.changed,
      blocked: decision.blocked,
      blockReason: decision.blockReason,
      blockMessage: decision.blockMessage,
      action: decision.action,
      snapshotAction: materialized.action,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido ao recalcular pedido.";
    const decision = resolveReprocessRowDecision({
      lifecycle,
      difference: 0,
      includeConfirmedNotPaid: filters.includeConfirmedNotPaid,
      includeReleasedNotPaid: filters.includeReleasedNotPaid,
      includePaid: filters.includePaid,
      error: message,
    });

    return {
      ...base,
      recalculatedAmount: order.currentAmount,
      difference: 0,
      changed: false,
      blocked: decision.blocked,
      blockReason: decision.blockReason,
      blockMessage: decision.blockMessage,
      action: decision.action,
      snapshotAction: null,
      error: message,
    };
  }
}

type ComputeRowsDb = FindAffectedOrdersDb &
  LoadOrderContextDb &
  LoadLifecycleSignalsDb &
  EvaluateRowDb;

async function computeReprocessRows(
  db: ComputeRowsDb,
  filters: CommissionReprocessFilters
): Promise<CommissionReprocessDiffRow[]> {
  const orderIds = await findAffectedCommissionSalesOrderIds(db, filters);
  const orders = await loadOrderContextRows(db, orderIds);
  const signals = await loadLifecycleSignals(db, orders);

  const rows: CommissionReprocessDiffRow[] = [];
  for (const order of orders) {
    rows.push(await evaluateReprocessRow(db, order, signals, filters));
  }

  return rows.filter((row) => row.action === "error" || filters.statuses.includes(row.lifecycle));
}

type ReprocessLockValue = { lockedAt: string | null; lockedByUserId?: string | null };
type LockDb = Pick<PrismaClient, "commissionSettings" | "commissionCalculationRun">;

async function assertReprocessNotLocked(db: LockDb): Promise<void> {
  const runningFullRecalc = await db.commissionCalculationRun.findFirst({
    where: { mode: "FULL_RECALC", status: "RUNNING" },
    select: { id: true },
  });
  if (runningFullRecalc) {
    throw new CommissionReprocessError(
      "REPROCESS_LOCKED",
      409,
      "Já existe um reprocessamento de comissões em andamento. Aguarde ou tente mais tarde."
    );
  }

  const lockSetting = await db.commissionSettings.findUnique({
    where: { key: COMMISSION_REPROCESS_LOCK_KEY },
    select: { valueJson: true },
  });
  const lockValue = (lockSetting?.valueJson ?? null) as ReprocessLockValue | null;
  if (lockValue?.lockedAt) {
    const lockedAtMs = new Date(lockValue.lockedAt).getTime();
    if (Number.isFinite(lockedAtMs) && Date.now() - lockedAtMs < REPROCESS_LOCK_TTL_MS) {
      throw new CommissionReprocessError(
        "REPROCESS_LOCKED",
        409,
        "Já existe um reprocessamento de comissões em andamento. Aguarde ou tente mais tarde."
      );
    }
  }
}

async function acquireReprocessLock(db: LockDb, userId: string): Promise<void> {
  await assertReprocessNotLocked(db);
  const value: ReprocessLockValue = { lockedAt: new Date().toISOString(), lockedByUserId: userId };
  await db.commissionSettings.upsert({
    where: { key: COMMISSION_REPROCESS_LOCK_KEY },
    create: { key: COMMISSION_REPROCESS_LOCK_KEY, valueJson: value as Prisma.InputJsonValue },
    update: { valueJson: value as Prisma.InputJsonValue },
  });
}

async function releaseReprocessLock(db: LockDb): Promise<void> {
  const value: ReprocessLockValue = { lockedAt: null };
  await db.commissionSettings.upsert({
    where: { key: COMMISSION_REPROCESS_LOCK_KEY },
    create: { key: COMMISSION_REPROCESS_LOCK_KEY, valueJson: value as Prisma.InputJsonValue },
    update: { valueJson: value as Prisma.InputJsonValue },
  });
}

async function withReprocessLock<T>(db: LockDb, userId: string, fn: () => Promise<T>): Promise<T> {
  await acquireReprocessLock(db, userId);
  try {
    return await fn();
  } finally {
    await releaseReprocessLock(db);
  }
}

type PreviewDb = ComputeRowsDb & LockDb & Pick<PrismaClient, "commissionCalculationRun">;

/**
 * Gera prévia (dry-run) do reprocessamento: recalcula via motor oficial sem persistir snapshots,
 * compara com o valor materializado ativo e grava CommissionCalculationRun (kind PREVIEW) para
 * auditoria e para validar o runToken usado no apply.
 */
export async function previewCommissionReprocess(
  db: PreviewDb,
  input: CommissionReprocessRunInput
): Promise<CommissionReprocessPreviewResult> {
  const permCheck = assertCanPreviewCommissionReprocess({
    role: input.userRole,
    permissions: input.permissions,
  });
  if (!permCheck.ok) {
    throw new CommissionReprocessError("FORBIDDEN", permCheck.status, permCheck.message);
  }

  const filters = normalizeCommissionReprocessFilters(input.filters);
  await assertReprocessNotLocked(db);

  const rows = await computeReprocessRows(db, filters);
  const summary = aggregateCommissionReprocessSummary(rows);
  const grouped = groupReprocessAffected(rows);
  const filtersHash = hashCommissionReprocessFilters(filters);

  const run = await db.commissionCalculationRun.create({
    data: {
      periodStart: resolvePeriodBound(filters.from, filters.to, "start"),
      periodEnd: resolvePeriodBound(filters.from, filters.to, "end"),
      mode: "FULL_RECALC",
      status: "SUCCESS",
      ordersEvaluated: rows.length,
      finishedAt: new Date(),
      summaryJson: {
        kind: COMMISSION_REPROCESS_PREVIEW_KIND,
        engine: COMMISSION_REPROCESS_ENGINE,
        filters,
        filtersHash,
        summary,
        requestedByUserId: input.userId,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return {
    mode: "preview",
    engine: COMMISSION_REPROCESS_ENGINE,
    filters,
    filtersHash,
    summary,
    ...grouped,
    blockedRows: rows.filter((row) => row.blocked),
    changedRows: rows.filter((row) => row.changed),
    errors: rows
      .filter((row) => row.action === "error")
      .map((row) => ({ salesOrderId: row.salesOrderId, message: row.error ?? "Erro desconhecido." })),
    runToken: run.id,
    auditId: run.id,
  };
}

type ApplyDb = ComputeRowsDb & LockDb & Pick<PrismaClient, "commissionCalculationRun">;

/**
 * Aplica o reprocessamento: valida runToken/filtersHash contra a prévia, exige ADMIN/SUPER_ADMIN
 * e motivo (>= 3 caracteres), e rematerializa + reconstrói o schedule apenas para as linhas com
 * action "recalculate" (nunca para linhas bloqueadas/pagas).
 */
export async function applyCommissionReprocess(
  db: ApplyDb,
  input: CommissionReprocessApplyInput
): Promise<CommissionReprocessApplyResult> {
  const permCheck = assertCanReprocessCommission({
    role: input.userRole,
    permissions: input.permissions,
  });
  if (!permCheck.ok) {
    throw new CommissionReprocessError("FORBIDDEN", permCheck.status, permCheck.message);
  }

  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) {
    throw new CommissionReprocessError(
      "INVALID_REASON",
      400,
      "Informe o motivo do reprocessamento (mínimo 3 caracteres)."
    );
  }

  if (!input.runToken) {
    throw new CommissionReprocessError(
      "RUN_TOKEN_REQUIRED",
      400,
      "Gere uma prévia antes de aplicar o reprocessamento."
    );
  }

  const filters = normalizeCommissionReprocessFilters(input.filters);
  const filtersHash = hashCommissionReprocessFilters(filters);

  const previewRun = await db.commissionCalculationRun.findUnique({ where: { id: input.runToken } });
  if (!previewRun || previewRun.status !== "SUCCESS") {
    throw new CommissionReprocessError(
      "RUN_TOKEN_INVALID",
      404,
      "Prévia de reprocessamento não encontrada ou inválida."
    );
  }
  const previewSummary = previewRun.summaryJson as { filtersHash?: string; kind?: string } | null;
  if (!previewSummary || previewSummary.kind !== COMMISSION_REPROCESS_PREVIEW_KIND) {
    throw new CommissionReprocessError("RUN_TOKEN_INVALID", 404, "Token de reprocessamento inválido.");
  }
  if (previewSummary.filtersHash !== filtersHash) {
    throw new CommissionReprocessError(
      "RUN_TOKEN_MISMATCH",
      409,
      "runToken não corresponde a uma prévia de reprocessamento com os mesmos filtros."
    );
  }

  return withReprocessLock(db, input.userId, async () => {
    const rows = await computeReprocessRows(db, filters);

    const applyRun = await db.commissionCalculationRun.create({
      data: {
        periodStart: resolvePeriodBound(filters.from, filters.to, "start"),
        periodEnd: resolvePeriodBound(filters.from, filters.to, "end"),
        mode: "FULL_RECALC",
        status: "RUNNING",
        ordersEvaluated: rows.length,
        summaryJson: {
          kind: COMMISSION_REPROCESS_APPLY_KIND,
          engine: COMMISSION_REPROCESS_ENGINE,
          filters,
          filtersHash,
          reason,
          requestedByUserId: input.userId,
          previewRunId: previewRun.id,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    let commissionsUpdated = 0;
    let errorsCount = 0;
    const appliedRows: CommissionReprocessDiffRow[] = [];

    for (const row of rows) {
      if (row.action !== "recalculate") {
        appliedRows.push(row);
        continue;
      }

      try {
        const materialized = await materializeCommissionForSalesOrder(db as unknown as PrismaClient, {
          salesOrderId: row.salesOrderId,
          dryRun: false,
        });

        if (materialized.action !== "unchanged") {
          commissionsUpdated += 1;
          await rebuildCommissionReceivableSchedule(db as unknown as PrismaClient, {
            salesOrderId: row.salesOrderId,
            ...(materialized.preview.nfeId != null ? { nfeId: materialized.preview.nfeId } : {}),
            dryRun: false,
          });
        }

        appliedRows.push({ ...row, snapshotAction: materialized.action });
      } catch (err) {
        errorsCount += 1;
        const message = err instanceof Error ? err.message : "Erro ao reprocessar pedido.";
        appliedRows.push({
          ...row,
          changed: false,
          action: "error",
          blocked: true,
          blockReason: "ERROR",
          blockMessage: message,
          error: message,
        });
      }
    }

    const summary = aggregateCommissionReprocessSummary(appliedRows);
    const finalStatus = errorsCount > 0 && commissionsUpdated === 0 ? "FAILED" : "SUCCESS";

    const finishedRun = await db.commissionCalculationRun.update({
      where: { id: applyRun.id },
      data: {
        status: finalStatus,
        commissionsUpdated,
        errorsCount,
        finishedAt: new Date(),
        summaryJson: {
          kind: COMMISSION_REPROCESS_APPLY_KIND,
          engine: COMMISSION_REPROCESS_ENGINE,
          filters,
          filtersHash,
          reason,
          requestedByUserId: input.userId,
          previewRunId: previewRun.id,
          summary,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return {
      mode: "apply",
      engine: COMMISSION_REPROCESS_ENGINE,
      runId: finishedRun.id,
      filters,
      filtersHash,
      summary,
      affectedRows: appliedRows.filter((row) => row.changed || row.action === "recalculate"),
      blockedRows: appliedRows.filter((row) => row.blocked),
      errors: appliedRows
        .filter((row) => row.action === "error")
        .map((row) => ({ salesOrderId: row.salesOrderId, message: row.error ?? "Erro desconhecido." })),
      auditId: finishedRun.id,
    };
  });
}
