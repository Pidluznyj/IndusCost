import { normalizeSearchString } from "@/src/lib/utils";

/** CNPJs (somente dígitos) das empresas do grupo — exclusão do faturamento gerencial. */
export const GROUP_COMPANY_CNPJ_DIGITS = [
  "14055501000180", // Koppetel — 14.055.501/0001-80
  "72569510000195", // Lazarios — 72.569.510/0001-95
  "55717719000130", // SM — 55.717.719/0001-30
] as const;

/** SM: CNPJ confirmado no cadastro financeiro interno. */
export const GROUP_COMPANY_SM_CNPJ_PENDING = false;

export type GroupCompanyCustomerInput = {
  taxId?: string | null;
  companyName?: string | null;
  tradeName?: string | null;
};

export function normalizeCnpjDigits(taxId: string | null | undefined): string {
  return (taxId ?? "").replace(/\D/g, "");
}

export function normalizeCompanyName(name: string | null | undefined): string {
  return normalizeSearchString(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSmNamePattern(normalized: string): boolean {
  if (!normalized) return false;
  if (normalized === "sm") return true;
  if (normalized.includes("sm comercio") && normalized.includes("plastic")) return true;
  if (normalized.includes("sm com") && normalized.includes("plastic")) return true;
  if (normalized.includes("sm comercio de plasticos")) return true;
  return false;
}

/**
 * Cliente pertence ao grupo (Lazarios, Koppetel, SM) — excluir do faturamento de mercado.
 * Prioridade: CNPJ normalizado; fallback por razão social / nome fantasia.
 */
export function isGroupCompanyCustomer(customer: GroupCompanyCustomerInput): boolean {
  const digits = normalizeCnpjDigits(customer.taxId);
  if (digits && (GROUP_COMPANY_CNPJ_DIGITS as readonly string[]).includes(digits)) {
    return true;
  }

  for (const raw of [customer.companyName, customer.tradeName]) {
    const name = normalizeCompanyName(raw);
    if (!name) continue;
    if (name.includes("koppetel")) return true;
    if (name.includes("lazarios")) return true;
    if (matchesSmNamePattern(name)) return true;
  }

  return false;
}

/** Cliente elegível para faturamento gerencial de mercado. */
export function isMarketBillingCustomer(customer: GroupCompanyCustomerInput): boolean {
  return !isGroupCompanyCustomer(customer);
}

/** Cliente de pedido de venda — usa dados do Customer vinculado. */
export function isSalesOrderMarketCustomer(order: {
  Customer?: GroupCompanyCustomerInput | null;
}): boolean {
  const customer = order.Customer;
  if (!customer) return true;
  return isMarketBillingCustomer({
    taxId: customer.taxId,
    companyName: customer.companyName,
    tradeName: customer.tradeName,
  });
}
