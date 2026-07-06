/** Buckets não acumulativos do horizonte financeiro (0–60 dias a partir de hoje). */

import { diffCivilDays } from "./financeCivilDate.js";

export type FinanceHorizonBucketKey =
  | "0_7"
  | "8_15"
  | "16_30"
  | "31_45"
  | "46_60"
  | "total_60";

export type FinanceHorizonBucketDef = {
  key: Exclude<FinanceHorizonBucketKey, "total_60">;
  label: string;
  fromDay: number;
  toDay: number;
};

export const FINANCE_HORIZON_BUCKETS: readonly FinanceHorizonBucketDef[] = [
  { key: "0_7", label: "0–7 dias", fromDay: 0, toDay: 7 },
  { key: "8_15", label: "8–15 dias", fromDay: 8, toDay: 15 },
  { key: "16_30", label: "16–30 dias", fromDay: 16, toDay: 30 },
  { key: "31_45", label: "31–45 dias", fromDay: 31, toDay: 45 },
  { key: "46_60", label: "46–60 dias", fromDay: 46, toDay: 60 },
] as const;

export const FINANCE_HORIZON_MAX_DAY = 60;

export type FinanceHorizonRow = {
  value: number;
  operationalDate: Date | null;
};

export type FinanceHorizonBucketValue = {
  key: FinanceHorizonBucketKey;
  label: string;
  amount: number;
  count: number;
};

export type FinanceHorizonAggregation = {
  buckets: FinanceHorizonBucketValue[];
  total: FinanceHorizonBucketValue;
};

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function roundHorizonMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function computeDaysFromToday(operationalDate: Date, today: Date): number {
  return diffCivilDays(today, operationalDate);
}

export function assignFinanceHorizonBucketKey(
  daysFromToday: number
): Exclude<FinanceHorizonBucketKey, "total_60"> | null {
  if (!Number.isFinite(daysFromToday) || daysFromToday < 0 || daysFromToday > FINANCE_HORIZON_MAX_DAY) {
    return null;
  }
  for (const def of FINANCE_HORIZON_BUCKETS) {
    if (daysFromToday >= def.fromDay && daysFromToday <= def.toDay) {
      return def.key;
    }
  }
  return null;
}

export function bucketizeFinanceHorizonRows(
  rows: FinanceHorizonRow[],
  today: Date = new Date()
): FinanceHorizonAggregation {
  const acc = new Map<Exclude<FinanceHorizonBucketKey, "total_60">, { amount: number; count: number }>();
  for (const def of FINANCE_HORIZON_BUCKETS) {
    acc.set(def.key, { amount: 0, count: 0 });
  }

  for (const row of rows) {
    if (row.operationalDate == null) continue;
    if (!Number.isFinite(row.value) || row.value <= 0) continue;
    const days = computeDaysFromToday(row.operationalDate, today);
    const key = assignFinanceHorizonBucketKey(days);
    if (!key) continue;
    const bucket = acc.get(key)!;
    bucket.amount += row.value;
    bucket.count += 1;
  }

  const buckets: FinanceHorizonBucketValue[] = FINANCE_HORIZON_BUCKETS.map((def) => {
    const data = acc.get(def.key)!;
    return {
      key: def.key,
      label: def.label,
      amount: roundHorizonMoney(data.amount),
      count: data.count,
    };
  });

  const total: FinanceHorizonBucketValue = {
    key: "total_60",
    label: "Total 60 dias",
    amount: roundHorizonMoney(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)),
    count: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
  };

  return { buckets, total };
}

export function financeHorizonAggregationIsFinite(agg: FinanceHorizonAggregation): boolean {
  const values = [...agg.buckets, agg.total].flatMap((b) => [b.amount, b.count]);
  return values.every((v) => Number.isFinite(v));
}
