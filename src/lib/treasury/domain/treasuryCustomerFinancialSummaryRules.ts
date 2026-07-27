/**
 * Regras puras — visão financeira resumida do cliente (CR).
 * Sem I/O. Vendedor ≠ responsável comercial ≠ responsável cobrança.
 */

import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type {
  TreasuryCustomerCollectionHistoryItem,
  TreasuryCustomerFinancialSummaryDto,
  TreasuryCustomerRecentReceiptItem,
} from "../contracts/treasuryReceivableContracts.js";
import type { TreasuryCollectionActionType } from "../contracts/treasuryEnums.js";
import { computeTreasuryReceivableDaysOverdue } from "./treasuryReceivableQueryRules.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export const TREASURY_CUSTOMER_SUMMARY_RECENT_RECEIPTS_LIMIT = 8;
export const TREASURY_CUSTOMER_SUMMARY_COLLECTION_HISTORY_LIMIT = 12;

export type TreasuryCustomerSummaryPromiseInput = {
  status: string;
  promisedAmount: string;
  fulfilledAmount: string;
};

export type TreasuryCustomerSummaryActionInput = {
  id: string;
  officialTitleId: string;
  actionType: TreasuryCollectionActionType | string;
  performedAt: string;
  result: string | null;
  nextAction: string | null;
  contactPerson: string | null;
  cancelledAt: string | null;
};

function moneyOrZero(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

function isOpenAmount(value: string | null | undefined): boolean {
  return compareTreasuryMoney(moneyOrZero(value), "0.00") > 0;
}

function rateToString(numerator: number, denominator: number): string | null {
  if (denominator <= 0) return null;
  const ratio = numerator / denominator;
  return (Math.round(ratio * 10000) / 10000).toFixed(4);
}

export function buildTreasuryCustomerFinancialSummary(input: {
  titleId: string;
  personId: number | null;
  personName: string | null;
  personTaxId: string | null;
  titles: OfficialReceivableView[];
  promises: TreasuryCustomerSummaryPromiseInput[];
  actions: TreasuryCustomerSummaryActionInput[];
  sellerName: string | null;
  commercialOwnerName: string | null;
  collectionOwnerUserId: string | null;
  referenceDate?: Date;
  recentReceiptsLimit?: number;
  collectionHistoryLimit?: number;
}): TreasuryCustomerFinancialSummaryDto {
  const ref = input.referenceDate ?? new Date();
  let openAmountTotal: TreasuryMoneyString = "0.00";
  let overdueAmountTotal: TreasuryMoneyString = "0.00";
  let upcomingAmountTotal: TreasuryMoneyString = "0.00";
  let openTitleCount = 0;
  let overdueTitleCount = 0;
  let upcomingTitleCount = 0;
  let overdueDaysSum = 0;
  let maxDaysOverdue = 0;

  const receipts: TreasuryCustomerRecentReceiptItem[] = [];

  for (const title of input.titles) {
    if (title.cancellation.isCancelledOrRemovedFromSource) continue;

    const open = title.openBalance;
    const days = computeTreasuryReceivableDaysOverdue({
      dueDate: title.dueDate,
      openAmount: open,
      referenceDate: ref,
    });

    if (isOpenAmount(open)) {
      openTitleCount += 1;
      openAmountTotal = addTreasuryMoney(openAmountTotal, moneyOrZero(open));
      if (days > 0) {
        overdueTitleCount += 1;
        overdueAmountTotal = addTreasuryMoney(
          overdueAmountTotal,
          moneyOrZero(open)
        );
        overdueDaysSum += days;
        if (days > maxDaysOverdue) maxDaysOverdue = days;
      } else {
        upcomingTitleCount += 1;
        upcomingAmountTotal = addTreasuryMoney(
          upcomingAmountTotal,
          moneyOrZero(open)
        );
      }
    }

    const settled = title.settlements.settledAmount;
    if (
      settled != null &&
      compareTreasuryMoney(moneyOrZero(settled), "0.00") > 0
    ) {
      receipts.push({
        titleId: title.id,
        externalId: title.externalId,
        settledAt: title.settlements.settledAt,
        settledAmount: moneyOrZero(settled),
        documentLabel:
          title.invoice.number ??
          title.salesOrderCode ??
          title.description ??
          null,
      });
    }
  }

  receipts.sort((a, b) => {
    const at = a.settledAt ?? "";
    const bt = b.settledAt ?? "";
    if (at !== bt) return bt.localeCompare(at);
    return b.externalId - a.externalId;
  });

  const receiptLimit =
    input.recentReceiptsLimit ?? TREASURY_CUSTOMER_SUMMARY_RECENT_RECEIPTS_LIMIT;
  const recentReceipts = receipts.slice(0, receiptLimit);

  let activePromiseCount = 0;
  let expiredPromiseCount = 0;
  let keptPromiseCount = 0;

  for (const p of input.promises) {
    if (p.status === "ACTIVE" || p.status === "PARTIALLY_FULFILLED") {
      activePromiseCount += 1;
    }
    if (p.status === "EXPIRED") {
      expiredPromiseCount += 1;
    }
    if (p.status === "FULFILLED" || p.status === "PARTIALLY_FULFILLED") {
      keptPromiseCount += 1;
    }
  }

  // Índice: cumpridas (total/parcial) / (cumpridas + expiradas). Canceladas fora.
  const promiseFulfillmentRate = rateToString(
    keptPromiseCount,
    keptPromiseCount + expiredPromiseCount
  );

  const historyLimit =
    input.collectionHistoryLimit ??
    TREASURY_CUSTOMER_SUMMARY_COLLECTION_HISTORY_LIMIT;
  const collectionHistory: TreasuryCustomerCollectionHistoryItem[] = input.actions
    .filter((a) => !a.cancelledAt)
    .slice()
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt))
    .slice(0, historyLimit)
    .map((a) => ({
      actionId: a.id,
      titleId: a.officialTitleId,
      actionType: a.actionType,
      performedAt: a.performedAt,
      result: a.result,
      nextAction: a.nextAction,
      contactPerson: a.contactPerson,
    }));

  return {
    titleId: input.titleId,
    personId: input.personId,
    personName: input.personName,
    personTaxId: input.personTaxId,
    openAmountTotal,
    overdueAmountTotal,
    upcomingAmountTotal,
    openTitleCount,
    overdueTitleCount,
    upcomingTitleCount,
    averageDaysOverdue:
      overdueTitleCount > 0
        ? Math.round((overdueDaysSum / overdueTitleCount) * 10) / 10
        : null,
    maxDaysOverdue,
    activePromiseCount,
    expiredPromiseCount,
    promiseFulfillmentRate,
    recentReceipts,
    collectionHistory,
    sellerName: input.sellerName,
    commercialOwnerName: input.commercialOwnerName,
    collectionOwnerUserId: input.collectionOwnerUserId,
  };
}
