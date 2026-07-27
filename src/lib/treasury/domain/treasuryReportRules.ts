/**
 * Regras puras — relatórios da Tesouraria.
 * Totais devem bater com a composição (assertTreasuryReportTotalsConsistent).
 */

import type {
  TreasuryReportCompositionItemDto,
  TreasuryReportDto,
  TreasuryReportRowDto,
  TreasuryReportTotalsDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryProjectionLayer,
  TreasuryReportKey,
} from "../contracts/treasuryEnums.js";
import {
  buildTreasuryPaginationMeta,
  type TreasuryPaginationMeta,
} from "../contracts/treasuryPagination.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  treasuryMoneyFromCents,
  treasuryMoneyToCents,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export type TreasuryReportBucketInput = {
  key: string;
  label: string;
  amount: string;
  count: number;
  meta?: Record<string, string | number | boolean | null>;
};

export type TreasuryReportBuildInput = {
  reportKey: TreasuryReportKey;
  from: TreasuryCivilDate;
  to: TreasuryCivilDate;
  accountIds: string[] | null;
  authorizedAccountIds: string[];
  scenario: TreasuryProjectionLayer | null;
  filters: Record<string, string | number | boolean | null>;
  buckets: TreasuryReportBucketInput[];
  rows: TreasuryReportRowDto[];
  totalRows: number;
  page: number;
  pageSize: number;
  /** Quando false, omite paginação (relatórios só de composição). */
  paginate?: boolean;
  extras?: Record<string, string | number | boolean | null>;
  /**
   * Se informado, totals.amount usa este valor (ex.: saldo consolidado)
   * em vez da soma dos buckets (útil quando buckets são camadas, não partições).
   */
  totalsAmountOverride?: string | null;
  totalsCountOverride?: number | null;
};

function moneyOrZero(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

export function sumTreasuryReportBucketAmounts(
  buckets: readonly TreasuryReportBucketInput[]
): TreasuryMoneyString {
  return buckets.reduce(
    (acc, b) => addTreasuryMoney(acc, moneyOrZero(b.amount)),
    "0.00" as TreasuryMoneyString
  );
}

export function sumTreasuryReportBucketCounts(
  buckets: readonly TreasuryReportBucketInput[]
): number {
  return buckets.reduce((acc, b) => acc + (b.count || 0), 0);
}

export function computeTreasuryReportSharePercent(
  part: string,
  whole: string
): string | null {
  const wholeCents = treasuryMoneyToCents(moneyOrZero(whole));
  if (wholeCents === 0n) return null;
  const partCents = treasuryMoneyToCents(moneyOrZero(part));
  // percent com 2 casas: (part/whole)*100 → centésimos de percent
  const scaled = (partCents * 10000n) / wholeCents;
  const rem = (partCents * 10000n) % wholeCents;
  const absWhole = wholeCents < 0n ? -wholeCents : wholeCents;
  const adjusted =
    rem * 2n >= absWhole ? scaled + (scaled >= 0n ? 1n : -1n) : scaled;
  // adjusted está em centésimos de % (ex.: 3333 = 33.33)
  return treasuryMoneyFromCents(adjusted);
}

export function buildTreasuryReportComposition(
  buckets: readonly TreasuryReportBucketInput[],
  totalAmount: TreasuryMoneyString
): TreasuryReportCompositionItemDto[] {
  return buckets.map((b) => {
    const amount = moneyOrZero(b.amount);
    return {
      key: b.key,
      label: b.label,
      amount,
      count: b.count,
      sharePercent: computeTreasuryReportSharePercent(amount, totalAmount),
      ...(b.meta ? { meta: b.meta } : {}),
    };
  });
}

export function buildTreasuryReportDto(
  input: TreasuryReportBuildInput
): TreasuryReportDto {
  const bucketSum = sumTreasuryReportBucketAmounts(input.buckets);
  const bucketCount = sumTreasuryReportBucketCounts(input.buckets);
  const hasAmountOverride = input.totalsAmountOverride != null;
  const totalsAmount = hasAmountOverride
    ? moneyOrZero(input.totalsAmountOverride)
    : bucketSum;
  const totalsCount =
    input.totalsCountOverride != null
      ? input.totalsCountOverride
      : bucketCount;

  const composition = buildTreasuryReportComposition(
    input.buckets,
    // share relativo à soma dos buckets (partição visual)
    bucketSum === "0.00" && totalsAmount !== "0.00" ? totalsAmount : bucketSum
  );

  const totals: TreasuryReportTotalsDto = {
    amount: totalsAmount,
    count: totalsCount,
    extras: {
      bucketAmountSum: bucketSum,
      bucketCountSum: bucketCount,
      totalsAmountOverridden: hasAmountOverride,
      ...(input.extras ?? {}),
    },
  };

  const paginate = input.paginate !== false && input.totalRows > 0;
  const pagination: TreasuryPaginationMeta | null = paginate
    ? buildTreasuryPaginationMeta({
        page: input.page,
        pageSize: input.pageSize,
        totalRows: input.totalRows,
      })
    : input.paginate === false
      ? null
      : buildTreasuryPaginationMeta({
          page: input.page,
          pageSize: input.pageSize,
          totalRows: input.totalRows,
        });

  const dto: TreasuryReportDto = {
    ok: true,
    reportKey: input.reportKey,
    period: { from: input.from, to: input.to },
    accountIds: input.accountIds,
    authorizedAccountIds: input.authorizedAccountIds,
    scenario: input.scenario,
    filters: input.filters,
    totals,
    composition,
    rows: input.rows,
    pagination,
  };

  assertTreasuryReportTotalsConsistent(dto);
  return dto;
}

/**
 * Consistência: cada item da composição bate com buckets normalizados;
 * soma de amounts da composição = extras.bucketAmountSum;
 * soma de counts = extras.bucketCountSum.
 */
export function assertTreasuryReportTotalsConsistent(
  dto: TreasuryReportDto
): void {
  const bucketAmountSum = moneyOrZero(
    String(dto.totals.extras.bucketAmountSum ?? "0.00")
  );
  const bucketCountSum = Number(dto.totals.extras.bucketCountSum ?? 0);

  let amountAcc: TreasuryMoneyString = "0.00";
  let countAcc = 0;
  for (const item of dto.composition) {
    const amt = moneyOrZero(item.amount);
    amountAcc = addTreasuryMoney(amountAcc, amt);
    countAcc += item.count;
    if (item.count < 0) {
      throw new Error(`count negativo em composição ${item.key}`);
    }
  }

  if (compareTreasuryMoney(amountAcc, bucketAmountSum) !== 0) {
    throw new Error(
      `Inconsistência amount: composição=${amountAcc} bucketSum=${bucketAmountSum}`
    );
  }
  if (countAcc !== bucketCountSum) {
    throw new Error(
      `Inconsistência count: composição=${countAcc} bucketSum=${bucketCountSum}`
    );
  }

  // Relatórios particionados: totals.amount === bucketSum (sem override)
  const hasOverride =
    dto.totals.extras.totalsAmountOverridden === true ||
    dto.totals.extras.totalsAmountOverridden === "true";
  if (!hasOverride && compareTreasuryMoney(dto.totals.amount, bucketAmountSum) !== 0) {
    throw new Error(
      `Inconsistência totals.amount=${dto.totals.amount} bucketSum=${bucketAmountSum}`
    );
  }
}

/** Helpers de buckets tipados por relatório (fábricas). */

export function dailyPositionBuckets(input: {
  observed: string;
  calculated: string;
  reconciled: string;
  divergence: string;
  blocked: string;
  investments: string;
}): TreasuryReportBucketInput[] {
  return [
    { key: "observed", label: "Saldo observado", amount: input.observed, count: 1 },
    {
      key: "calculated",
      label: "Saldo calculado",
      amount: input.calculated,
      count: 1,
    },
    {
      key: "reconciled",
      label: "Saldo conciliado",
      amount: input.reconciled,
      count: 1,
    },
    {
      key: "divergence",
      label: "Divergência",
      amount: input.divergence,
      count: 1,
    },
    { key: "blocked", label: "Bloqueado", amount: input.blocked, count: 1 },
    {
      key: "investments",
      label: "Aplicações",
      amount: input.investments,
      count: 1,
    },
  ];
}

export function cashBridgeBuckets(input: {
  opening: string;
  inflows: string;
  outflows: string;
  transfers: string;
  closing: string;
}): TreasuryReportBucketInput[] {
  return [
    { key: "opening", label: "Saldo inicial", amount: input.opening, count: 1 },
    { key: "inflows", label: "Entradas", amount: input.inflows, count: 1 },
    { key: "outflows", label: "Saídas", amount: input.outflows, count: 1 },
    {
      key: "transfers",
      label: "Transferências (líquido)",
      amount: input.transfers,
      count: 1,
    },
    { key: "closing", label: "Saldo final", amount: input.closing, count: 1 },
  ];
}

export function plannedVsActualBuckets(input: {
  plannedReceipts: string;
  realizedReceipts: string;
  pendingReceipts: string;
  plannedPayments: string;
  realizedPayments: string;
  pendingPayments: string;
  plannedReceiptsCount: number;
  realizedReceiptsCount: number;
  pendingReceiptsCount: number;
  plannedPaymentsCount: number;
  realizedPaymentsCount: number;
  pendingPaymentsCount: number;
}): TreasuryReportBucketInput[] {
  return [
    {
      key: "plannedReceipts",
      label: "Recebimentos previstos",
      amount: input.plannedReceipts,
      count: input.plannedReceiptsCount,
    },
    {
      key: "realizedReceipts",
      label: "Recebimentos realizados",
      amount: input.realizedReceipts,
      count: input.realizedReceiptsCount,
    },
    {
      key: "pendingReceipts",
      label: "Recebimentos pendentes",
      amount: input.pendingReceipts,
      count: input.pendingReceiptsCount,
    },
    {
      key: "plannedPayments",
      label: "Pagamentos previstos",
      amount: input.plannedPayments,
      count: input.plannedPaymentsCount,
    },
    {
      key: "realizedPayments",
      label: "Pagamentos realizados",
      amount: input.realizedPayments,
      count: input.realizedPaymentsCount,
    },
    {
      key: "pendingPayments",
      label: "Pagamentos pendentes",
      amount: input.pendingPayments,
      count: input.pendingPaymentsCount,
    },
  ];
}

export function assertPlannedVsActualInternalConsistency(
  buckets: readonly TreasuryReportBucketInput[]
): void {
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const get = (k: string) => moneyOrZero(byKey.get(k)?.amount);
  const plannedR = get("plannedReceipts");
  const realizedR = get("realizedReceipts");
  const pendingR = get("pendingReceipts");
  const sumR = addTreasuryMoney(realizedR, pendingR);
  if (compareTreasuryMoney(plannedR, sumR) !== 0) {
    throw new Error(
      `plannedReceipts (${plannedR}) ≠ realized+pending (${sumR})`
    );
  }
  const plannedP = get("plannedPayments");
  const realizedP = get("realizedPayments");
  const pendingP = get("pendingPayments");
  const sumP = addTreasuryMoney(realizedP, pendingP);
  if (compareTreasuryMoney(plannedP, sumP) !== 0) {
    throw new Error(
      `plannedPayments (${plannedP}) ≠ realized+pending (${sumP})`
    );
  }
}
