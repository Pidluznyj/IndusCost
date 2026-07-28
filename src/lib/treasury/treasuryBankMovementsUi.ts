/**
 * Helpers de UI — movimentos bancários / importação OFX.
 */

import type { TreasuryBankMovementFilterBucket } from "./contracts/index.js";
import { TREASURY_BANK_MOVEMENT_FILTER_BUCKETS } from "./contracts/index.js";

export const TREASURY_BANK_MOVEMENTS_PAGE_TITLE = "Movimentos bancários" as const;
export const TREASURY_BANK_MOVEMENTS_DENIED_MESSAGE =
  "Você não tem permissão para visualizar movimentos bancários." as const;
export const TREASURY_BANK_MOVEMENTS_PAGE_SUBTITLE =
  "Importação OFX, histórico de lotes e conciliação de movimentos." as const;

export const TREASURY_BANK_MOVEMENT_BUCKET_LABELS: Record<
  TreasuryBankMovementFilterBucket,
  string
> = {
  UNRECONCILED: "Não conciliados",
  PARTIAL: "Parcialmente conciliados",
  RECONCILED: "Conciliados",
  DUPLICATES: "Duplicados",
};

export const TREASURY_BANK_MOVEMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  PARTIAL: "Parcial",
  MATCHED: "Conciliado",
  UNMATCHED: "Sem match",
  IGNORED: "Ignorado",
};

export const TREASURY_OFX_PREVIEW_STATUS_LABELS: Record<string, string> = {
  NEW: "Novo",
  DUPLICATE: "Duplicado",
  INVALID: "Inválido",
};

export type TreasuryBankMovementsFilterState = {
  bucket: string;
  accountId: string;
  companyCode: string;
  batchId: string;
  search: string;
  from: string;
  to: string;
};

export function createEmptyTreasuryBankMovementsFilters(): TreasuryBankMovementsFilterState {
  return {
    bucket: "",
    accountId: "",
    companyCode: "",
    batchId: "",
    search: "",
    from: "",
    to: "",
  };
}

export function isTreasuryBankMovementFilterBucket(
  value: string
): value is TreasuryBankMovementFilterBucket {
  return (TREASURY_BANK_MOVEMENT_FILTER_BUCKETS as readonly string[]).includes(
    value
  );
}

export function resolveTreasuryBankMovementsViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  itemCount: number;
  duplicatesNotPersisted?: boolean;
}): "denied" | "loading" | "error" | "empty" | "ready" | "duplicates_info" {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.duplicatesNotPersisted) return "duplicates_info";
  if (input.itemCount === 0) return "empty";
  return "ready";
}

export type TreasuryOfxImportWizardStep =
  | "upload"
  | "preview"
  | "confirming"
  | "done";

export function resolveTreasuryOfxImportWizardMessage(
  step: TreasuryOfxImportWizardStep
): string {
  switch (step) {
    case "upload":
      return "Selecione a conta e o arquivo OFX (.ofx/.qfx) para pré-visualizar.";
    case "preview":
      return "Revise novos, duplicados e inválidos antes de confirmar a importação.";
    case "confirming":
      return "Confirmando importação… não feche a janela.";
    case "done":
      return "Importação concluída. Movimentos novos foram gravados; duplicados foram ignorados.";
    default:
      return "";
  }
}

export function validateTreasuryOfxUploadForm(input: {
  accountId: string;
  file: File | null;
}): string | null {
  if (!input.accountId.trim()) return "Selecione a conta financeira.";
  if (!input.file) return "Selecione um arquivo OFX.";
  const name = input.file.name.toLowerCase();
  if (!name.endsWith(".ofx") && !name.endsWith(".qfx")) {
    return "Arquivo deve ter extensão .ofx ou .qfx.";
  }
  return null;
}

export function formatTreasuryBankMoney(value: string, currency = "BRL"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  });
}
