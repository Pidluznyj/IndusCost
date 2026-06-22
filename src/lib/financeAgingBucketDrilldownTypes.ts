/**
 * Tipos e helpers client-safe para drilldown de buckets de aging/horizonte.
 */

import type { FinanceApAgingBucket } from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceArAgingBucket } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceHorizonBucketValue } from "./financeHorizonBuckets.js";
import type { FinanceAgingBucketSelectionMeta } from "./financeDashboardAgingBuckets.js";

export type FinanceSelectedAgingBucket = FinanceAgingBucketSelectionMeta;

export type FinanceAgingBucketCardSource = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

export function mapArAgingBucketsToCards(buckets: FinanceArAgingBucket[]): FinanceAgingBucketCardSource[] {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    amount: b.amount,
    count: b.count,
  }));
}

export function mapApAgingBucketsToCards(buckets: FinanceApAgingBucket[]): FinanceAgingBucketCardSource[] {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    amount: b.amount,
    count: b.count,
  }));
}

export function mapHorizonBucketsToCards(
  buckets: FinanceHorizonBucketValue[],
  total?: FinanceHorizonBucketValue
): FinanceAgingBucketCardSource[] {
  const items = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    amount: b.amount,
    count: b.count,
  }));
  if (total) {
    items.push({
      key: total.key,
      label: total.label,
      amount: total.amount,
      count: total.count,
    });
  }
  return items;
}

export type FinanceTitlesBucketTotals = {
  openBalanceAmount: number;
  titlesCount: number;
};

export type FinanceTitlesBucketDrilldownMeta = {
  selectedBucket: FinanceAgingBucketSelectionMeta;
  bucketTotals: FinanceTitlesBucketTotals;
};
