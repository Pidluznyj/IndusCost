/**
 * Labels, form defaults e estados de view — Contas financeiras (client-safe).
 */

import { formatFinanceCurrency, formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryAccountAccessLevel,
  TreasuryAccountLiquidity,
  TreasuryAccountType,
  TreasuryBalanceOrigin,
  TreasuryCreateAccountInput,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";

export const TREASURY_ACCOUNTS_PAGE_TITLE = "Contas financeiras" as const;
export const TREASURY_ACCOUNTS_PAGE_SUBTITLE =
  "Cadastro local de contas bancárias e caixa da Tesouraria. Agência e número são exibidos mascarados. Não substitui Contas a Receber/Pagar Nomus nem o Fluxo de Caixa." as const;

export const TREASURY_ACCOUNTS_DENIED_MESSAGE =
  "Sem permissão para visualizar contas financeiras da Tesouraria." as const;

export const TREASURY_ACCOUNTS_EMPTY_TITLE =
  "Nenhuma conta financeira cadastrada" as const;
export const TREASURY_ACCOUNTS_EMPTY_DESCRIPTION =
  "Crie a primeira conta para registrar saldos, liquidez e inclusão no consolidado da Tesouraria." as const;

export const TREASURY_ACCOUNTS_EMPTY_FILTERED_TITLE =
  "Nenhuma conta no filtro" as const;
export const TREASURY_ACCOUNTS_EMPTY_FILTERED_DESCRIPTION =
  "Ajuste a busca ou o status para ver outras contas." as const;

export const TREASURY_ACCOUNT_TYPE_LABELS: Record<TreasuryAccountType, string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  CASH: "Caixa",
  INVESTMENT: "Investimento",
  OTHER: "Outra",
};

export const TREASURY_LIQUIDITY_LABELS: Record<TreasuryAccountLiquidity, string> = {
  IMMEDIATE: "Imediata",
  D_PLUS_1: "D+1",
  D_PLUS_N: "D+N",
  TERM: "Prazo",
  ILLIQUID: "Iliquida",
};

export const TREASURY_ACCESS_LEVEL_LABELS: Record<
  TreasuryAccountAccessLevel,
  string
> = {
  VIEW: "Visualizar",
  OPERATE: "Operar",
  MANAGE: "Gerenciar",
};

export const TREASURY_BALANCE_ORIGIN_LABELS: Record<
  TreasuryBalanceOrigin,
  string
> = {
  MANUAL: "Manual",
  OFX: "OFX",
  CLOSING: "Fechamento",
  SYSTEM: "Sistema",
  IMPORT: "Importação",
};

export type TreasuryAccountFormState = {
  companyCode: string;
  companyName: string;
  code: string;
  name: string;
  institutionName: string;
  institutionCode: string;
  accountType: TreasuryAccountType;
  agencyMasked: string;
  accountNumberMasked: string;
  includeInConsolidated: boolean;
  minimumBalance: string;
  allowNegativeBalance: boolean;
  liquidity: TreasuryAccountLiquidity;
  defaultBalanceOrigin: TreasuryBalanceOrigin;
  sortOrder: string;
  nomusBankAccountId: string;
};

export function createEmptyTreasuryAccountForm(): TreasuryAccountFormState {
  return {
    companyCode: "",
    companyName: "",
    code: "",
    name: "",
    institutionName: "",
    institutionCode: "",
    accountType: "CHECKING",
    agencyMasked: "",
    accountNumberMasked: "",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: "0",
    nomusBankAccountId: "",
  };
}

export function formFromTreasuryAccount(
  row: TreasuryFinancialAccountDto
): TreasuryAccountFormState {
  return {
    companyCode: row.companyCode,
    companyName: row.companyName ?? "",
    code: row.code,
    name: row.name,
    institutionName: row.institutionName,
    institutionCode: row.institutionCode ?? "",
    accountType: row.accountType,
    agencyMasked: row.agencyMasked,
    accountNumberMasked: row.accountNumberMasked,
    includeInConsolidated: row.includeInConsolidated,
    minimumBalance: row.minimumBalance,
    allowNegativeBalance: row.allowNegativeBalance,
    liquidity: row.liquidity,
    defaultBalanceOrigin: row.defaultBalanceOrigin,
    sortOrder: String(row.sortOrder),
    nomusBankAccountId: row.nomusBankAccountId ?? "",
  };
}

export function validateTreasuryAccountForm(
  form: TreasuryAccountFormState,
  mode: "create" | "edit"
): string | null {
  if (mode === "create" && !form.companyCode.trim()) {
    return "Informe o código da empresa.";
  }
  if (mode === "create" && !form.code.trim()) {
    return "Informe o código da conta.";
  }
  if (!form.name.trim()) return "Informe o nome da conta.";
  if (!form.institutionName.trim()) return "Informe a instituição.";
  if (!form.agencyMasked.trim()) {
    return "Informe a agência (mascarada).";
  }
  if (!form.accountNumberMasked.trim()) {
    return "Informe o número da conta (mascarado).";
  }
  const min = form.minimumBalance.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,8})?$/.test(min)) {
    return "Saldo mínimo inválido (use decimal com ponto).";
  }
  if (form.sortOrder.trim() !== "" && !/^-?\d+$/.test(form.sortOrder.trim())) {
    return "Ordem deve ser um número inteiro.";
  }
  return null;
}

export function toCreateAccountInput(
  form: TreasuryAccountFormState
): TreasuryCreateAccountInput {
  return {
    companyCode: form.companyCode.trim(),
    companyName: form.companyName.trim() || null,
    code: form.code.trim(),
    name: form.name.trim(),
    institutionName: form.institutionName.trim(),
    institutionCode: form.institutionCode.trim() || null,
    accountType: form.accountType,
    currency: "BRL",
    agencyMasked: form.agencyMasked.trim(),
    accountNumberMasked: form.accountNumberMasked.trim(),
    includeInConsolidated: form.includeInConsolidated,
    minimumBalance: form.minimumBalance.trim().replace(",", "."),
    allowNegativeBalance: form.allowNegativeBalance,
    liquidity: form.liquidity,
    defaultBalanceOrigin: form.defaultBalanceOrigin,
    sortOrder: Number.parseInt(form.sortOrder.trim() || "0", 10) || 0,
    nomusBankAccountId: form.nomusBankAccountId.trim() || null,
  };
}

export function formatTreasuryMoneyDisplay(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return formatFinanceCurrency(value);
}

export function formatTreasuryUpdatedAt(iso: string | null | undefined): string {
  return formatFinanceDateTime(iso);
}

export type TreasuryAccountsViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "empty-filtered"
  | "ready";

export function resolveTreasuryAccountsViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  rowCount: number;
  hasFilters: boolean;
}): TreasuryAccountsViewKind {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error && input.rowCount === 0) return "error";
  if (input.rowCount === 0) {
    return input.hasFilters ? "empty-filtered" : "empty";
  }
  return "ready";
}

export function buildTreasuryAccountsListQuery(input: {
  search: string;
  status: "all" | "active" | "inactive";
  page: number;
  pageSize: number;
}): {
  search: string | null;
  isActive: boolean | null;
  page: number;
  pageSize: number;
  hasFilters: boolean;
} {
  const search = input.search.trim() || null;
  const isActive =
    input.status === "active"
      ? true
      : input.status === "inactive"
        ? false
        : null;
  return {
    search,
    isActive,
    page: input.page,
    pageSize: input.pageSize,
    hasFilters: Boolean(search) || input.status !== "all",
  };
}
