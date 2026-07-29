/**
 * Agregações eficientes para relatórios da Tesouraria.
 * Preferência: SUM/COUNT/groupBy no PostgreSQL; memória para testes.
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryExceptionSeverity,
  TreasuryProjectionLayer,
  TreasuryReportKey,
} from "../contracts/treasuryEnums.js";
import type { TreasuryReportRowDto } from "../contracts/treasuryDto.js";
import type { TreasuryReportBucketInput } from "../domain/treasuryReportRules.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { TREASURY_DEFAULT_COMPANY_CODE } from "../domain/treasuryProjectionRecalcAfterNomusSync.js";
import { bindTreasuryOptionalUuidAccountFilter } from "../treasuryPrismaFilters.js";

export type TreasuryReportFactsQuery = {
  reportKey: TreasuryReportKey;
  from: TreasuryCivilDate;
  to: TreasuryCivilDate;
  accountIds: string[];
  scenario: TreasuryProjectionLayer;
  companyCode: string;
  page: number;
  pageSize: number;
  status: string | null;
  severity: TreasuryExceptionSeverity | null;
  search: string | null;
};

export type TreasuryReportFacts = {
  buckets: TreasuryReportBucketInput[];
  rows: TreasuryReportRowDto[];
  totalRows: number;
  totalsAmountOverride: string | null;
  totalsCountOverride: number | null;
  extras: Record<string, string | number | boolean | null>;
  paginate: boolean;
};

export type TreasuryReportRepository = {
  loadFacts(query: TreasuryReportFactsQuery): Promise<TreasuryReportFacts>;
};

function civilRange(from: string, to: string): { gte: Date; lt: Date } {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const gte = new Date(Date.UTC(fy, fm - 1, fd));
  const lt = new Date(Date.UTC(ty, tm - 1, td + 1));
  return { gte, lt };
}

function money(
  value: { toFixed(digits: number): string } | string | number | null | undefined
): TreasuryMoneyString {
  if (value == null) return "0.00";
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

function emptyFacts(partial?: Partial<TreasuryReportFacts>): TreasuryReportFacts {
  return {
    buckets: [],
    rows: [],
    totalRows: 0,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: {},
    paginate: true,
    ...partial,
  };
}

function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function createTreasuryReportRepository(
  prisma: PrismaClient
): TreasuryReportRepository {
  return {
    async loadFacts(query) {
      switch (query.reportKey) {
        case "daily-position":
          return loadDailyPosition(prisma, query);
        case "cash-bridge":
          return loadCashBridge(prisma, query);
        case "planned-vs-actual":
          return loadPlannedVsActual(prisma, query);
        case "delinquency":
          return loadDelinquency(prisma, query);
        case "promises":
          return loadPromises(prisma, query);
        case "predictability":
          return loadPredictability(prisma, query);
        case "position-by-account":
          return loadPositionByAccount(prisma, query);
        case "exceptions":
          return loadExceptions(prisma, query);
        case "reconciliations":
          return loadReconciliations(prisma, query);
        case "projection-by-scenario":
          return loadProjectionByScenario(prisma, query);
        default:
          return emptyFacts();
      }
    },
  };
}

async function loadDailyPosition(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const accountIds = query.accountIds;
  if (!accountIds.length) return emptyFacts({ paginate: false });

  const snapshots = await prisma.treasuryBalanceSnapshot.findMany({
    where: { accountId: { in: accountIds } },
    orderBy: [{ accountId: "asc" }, { referenceAt: "desc" }],
    distinct: ["accountId"],
    select: {
      accountId: true,
      availableBalance: true,
      blockedBalance: true,
      investmentsBalance: true,
      account: { select: { code: true, name: true } },
    },
  });

  let observed: TreasuryMoneyString = "0.00";
  let blocked: TreasuryMoneyString = "0.00";
  let investments: TreasuryMoneyString = "0.00";
  const rows: TreasuryReportRowDto[] = [];
  for (const s of snapshots) {
    const avail = money(s.availableBalance);
    observed = addTreasuryMoney(observed, avail);
    blocked = addTreasuryMoney(blocked, money(s.blockedBalance));
    investments = addTreasuryMoney(investments, money(s.investmentsBalance));
    rows.push({
      id: s.accountId,
      label: `${s.account.code} — ${s.account.name}`,
      amount: avail,
      accountId: s.accountId,
      meta: {
        blocked: money(s.blockedBalance),
        investments: money(s.investmentsBalance),
      },
    });
  }

  // Calculado = observado + net ledger ACTIVE (não inventa igualdade).
  const snapshotAccountIds = snapshots.map((s) => s.accountId);
  let ledgerNet: TreasuryMoneyString = "0.00";
  let ledgerCount = 0;
  if (snapshotAccountIds.length) {
    const ledgerRows = await prisma.treasuryLedgerEntry.findMany({
      where: {
        accountId: { in: snapshotAccountIds },
        status: "ACTIVE",
        civilDate: {
          lte: new Date(
            Date.UTC(
              Number(query.to.slice(0, 4)),
              Number(query.to.slice(5, 7)) - 1,
              Number(query.to.slice(8, 10))
            )
          ),
        },
      },
      select: { amount: true, direction: true },
    });
    ledgerCount = ledgerRows.length;
    for (const row of ledgerRows) {
      const amt = money(row.amount);
      ledgerNet =
        row.direction === "CREDIT"
          ? addTreasuryMoney(ledgerNet, amt)
          : subtractTreasuryMoney(ledgerNet, amt);
    }
  }
  const calculated = addTreasuryMoney(observed, ledgerNet);

  // Conciliado = soma de ledgerBalance OFX persistido (sem inventar = observado).
  let reconciled: TreasuryMoneyString = "0.00";
  let reconciledCount = 0;
  if (snapshotAccountIds.length) {
    const batches = await prisma.treasuryBankImportBatch.findMany({
      where: {
        accountId: { in: snapshotAccountIds },
        status: "PROCESSED",
      },
      orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
      select: { accountId: true, summaryJson: true },
    });
    const seen = new Set<string>();
    for (const batch of batches) {
      if (seen.has(batch.accountId)) continue;
      seen.add(batch.accountId);
      const summary =
        batch.summaryJson && typeof batch.summaryJson === "object"
          ? (batch.summaryJson as Record<string, unknown>)
          : null;
      const amountRaw = summary?.ledgerBalanceAmount;
      if (typeof amountRaw !== "string" || !amountRaw.trim()) continue;
      try {
        reconciled = addTreasuryMoney(reconciled, money(amountRaw));
        reconciledCount += 1;
      } catch {
        // ignora lote com saldo inválido
      }
    }
  }

  const divergence = subtractTreasuryMoney(observed, calculated);

  return {
    buckets: [
      { key: "observed", label: "Saldo observado", amount: observed, count: rows.length },
      {
        key: "calculated",
        label: "Saldo calculado",
        amount: calculated,
        count: rows.length,
      },
      {
        key: "reconciled",
        label: "Saldo conciliado",
        amount: reconciled,
        count: reconciledCount,
      },
      {
        key: "divergence",
        label: "Divergência (observado − calculado)",
        amount: divergence,
        count: compareMoneyNonZero(divergence) ? 1 : 0,
      },
      { key: "blocked", label: "Bloqueado", amount: blocked, count: rows.length },
      { key: "investments", label: "Aplicações", amount: investments, count: rows.length },
    ],
    rows: pageSlice(rows, query.page, query.pageSize),
    totalRows: rows.length,
    totalsAmountOverride: observed,
    totalsCountOverride: rows.length,
    extras: {
      layerReport: true,
      ledgerMovementCount: ledgerCount,
      reconciledAccountsWithOfxLedger: reconciledCount,
      inventsReconciledEquality: false,
    },
    paginate: true,
  };
}

function compareMoneyNonZero(value: string): boolean {
  return normalizeTreasuryMoneyString(value) !== "0.00";
}

async function loadCashBridge(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const { gte, lt } = civilRange(query.from, query.to);
  const closings = await prisma.treasuryDailyClosing.findMany({
    where: {
      companyCode: query.companyCode,
      status: "CLOSED",
      civilDate: { gte, lt },
    },
    orderBy: [{ civilDate: "asc" }, { version: "desc" }],
    distinct: ["civilDate"],
    select: {
      id: true,
      civilDate: true,
      openingBalance: true,
      realizedInflows: true,
      realizedOutflows: true,
      closingBalance: true,
      observedBalance: true,
    },
  });

  let opening: TreasuryMoneyString = "0.00";
  let inflows: TreasuryMoneyString = "0.00";
  let outflows: TreasuryMoneyString = "0.00";
  let closing: TreasuryMoneyString = "0.00";
  const rows: TreasuryReportRowDto[] = closings.map((c) => {
    const o = money(c.openingBalance);
    const i = money(c.realizedInflows);
    const out = money(c.realizedOutflows);
    const cl = money(c.closingBalance);
    if (opening === "0.00") opening = o;
    inflows = addTreasuryMoney(inflows, i);
    outflows = addTreasuryMoney(outflows, out);
    closing = cl;
    const civil = c.civilDate.toISOString().slice(0, 10) as TreasuryCivilDate;
    return {
      id: c.id,
      label: `Fechamento ${civil}`,
      amount: cl,
      civilDate: civil,
      meta: { opening: o, inflows: i, outflows: out },
    };
  });

  if (!rows.length) {
    // Sem fechamentos: ponte a partir de movimentos bancários do período
    const movements = await prisma.treasuryBankMovement.groupBy({
      by: ["direction"],
      where: {
        accountId: { in: query.accountIds },
        postedCivilDate: { gte, lt },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    for (const m of movements) {
      const amt = money(m._sum.amount);
      if (m.direction === "CREDIT") inflows = addTreasuryMoney(inflows, amt);
      else outflows = addTreasuryMoney(outflows, amt);
    }
  }

  const transfersNet = "0.00";
  const computedClosing = addTreasuryMoney(
    subtractTreasuryMoney(addTreasuryMoney(opening, inflows), outflows),
    transfersNet
  );

  return {
    buckets: [
      { key: "opening", label: "Saldo inicial", amount: opening, count: 1 },
      { key: "inflows", label: "Entradas", amount: inflows, count: 1 },
      { key: "outflows", label: "Saídas", amount: outflows, count: 1 },
      { key: "transfers", label: "Transferências (líquido)", amount: transfersNet, count: 1 },
      {
        key: "closing",
        label: "Saldo final",
        amount: rows.length ? closing : computedClosing,
        count: 1,
      },
    ],
    rows: pageSlice(rows, query.page, query.pageSize),
    totalRows: rows.length,
    totalsAmountOverride: rows.length ? closing : computedClosing,
    totalsCountOverride: rows.length,
    extras: { computedClosing, bridgeDays: rows.length },
    paginate: true,
  };
}

async function loadPlannedVsActual(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const { gte, lt } = civilRange(query.from, query.to);
  const { filterByAccounts, accountIdList } =
    bindTreasuryOptionalUuidAccountFilter(query.accountIds);
  const scenario = query.scenario;

  type Agg = {
    planned_amount: unknown;
    planned_count: unknown;
    realized_amount: unknown;
    realized_count: unknown;
  };

  const ar = (
    await prisma.$queryRaw<Agg[]>`
      WITH planning AS (
        SELECT
          ar."balanceReceivable" AS open_balance,
          ar."amountReceived" AS realized_amount,
          ar."settlementDate" AS settlement_date,
          CASE
            WHEN ${scenario}::text = 'CONTRACTUAL' THEN ar."dueDate"
            WHEN ${scenario}::text = 'PROBABLE' THEN COALESCE(c."expectedDate", ar."dueDate")
            ELSE COALESCE(c."confirmedDate", c."expectedDate", ar."dueDate")
          END AS planning_date
        FROM "NomusAccountsReceivable" ar
        LEFT JOIN "TreasuryTitleOperationalComplement" c
          ON c."titleType" = 'RECEIVABLE'
         AND c."officialTitleId" = ar.id
         AND c."cancelledAt" IS NULL
         AND c.status = 'ACTIVE'
        WHERE ar."sourcePresenceStatus" <> 'MISSING_CONFIRMED'
          AND (
            NOT ${filterByAccounts}
            OR c."plannedAccountId" = ANY(${accountIdList}::uuid[])
          )
      )
      SELECT
        COALESCE(SUM(open_balance) FILTER (
          WHERE planning_date >= ${gte} AND planning_date < ${lt} AND open_balance > 0
        ), 0) AS planned_amount,
        COUNT(*) FILTER (
          WHERE planning_date >= ${gte} AND planning_date < ${lt} AND open_balance > 0
        ) AS planned_count,
        COALESCE(SUM(realized_amount) FILTER (
          WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
        ), 0) AS realized_amount,
        COUNT(*) FILTER (
          WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
            AND COALESCE(realized_amount, 0) > 0
        ) AS realized_count
      FROM planning
    `
  )[0];

  const ap = (
    await prisma.$queryRaw<Agg[]>`
      WITH planning AS (
        SELECT
          ap."balancePayable" AS open_balance,
          COALESCE(ap."amountPaid", 0) AS realized_amount,
          COALESCE(ap."paymentDate", ap."settlementDate") AS settlement_date,
          CASE
            WHEN ${scenario}::text = 'CONTRACTUAL' THEN ap."dueDate"
            WHEN ${scenario}::text = 'PROBABLE' THEN COALESCE(c."scheduledDate", c."expectedDate", ap."scheduleDate", ap."dueDate")
            ELSE COALESCE(c."scheduledDate", c."confirmedDate", ap."scheduleDate", ap."dueDate")
          END AS planning_date
        FROM "NomusAccountsPayable" ap
        LEFT JOIN "TreasuryTitleOperationalComplement" c
          ON c."titleType" = 'PAYABLE'
         AND c."officialTitleId" = ap.id
         AND c."cancelledAt" IS NULL
         AND c.status = 'ACTIVE'
        WHERE ap."sourcePresenceStatus" <> 'MISSING_CONFIRMED'
          AND (
            NOT ${filterByAccounts}
            OR c."plannedAccountId" = ANY(${accountIdList}::uuid[])
          )
      )
      SELECT
        COALESCE(SUM(open_balance) FILTER (
          WHERE planning_date >= ${gte} AND planning_date < ${lt} AND open_balance > 0
        ), 0) AS planned_amount,
        COUNT(*) FILTER (
          WHERE planning_date >= ${gte} AND planning_date < ${lt} AND open_balance > 0
        ) AS planned_count,
        COALESCE(SUM(realized_amount) FILTER (
          WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
        ), 0) AS realized_amount,
        COUNT(*) FILTER (
          WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
            AND COALESCE(realized_amount, 0) > 0
        ) AS realized_count
      FROM planning
    `
  )[0];

  const plannedR = money(String(ar?.planned_amount ?? "0"));
  const realizedR = money(String(ar?.realized_amount ?? "0"));
  const plannedP = money(String(ap?.planned_amount ?? "0"));
  const realizedP = money(String(ap?.realized_amount ?? "0"));
  const varianceR = subtractTreasuryMoney(plannedR, realizedR);
  const varianceP = subtractTreasuryMoney(plannedP, realizedP);
  const plannedCountR = Number(ar?.planned_count ?? 0);
  const realizedCountR = Number(ar?.realized_count ?? 0);
  const plannedCountP = Number(ap?.planned_count ?? 0);
  const realizedCountP = Number(ap?.realized_count ?? 0);

  const buckets: TreasuryReportBucketInput[] = [
    { key: "plannedReceipts", label: "Recebimentos previstos", amount: plannedR, count: plannedCountR },
    { key: "realizedReceipts", label: "Recebimentos realizados", amount: realizedR, count: realizedCountR },
    { key: "varianceReceipts", label: "Variação recebimentos", amount: varianceR, count: 0 },
    { key: "plannedPayments", label: "Pagamentos previstos", amount: plannedP, count: plannedCountP },
    { key: "realizedPayments", label: "Pagamentos realizados", amount: realizedP, count: realizedCountP },
    { key: "variancePayments", label: "Variação pagamentos", amount: varianceP, count: 0 },
  ];

  const netPlanned = subtractTreasuryMoney(plannedR, plannedP);
  const netRealized = subtractTreasuryMoney(realizedR, realizedP);

  return {
    buckets,
    rows: [
      {
        id: "receipts",
        label: "Recebimentos",
        amount: plannedR,
        count: plannedCountR,
        meta: { realized: realizedR, variance: varianceR },
      },
      {
        id: "payments",
        label: "Pagamentos",
        amount: plannedP,
        count: plannedCountP,
        meta: { realized: realizedP, variance: varianceP },
      },
    ],
    totalRows: 2,
    totalsAmountOverride: netRealized,
    totalsCountOverride: plannedCountR + plannedCountP,
    extras: { netPlanned, netRealized, scenario },
    paginate: false,
  };
}

async function loadDelinquency(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const asOf = civilRange(query.to, query.to).lt;
  type AgingRow = {
    bucket: string;
    amount: unknown;
    cnt: unknown;
  };
  const rows = await prisma.$queryRaw<AgingRow[]>`
    SELECT
      CASE
        WHEN (${asOf}::date - ar."dueDate"::date) BETWEEN 1 AND 30 THEN '1-30'
        WHEN (${asOf}::date - ar."dueDate"::date) BETWEEN 31 AND 60 THEN '31-60'
        WHEN (${asOf}::date - ar."dueDate"::date) BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
      END AS bucket,
      COALESCE(SUM(ar."balanceReceivable"), 0) AS amount,
      COUNT(*)::int AS cnt
    FROM "NomusAccountsReceivable" ar
    WHERE ar."sourcePresenceStatus" <> 'MISSING_CONFIRMED'
      AND ar."balanceReceivable" > 0
      AND ar."dueDate" IS NOT NULL
      AND ar."dueDate" < ${asOf}::date
      AND (ar."settlementDate" IS NULL OR ar."settlementDate" >= ${asOf}::date)
    GROUP BY 1
    ORDER BY 1
  `;

  const labels: Record<string, string> = {
    "1-30": "1–30 dias",
    "31-60": "31–60 dias",
    "61-90": "61–90 dias",
    "90+": "Acima de 90 dias",
  };
  const order = ["1-30", "31-60", "61-90", "90+"];
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  const buckets: TreasuryReportBucketInput[] = order.map((key) => {
    const r = byBucket.get(key);
    return {
      key,
      label: labels[key] ?? key,
      amount: money(String(r?.amount ?? "0")),
      count: Number(r?.cnt ?? 0),
    };
  });

  const detail = await prisma.nomusAccountsReceivable.findMany({
    where: {
      sourcePresenceStatus: { not: "MISSING_CONFIRMED" },
      balanceReceivable: { gt: 0 },
      dueDate: { lt: asOf },
      OR: [{ settlementDate: null }, { settlementDate: { gte: asOf } }],
    },
    orderBy: [{ dueDate: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      personName: true,
      balanceReceivable: true,
      dueDate: true,
      externalId: true,
    },
  });
  const totalRows = await prisma.nomusAccountsReceivable.count({
    where: {
      sourcePresenceStatus: { not: "MISSING_CONFIRMED" },
      balanceReceivable: { gt: 0 },
      dueDate: { lt: asOf },
      OR: [{ settlementDate: null }, { settlementDate: { gte: asOf } }],
    },
  });

  return {
    buckets,
    rows: detail.map((d) => ({
      id: d.id,
      label: d.personName ?? `CR #${d.externalId}`,
      amount: money(d.balanceReceivable),
      civilDate: d.dueDate
        ? (d.dueDate.toISOString().slice(0, 10) as TreasuryCivilDate)
        : null,
      meta: { externalId: d.externalId },
    })),
    totalRows,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: { asOf: query.to },
    paginate: true,
  };
}

async function loadPromises(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const { gte, lt } = civilRange(query.from, query.to);
  const where = {
    promisedDate: { gte, lt },
    ...(query.status ? { status: query.status as never } : {}),
  };
  const grouped = await prisma.treasuryPaymentPromise.groupBy({
    by: ["status"],
    where,
    _sum: { promisedAmount: true, fulfilledAmount: true },
    _count: { _all: true },
  });
  const buckets: TreasuryReportBucketInput[] = grouped.map((g) => ({
    key: String(g.status),
    label: String(g.status),
    amount: money(g._sum.promisedAmount),
    count: g._count._all,
    meta: { fulfilled: money(g._sum.fulfilledAmount) },
  }));
  const totalRows = await prisma.treasuryPaymentPromise.count({ where });
  const list = await prisma.treasuryPaymentPromise.findMany({
    where,
    orderBy: [{ promisedDate: "asc" }, { createdAt: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      promisedAmount: true,
      fulfilledAmount: true,
      promisedDate: true,
      status: true,
      officialExternalId: true,
      contactNote: true,
    },
  });
  return {
    buckets,
    rows: list.map((p) => ({
      id: p.id,
      label: p.contactNote ?? `Promessa CR #${p.officialExternalId}`,
      amount: money(p.promisedAmount),
      civilDate: p.promisedDate.toISOString().slice(0, 10) as TreasuryCivilDate,
      status: String(p.status),
      meta: { fulfilled: money(p.fulfilledAmount) },
    })),
    totalRows,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: {},
    paginate: true,
  };
}

async function loadPredictability(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const { gte, lt } = civilRange(query.from, query.to);
  const grouped = await prisma.treasuryPaymentPromise.groupBy({
    by: ["status"],
    where: { promisedDate: { gte, lt } },
    _sum: { promisedAmount: true, fulfilledAmount: true },
    _count: { _all: true },
  });
  let kept = 0;
  let broken = 0;
  let partial = 0;
  let active = 0;
  let keptAmt: TreasuryMoneyString = "0.00";
  let brokenAmt: TreasuryMoneyString = "0.00";
  let partialAmt: TreasuryMoneyString = "0.00";
  let activeAmt: TreasuryMoneyString = "0.00";
  let fulfilledTotal: TreasuryMoneyString = "0.00";
  let promisedTotal: TreasuryMoneyString = "0.00";
  for (const g of grouped) {
    const amt = money(g._sum.promisedAmount);
    const ful = money(g._sum.fulfilledAmount);
    promisedTotal = addTreasuryMoney(promisedTotal, amt);
    fulfilledTotal = addTreasuryMoney(fulfilledTotal, ful);
    const st = String(g.status);
    if (st === "FULFILLED" || st === "PARTIALLY_FULFILLED") {
      if (st === "FULFILLED") {
        kept += g._count._all;
        keptAmt = addTreasuryMoney(keptAmt, amt);
      } else {
        partial += g._count._all;
        partialAmt = addTreasuryMoney(partialAmt, amt);
      }
    } else if (st === "BROKEN" || st === "EXPIRED" || st === "CANCELLED") {
      broken += g._count._all;
      brokenAmt = addTreasuryMoney(brokenAmt, amt);
    } else {
      active += g._count._all;
      activeAmt = addTreasuryMoney(activeAmt, amt);
    }
  }
  const buckets: TreasuryReportBucketInput[] = [
    { key: "kept", label: "Cumpridas", amount: keptAmt, count: kept },
    { key: "partial", label: "Parciais", amount: partialAmt, count: partial },
    { key: "broken", label: "Quebradas/expiradas", amount: brokenAmt, count: broken },
    { key: "active", label: "Ativas no período", amount: activeAmt, count: active },
  ];
  const rateDenom = kept + partial + broken;
  const fulfillmentRate =
    rateDenom === 0 ? null : ((kept + partial * 0.5) / rateDenom).toFixed(4);

  return {
    buckets,
    rows: buckets.map((b) => ({
      id: b.key,
      label: b.label,
      amount: normalizeTreasuryMoneyString(b.amount),
      count: b.count,
    })),
    totalRows: buckets.length,
    totalsAmountOverride: promisedTotal,
    totalsCountOverride: kept + partial + broken + active,
    extras: { fulfilledTotal, promisedTotal, fulfillmentRate },
    paginate: false,
  };
}

async function loadPositionByAccount(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  if (!query.accountIds.length) return emptyFacts({ paginate: false });
  const snapshots = await prisma.treasuryBalanceSnapshot.findMany({
    where: { accountId: { in: query.accountIds } },
    orderBy: [{ accountId: "asc" }, { referenceAt: "desc" }],
    distinct: ["accountId"],
    select: {
      accountId: true,
      availableBalance: true,
      account: {
        select: {
          code: true,
          name: true,
          includeInConsolidated: true,
          isActive: true,
        },
      },
    },
  });
  const buckets: TreasuryReportBucketInput[] = snapshots.map((s) => ({
    key: s.accountId,
    label: `${s.account.code} — ${s.account.name}`,
    amount: money(s.availableBalance),
    count: 1,
    meta: {
      includeInConsolidated: s.account.includeInConsolidated,
      isActive: s.account.isActive,
    },
  }));
  const rows: TreasuryReportRowDto[] = buckets.map((b) => ({
    id: b.key,
    label: b.label,
    amount: normalizeTreasuryMoneyString(b.amount),
    accountId: b.key,
    count: 1,
    meta: b.meta,
  }));
  return {
    buckets,
    rows: pageSlice(rows, query.page, query.pageSize),
    totalRows: rows.length,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: {},
    paginate: true,
  };
}

async function loadExceptions(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const { gte, lt } = civilRange(query.from, query.to);
  const where = {
    companyCode: query.companyCode,
    detectedAt: { gte, lt },
    ...(query.accountIds.length
      ? { OR: [{ accountId: { in: query.accountIds } }, { accountId: null }] }
      : {}),
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" as const } },
            {
              description: {
                contains: query.search,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const grouped = await prisma.treasuryException.groupBy({
    by: ["severity"],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });
  const buckets: TreasuryReportBucketInput[] = grouped.map((g) => ({
    key: String(g.severity),
    label: String(g.severity),
    amount: money(g._sum.amount),
    count: g._count._all,
  }));
  const totalRows = await prisma.treasuryException.count({ where });
  const list = await prisma.treasuryException.findMany({
    where,
    orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      title: true,
      amount: true,
      status: true,
      severity: true,
      accountId: true,
      detectedAt: true,
      type: true,
    },
  });
  return {
    buckets,
    rows: list.map((e) => ({
      id: e.id,
      label: e.title,
      amount: money(e.amount),
      status: String(e.status),
      accountId: e.accountId,
      meta: { severity: String(e.severity), type: String(e.type) },
    })),
    totalRows,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: {},
    paginate: true,
  };
}

async function loadReconciliations(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const { gte, lt } = civilRange(query.from, query.to);
  const where = {
    companyCode: query.companyCode,
    matchedCivilDate: { gte, lt },
    ...(query.accountIds.length ? { accountId: { in: query.accountIds } } : {}),
    ...(query.status ? { status: query.status as never } : {}),
  };
  const grouped = await prisma.treasuryReconciliationMatch.groupBy({
    by: ["status"],
    where,
    _sum: { matchedAmount: true },
    _count: { _all: true },
  });
  const buckets: TreasuryReportBucketInput[] = grouped.map((g) => ({
    key: String(g.status),
    label: String(g.status),
    amount: money(g._sum.matchedAmount),
    count: g._count._all,
  }));
  const totalRows = await prisma.treasuryReconciliationMatch.count({ where });
  const list = await prisma.treasuryReconciliationMatch.findMany({
    where,
    orderBy: [{ matchedCivilDate: "desc" }, { createdAt: "desc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      matchedAmount: true,
      matchedCivilDate: true,
      status: true,
      accountId: true,
      justification: true,
    },
  });
  return {
    buckets,
    rows: list.map((m) => ({
      id: m.id,
      label: m.justification ?? `Conciliação ${m.id.slice(0, 8)}`,
      amount: money(m.matchedAmount),
      civilDate: m.matchedCivilDate
        .toISOString()
        .slice(0, 10) as TreasuryCivilDate,
      status: String(m.status),
      accountId: m.accountId,
    })),
    totalRows,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: {},
    paginate: true,
  };
}

async function loadProjectionByScenario(
  prisma: PrismaClient,
  query: TreasuryReportFactsQuery
): Promise<TreasuryReportFacts> {
  const scenarios: TreasuryProjectionLayer[] = [
    "CONTRACTUAL",
    "PROBABLE",
    "CONFIRMED",
    "MANUAL",
  ];
  const buckets: TreasuryReportBucketInput[] = [];
  const rows: TreasuryReportRowDto[] = [];

  for (const scenario of scenarios) {
    const run = await prisma.treasuryProjectionRun.findFirst({
      where: {
        companyCode: query.companyCode,
        scenario,
        status: "SUCCEEDED",
      },
      orderBy: [{ finishedAt: "desc" }],
      select: { id: true, scenario: true, periodTo: true, finishedAt: true },
    });
    if (!run) {
      buckets.push({
        key: scenario,
        label: scenario,
        amount: "0.00",
        count: 0,
      });
      continue;
    }
    const end = query.to;
    const [ey, em, ed] = end.split("-").map(Number);
    const endDate = new Date(Date.UTC(ey, em - 1, ed));
    const lines = await prisma.treasuryProjectionDayLine.findMany({
      where: {
        runId: run.id,
        civilDate: endDate,
        ...(query.accountIds.length
          ? { accountId: { in: query.accountIds } }
          : {}),
      },
      select: { closingBalance: true, accountId: true },
    });
    let closing: TreasuryMoneyString = "0.00";
    for (const line of lines) {
      closing = addTreasuryMoney(closing, money(line.closingBalance));
    }
    buckets.push({
      key: scenario,
      label: scenario,
      amount: closing,
      count: lines.length,
    });
    rows.push({
      id: run.id,
      label: `Projeção ${scenario}`,
      amount: closing,
      count: lines.length,
      civilDate: end,
      status: scenario,
      meta: {
        calculatedAt: (run.finishedAt ?? run.periodTo).toISOString(),
        periodTo: run.periodTo.toISOString().slice(0, 10),
      },
    });
  }

  return {
    buckets,
    rows,
    totalRows: rows.length,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: { horizonDate: query.to },
    paginate: false,
  };
}

/** Fábrica em memória para testes de consistência/serviço. */
export function createMemoryTreasuryReportRepository(
  factsByKey: Partial<Record<TreasuryReportKey, TreasuryReportFacts>>
): TreasuryReportRepository {
  return {
    async loadFacts(query) {
      return (
        factsByKey[query.reportKey] ??
        emptyFacts({
          buckets: [
            { key: "empty", label: "Vazio", amount: "0.00", count: 0 },
          ],
          paginate: false,
        })
      );
    },
  };
}

export function resolveTreasuryReportCompanyCode(
  explicit: string | null | undefined
): string {
  const fromEnv = process.env.TREASURY_COMPANY_CODE?.trim();
  return explicit?.trim() || fromEnv || TREASURY_DEFAULT_COMPANY_CODE;
}
