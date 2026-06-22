/**
 * Buckets de aging do dashboard financeiro (AR/AP).
 * Mesma regra usada em buildFinanceAccountsReceivableDashboard e buildFinanceAccountsPayableDashboard.
 */

import {
  computeDaysFromToday,
  assignFinanceHorizonBucketKey,
  FINANCE_HORIZON_BUCKETS,
  startOfLocalDay,
  type FinanceHorizonBucketKey,
} from "./financeHorizonBuckets.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const FINANCE_DASHBOARD_AGING_BUCKET_DEFS = [
  { key: "upcoming", label: "A vencer", type: "due" as const, minDays: 1, maxDays: null },
  { key: "dueToday", label: "Vence hoje", type: "due" as const, minDays: 0, maxDays: 0 },
  { key: "overdue1to7", label: "1 a 7 dias vencido", type: "overdue" as const, minDays: 1, maxDays: 7 },
  { key: "overdue8to15", label: "8 a 15 dias vencido", type: "overdue" as const, minDays: 8, maxDays: 15 },
  { key: "overdue16to30", label: "16 a 30 dias vencido", type: "overdue" as const, minDays: 16, maxDays: 30 },
  { key: "overdue31to60", label: "31 a 60 dias vencido", type: "overdue" as const, minDays: 31, maxDays: 60 },
  { key: "overdue61to90", label: "61 a 90 dias vencido", type: "overdue" as const, minDays: 61, maxDays: 90 },
  { key: "overdue90plus", label: "Acima de 90 dias", type: "overdue" as const, minDays: 91, maxDays: null },
] as const;

export type FinanceDashboardAgingBucketKey = (typeof FINANCE_DASHBOARD_AGING_BUCKET_DEFS)[number]["key"];

export type FinanceHorizonDrilldownBucketKey =
  | Exclude<FinanceHorizonBucketKey, "total_60">
  | "overdue"
  | "total_60";

export type FinanceAgingBucketParam = FinanceDashboardAgingBucketKey | FinanceHorizonDrilldownBucketKey;

export type FinanceAgingBucketSelectionMeta = {
  key: string;
  label: string;
  minDays: number | null;
  maxDays: number | null;
  type: "overdue" | "due" | "aging";
};

const DASHBOARD_KEY_SET = new Set<string>(FINANCE_DASHBOARD_AGING_BUCKET_DEFS.map((d) => d.key));

const HORIZON_KEY_SET = new Set<string>([
  ...FINANCE_HORIZON_BUCKETS.map((d) => d.key),
  "overdue",
  "total_60",
]);

const HORIZON_LABELS: Record<FinanceHorizonDrilldownBucketKey, { label: string; type: "overdue" | "aging"; minDays: number | null; maxDays: number | null }> = {
  overdue: { label: "Vencidos", type: "overdue", minDays: null, maxDays: -1 },
  "0_7": { label: "0–7 dias", type: "aging", minDays: 0, maxDays: 7 },
  "8_15": { label: "8–15 dias", type: "aging", minDays: 8, maxDays: 15 },
  "16_30": { label: "16–30 dias", type: "aging", minDays: 16, maxDays: 30 },
  "31_45": { label: "31–45 dias", type: "aging", minDays: 31, maxDays: 45 },
  "46_60": { label: "46–60 dias", type: "aging", minDays: 46, maxDays: 60 },
  total_60: { label: "Total 60 dias", type: "aging", minDays: 0, maxDays: 60 },
};

export function assignFinanceDashboardAgingBucketKey(
  dueDate: Date,
  today: Date = new Date()
): FinanceDashboardAgingBucketKey {
  const due = startOfLocalDay(dueDate);
  const t = startOfLocalDay(today);
  const diffDays = Math.floor((due.getTime() - t.getTime()) / MS_PER_DAY);
  if (diffDays > 0) return "upcoming";
  if (diffDays === 0) return "dueToday";
  const overdueDays = -diffDays;
  if (overdueDays <= 7) return "overdue1to7";
  if (overdueDays <= 15) return "overdue8to15";
  if (overdueDays <= 30) return "overdue16to30";
  if (overdueDays <= 60) return "overdue31to60";
  if (overdueDays <= 90) return "overdue61to90";
  return "overdue90plus";
}

export function parseFinanceAgingBucketParam(value: unknown): FinanceAgingBucketParam | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return undefined;
  if (DASHBOARD_KEY_SET.has(raw)) return raw as FinanceDashboardAgingBucketKey;
  if (HORIZON_KEY_SET.has(raw)) return raw as FinanceHorizonDrilldownBucketKey;
  return undefined;
}

export function isFinanceDashboardAgingBucketKey(
  value: string
): value is FinanceDashboardAgingBucketKey {
  return DASHBOARD_KEY_SET.has(value);
}

export function isFinanceHorizonDrilldownBucketKey(
  value: string
): value is FinanceHorizonDrilldownBucketKey {
  return HORIZON_KEY_SET.has(value);
}

export function resolveFinanceAgingBucketMeta(
  key: FinanceAgingBucketParam
): FinanceAgingBucketSelectionMeta {
  const dashboard = FINANCE_DASHBOARD_AGING_BUCKET_DEFS.find((d) => d.key === key);
  if (dashboard) {
    return {
      key: dashboard.key,
      label: dashboard.label,
      minDays: dashboard.minDays,
      maxDays: dashboard.maxDays,
      type: dashboard.type,
    };
  }
  const horizon = HORIZON_LABELS[key as FinanceHorizonDrilldownBucketKey];
  return {
    key,
    label: horizon.label,
    minDays: horizon.minDays,
    maxDays: horizon.maxDays,
    type: horizon.type,
  };
}

export function rowMatchesFinanceDashboardAgingBucket(
  dueDate: Date | null | undefined,
  bucketKey: FinanceDashboardAgingBucketKey,
  today: Date = new Date()
): boolean {
  if (!dueDate) return false;
  return assignFinanceDashboardAgingBucketKey(dueDate, today) === bucketKey;
}

export function rowMatchesFinanceHorizonDrilldownBucket(
  dueDate: Date | null | undefined,
  bucketKey: FinanceHorizonDrilldownBucketKey,
  today: Date = new Date()
): boolean {
  if (!dueDate) return false;
  const days = computeDaysFromToday(dueDate, today);
  if (bucketKey === "overdue") return days < 0;
  if (bucketKey === "total_60") return days >= 0 && days <= 60;
  const horizonKey = assignFinanceHorizonBucketKey(days);
  return horizonKey === bucketKey;
}
