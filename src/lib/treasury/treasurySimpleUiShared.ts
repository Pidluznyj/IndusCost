/**
 * Helpers compartilhados da UX simples da Tesouraria — browser-safe.
 */

import type { TreasuryFinancialAccountDto } from "./contracts/index.js";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";

/** Resolve companyCode a partir de filtro/contas — sem inventar DEFAULT/LAZARIOS. */
export function resolveTreasurySimpleCompanyCode(input: {
  preferred?: string | null;
  accounts?: ReadonlyArray<Pick<TreasuryFinancialAccountDto, "companyCode">>;
}): string | null {
  const fromPreferred = input.preferred?.trim() || "";
  if (fromPreferred) return fromPreferred;
  for (const acc of input.accounts ?? []) {
    const code = acc.companyCode?.trim();
    if (code) return code;
  }
  return null;
}

export function buildTreasurySimpleRefreshHeaderAction(input: {
  onClick: () => void;
  disabled?: boolean;
}): { id: string; label: string; onClick: () => void; disabled?: boolean } {
  return {
    id: "refresh",
    label: FINANCE_HEADER_ACTION_REFRESH,
    onClick: input.onClick,
    disabled: input.disabled,
  };
}
