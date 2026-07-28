import {
  ECONOMIC_GROUP_CNPJ_DIGITS,
  isIntercompanySalesOrder,
  isInternalGroupCounterparty,
  normalizeFinanceCnpj,
  normalizeFinancePersonText,
} from "@/src/lib/financeInternalGroupExclusions.js";

/**
 * Compat: CNPJs do grupo — fonte canônica em `financeInternalGroupExclusions`.
 * @deprecated Preferir `ECONOMIC_GROUP_CNPJ_DIGITS`.
 */
export const GROUP_COMPANY_CNPJ_DIGITS = ECONOMIC_GROUP_CNPJ_DIGITS;

/** SM: CNPJ confirmado no cadastro financeiro interno. */
export const GROUP_COMPANY_SM_CNPJ_PENDING = false;

export type GroupCompanyCustomerInput = {
  taxId?: string | null;
  companyName?: string | null;
  tradeName?: string | null;
};

export function normalizeCnpjDigits(taxId: string | null | undefined): string {
  return normalizeFinanceCnpj(taxId);
}

export function normalizeCompanyName(name: string | null | undefined): string {
  return normalizeFinancePersonText(name).toLowerCase();
}

/**
 * Cliente pertence ao grupo (Lazarios, Koppetel, SM) — excluir do faturamento de mercado.
 * Prioridade: CNPJ normalizado; fallback por razão social / nome fantasia.
 */
export function isGroupCompanyCustomer(customer: GroupCompanyCustomerInput): boolean {
  return isInternalGroupCounterparty({
    personCnpj: customer.taxId,
    personName: customer.companyName ?? customer.tradeName ?? null,
  })
    || (customer.tradeName != null &&
      customer.tradeName !== customer.companyName &&
      isInternalGroupCounterparty({
        personCnpj: customer.taxId,
        personName: customer.tradeName,
      }));
}

/** Cliente elegível para faturamento gerencial de mercado. */
export function isMarketBillingCustomer(customer: GroupCompanyCustomerInput): boolean {
  return !isGroupCompanyCustomer(customer);
}

/** Cliente de pedido de venda — usa dados do Customer vinculado (não o emitente). */
export function isSalesOrderMarketCustomer(order: {
  Customer?: GroupCompanyCustomerInput | null;
}): boolean {
  return !isIntercompanySalesOrder(order);
}
