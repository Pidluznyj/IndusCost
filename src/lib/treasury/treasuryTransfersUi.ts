/**
 * Helpers de UI — transferências internas.
 */

import type { TreasuryTransferStatus } from "./contracts/index.js";
import { TREASURY_TRANSFER_STATUSES } from "./contracts/index.js";

export const TREASURY_TRANSFERS_PAGE_TITLE = "Transferências" as const;
export const TREASURY_TRANSFERS_PAGE_SUBTITLE =
  "Movimentações internas entre contas — consolidado neutro e rastreável." as const;

export const TREASURY_TRANSFER_STATUS_LABELS: Record<
  TreasuryTransferStatus,
  string
> = {
  FORECAST: "Prevista",
  SCHEDULED: "Programada",
  SENT: "Enviada",
  RECEIVED: "Recebida",
  RECONCILED: "Conciliada",
  CANCELLED: "Cancelada",
};

export type TreasuryTransfersFilterState = {
  status: string;
  companyCode: string;
  fromAccountId: string;
  toAccountId: string;
};

export function createEmptyTreasuryTransfersFilters(): TreasuryTransfersFilterState {
  return {
    status: "",
    companyCode: "",
    fromAccountId: "",
    toAccountId: "",
  };
}

export function isTreasuryTransferStatus(
  value: string
): value is TreasuryTransferStatus {
  return (TREASURY_TRANSFER_STATUSES as readonly string[]).includes(value);
}

export function resolveTreasuryTransfersViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  itemCount: number;
}): "denied" | "loading" | "error" | "empty" | "ready" {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.itemCount === 0) return "empty";
  return "ready";
}

export type TreasuryTransferFormState = {
  fromAccountId: string;
  toAccountId: string;
  civilDate: string;
  amount: string;
  memo: string;
  status: "FORECAST" | "SCHEDULED";
};

export function createEmptyTreasuryTransferForm(
  today: string
): TreasuryTransferFormState {
  return {
    fromAccountId: "",
    toAccountId: "",
    civilDate: today,
    amount: "",
    memo: "",
    status: "FORECAST",
  };
}

export function validateTreasuryTransferForm(
  form: TreasuryTransferFormState
): string | null {
  if (!form.fromAccountId.trim()) return "Selecione a conta de origem.";
  if (!form.toAccountId.trim()) return "Selecione a conta de destino.";
  if (form.fromAccountId === form.toAccountId) {
    return "Origem e destino devem ser distintos.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.civilDate.trim())) {
    return "Data inválida.";
  }
  if (!/^\d+(\.\d{1,2})?$/.test(form.amount.trim())) {
    return "Valor inválido (use decimal com ponto).";
  }
  if (Number(form.amount) <= 0) return "Valor deve ser positivo.";
  return null;
}
