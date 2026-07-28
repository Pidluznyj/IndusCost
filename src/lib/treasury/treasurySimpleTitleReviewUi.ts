/**
 * Helpers UI — revisão simples de CR/CP do dia (client-safe).
 */

import type {
  TreasuryFinancialAccountDto,
  TreasuryPayableListItemDto,
  TreasuryReceivableListItemDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_REVIEW_BUCKET_LABELS,
  type TreasurySimplePayableReviewCategory,
  type TreasurySimpleReceivableReviewCategory,
  type TreasurySimpleReviewBucket,
} from "./domain/treasurySimpleTitleReviewRules.js";
import {
  formatTreasuryReceivableDate,
  formatTreasuryReceivableMoney,
} from "./treasuryReceivablesUi.js";
import { todayCivilDateLocal } from "./treasuryTodayUi.js";

export const TREASURY_SIMPLE_RECEIVABLES_REVIEW_TITLE =
  "Recebimentos de hoje" as const;
export const TREASURY_SIMPLE_RECEIVABLES_REVIEW_SUBTITLE =
  "Revise o que estava previsto e o que já entrou. Ações locais não alteram o Nomus." as const;

export const TREASURY_SIMPLE_PAYABLES_REVIEW_TITLE =
  "Pagamentos de hoje" as const;
export const TREASURY_SIMPLE_PAYABLES_REVIEW_SUBTITLE =
  "Revise o que estava previsto e o que já saiu. Ações locais não alteram o Nomus." as const;

export const TREASURY_SIMPLE_REVIEW_DENIED =
  "Sem permissão para revisar títulos da Tesouraria." as const;

export const TREASURY_SIMPLE_REVIEW_EMPTY_TITLE =
  "Nenhum título neste filtro" as const;

export const TREASURY_SIMPLE_REVIEW_EMPTY_DESCRIPTION =
  "Ajuste data, conta ou situação para ver outros títulos." as const;

export {
  TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_REVIEW_BUCKET_LABELS,
};

export type TreasurySimpleReviewFilterState = {
  date: string;
  accountId: string;
  category: string;
  bucket: TreasurySimpleReviewBucket;
};

export function createEmptyTreasurySimpleReviewFilters(
  date = todayCivilDateLocal()
): TreasurySimpleReviewFilterState {
  return {
    date,
    accountId: "",
    category: "ALL",
    bucket: "ALL",
  };
}

export function formatTreasurySimpleReviewMoney(
  value: string | null | undefined
): string {
  return formatTreasuryReceivableMoney(value);
}

export function formatTreasurySimpleReviewDate(
  value: string | null | undefined
): string {
  return formatTreasuryReceivableDate(value);
}

export function resolveTreasurySimpleReceivableAccountLabel(
  row: TreasuryReceivableListItemDto,
  accounts: readonly TreasuryFinancialAccountDto[]
): string {
  const id = row.complement?.plannedAccountId;
  if (!id) return "Sem conta";
  const acc = accounts.find((a) => a.id === id);
  return acc ? acc.name : "Conta vinculada";
}

export function resolveTreasurySimplePayableAccountLabel(
  row: TreasuryPayableListItemDto,
  accounts: readonly TreasuryFinancialAccountDto[]
): string {
  const id = row.plannedAccountId ?? row.complement?.plannedAccountId;
  if (!id) return "Sem conta";
  const acc = accounts.find((a) => a.id === id);
  return acc ? acc.name : "Conta vinculada";
}

export function parcelLabel(input: {
  installmentLabel: string | null;
  installmentNumber: number | null;
  documentNumber: string | null;
  description: string | null;
  externalId: number;
}): string {
  if (input.installmentLabel?.trim()) return input.installmentLabel.trim();
  if (input.documentNumber?.trim()) return input.documentNumber.trim();
  if (input.description?.trim()) return input.description.trim();
  if (input.installmentNumber != null) return `Parcela ${input.installmentNumber}`;
  return `Título ${input.externalId}`;
}

export function officialStatusLabel(input: {
  isSettled: boolean;
  isOpen: boolean;
}): string {
  if (input.isSettled) return "Baixado";
  if (input.isOpen) return "Em aberto";
  return "Fechado na origem";
}

export function receivableCategoryLabel(
  category: TreasurySimpleReceivableReviewCategory
): string {
  return TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS[category];
}

export function payableCategoryLabel(
  category: TreasurySimplePayableReviewCategory
): string {
  return TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS[category];
}

export type TreasurySimpleReviewViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function resolveTreasurySimpleReviewViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  rowCount: number;
  hasLoaded: boolean;
}): TreasurySimpleReviewViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasLoaded) return "loading";
  if (input.error && !input.hasLoaded) return "error";
  if (input.hasLoaded && input.rowCount === 0) return "empty";
  if (input.hasLoaded) return "ready";
  if (input.loading) return "loading";
  if (input.error) return "error";
  return "empty";
}
