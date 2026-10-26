/** Mensagens do cadastro de clientes para a tela (sem detalhes internos do servidor). */
import { HttpError } from "@/src/lib/http";

export const CUSTOMER_TAX_ID_DUPLICATE_CODE = "CUSTOMER_TAX_ID_DUPLICATE";
export const CUSTOMER_TAX_ID_DUPLICATE_UI_MESSAGE = "Este CNPJ/CPF já está cadastrado. Consulte o cliente existente.";

export function describeCustomerSaveError(error: unknown): { message: string; existingCustomerId?: string } {
  if (error instanceof HttpError && error.code === CUSTOMER_TAX_ID_DUPLICATE_CODE) {
    const details = error.details as { existingCustomerId?: unknown } | undefined;
    const existingCustomerId = typeof details?.existingCustomerId === "string" ? details.existingCustomerId : undefined;
    return { message: CUSTOMER_TAX_ID_DUPLICATE_UI_MESSAGE, ...(existingCustomerId ? { existingCustomerId } : {}) };
  }
  return { message: error instanceof Error && error.message ? error.message : "Não foi possível salvar o cliente." };
}
