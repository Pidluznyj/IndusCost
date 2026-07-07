import { isInternalGroupCounterparty } from "@/src/lib/financeInternalGroupExclusions.js";

/** Motivo padrão — alinhado à exclusão gerencial do Financeiro (intercompany / grupo). */
export const COMMISSION_GROUP_COMPANY_EXCLUSION_REASON = "EMPRESA_GRUPO_EXCLUIDA" as const;

export function isCommissionInternalGroupCustomer(input: {
  customerName?: string | null;
  customerCnpj?: string | null;
}): boolean {
  return isInternalGroupCounterparty({
    personName: input.customerName,
    personCnpj: input.customerCnpj,
  });
}

export function isCommissionInternalGroupReceivable(input: {
  customerName?: string | null;
  customerCnpj?: string | null;
}): boolean {
  return isCommissionInternalGroupCustomer(input);
}
