/**
 * Contrato público da trava de venda (browser-safe).
 * Sem motor AR — o frontend só apresenta o payload do backend.
 *
 * Dois motivos distintos, nunca confundidos na UI:
 * - OVERDUE_BOLETO: inadimplência provada (boleto vencido em aberto).
 * - FINANCIAL_IDENTITY_UNRESOLVED: não foi possível validar com segurança a
 *   identidade financeira (Nomus idPessoa) do cliente → fail closed, sem
 *   afirmar inadimplência.
 */

export const CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO = "CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO";
export const CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED =
  "CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED";

export type CustomerSalesBlockReason = "OVERDUE_BOLETO" | "FINANCIAL_IDENTITY_UNRESOLVED";

export type CustomerSalesBlockErrorCode =
  | typeof CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO
  | typeof CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED;

export const CUSTOMER_SALES_BLOCKED_MESSAGE =
  "Venda bloqueada. O cliente possui boleto(s) vencido(s) em aberto.";

export const CUSTOMER_SALES_BLOCKED_IDENTITY_MESSAGE =
  "Venda bloqueada. Não foi possível validar com segurança a identidade financeira do cliente.";

export const CUSTOMER_SALES_BLOCKED_BUTTON_HINT =
  "Venda bloqueada: cliente possui boleto(s) vencido(s).";

export const CUSTOMER_SALES_BLOCKED_GENERIC_HINT =
  "Venda bloqueada: o cliente possui boleto(s) vencido(s).";

export const CUSTOMER_SALES_BLOCKED_IDENTITY_HINT =
  "Venda bloqueada: não foi possível validar a situação financeira do cliente.";

export const CUSTOMER_SALES_BLOCK_ERROR_CODES: Record<CustomerSalesBlockReason, CustomerSalesBlockErrorCode> = {
  OVERDUE_BOLETO: CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO,
  FINANCIAL_IDENTITY_UNRESOLVED: CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED,
};

export const CUSTOMER_SALES_BLOCK_MESSAGES: Record<CustomerSalesBlockReason, string> = {
  OVERDUE_BOLETO: CUSTOMER_SALES_BLOCKED_MESSAGE,
  FINANCIAL_IDENTITY_UNRESOLVED: CUSTOMER_SALES_BLOCKED_IDENTITY_MESSAGE,
};

/**
 * Como a identidade financeira foi resolvida:
 * - RESOLVED: Customer.nomusExternalPersonId presente e sem pedido conflitante.
 * - UNRESOLVED_IDENTITY: nenhuma identidade Nomus disponível.
 * - UNRESOLVED_IDENTITY_CONFLICT: Customer.nomusExternalPersonId diverge de
 *   SalesOrder.externalCustomerId em pelo menos um pedido.
 * - UNRESOLVED_PAYMENT_METHOD: identidade ok, títulos vencidos sem forma de
 *   pagamento informada (não prova boleto; não bloqueia).
 */
export type CustomerSalesBlockResolution =
  | "RESOLVED"
  | "UNRESOLVED_IDENTITY"
  | "UNRESOLVED_IDENTITY_CONFLICT"
  | "UNRESOLVED_PAYMENT_METHOD";

export type CustomerSalesBlockPublic = {
  blocked: boolean;
  reason: CustomerSalesBlockReason | null;
  resolution: CustomerSalesBlockResolution;
  overdueBoletoCount?: number;
  overdueOpenBalance?: number;
  oldestDueDate?: string | null;
  maxDaysOverdue?: number | null;
  nomusPersonId?: number | null;
  evaluatedAt?: string;
};

export function isCustomerSalesBlockIdentityUnresolved(
  block: Pick<CustomerSalesBlockPublic, "blocked" | "reason"> | null | undefined
): boolean {
  return block?.blocked === true && block.reason === "FINANCIAL_IDENTITY_UNRESOLVED";
}

export function formatCustomerCadastralStatus(status: string | null | undefined): string {
  const raw = String(status ?? "").trim().toUpperCase();
  if (raw === "ACTIVE") return "Ativo";
  if (raw === "INACTIVE") return "Inativo";
  if (raw === "BLOCKED" || raw === "BLOQUEADO") return "Bloqueado";
  return status?.trim() || "—";
}

export function isCustomerCadastralActive(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toUpperCase() === "ACTIVE";
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatIsoDatePt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Texto curto para o botão "Nova venda" desabilitado; null quando liberado. */
export function customerSalesBlockButtonHint(
  block: Pick<CustomerSalesBlockPublic, "blocked" | "reason"> | null | undefined
): string | null {
  if (!block?.blocked) return null;
  if (block.reason === "FINANCIAL_IDENTITY_UNRESOLVED") return CUSTOMER_SALES_BLOCKED_IDENTITY_HINT;
  return CUSTOMER_SALES_BLOCKED_BUTTON_HINT;
}

export function customerSalesBlockTooltip(
  block: Pick<
    CustomerSalesBlockPublic,
    "blocked" | "reason" | "overdueBoletoCount" | "overdueOpenBalance" | "oldestDueDate" | "maxDaysOverdue"
  >,
  includeFinancialDetails: boolean
): string {
  if (!block.blocked) return "";
  // Identidade não validada: nunca afirmar boleto vencido, com ou sem permissão.
  if (block.reason === "FINANCIAL_IDENTITY_UNRESOLVED") return CUSTOMER_SALES_BLOCKED_IDENTITY_HINT;
  if (!includeFinancialDetails) return CUSTOMER_SALES_BLOCKED_GENERIC_HINT;
  const count = block.overdueBoletoCount ?? 0;
  const amount = formatBrl(block.overdueOpenBalance ?? 0);
  const oldest = formatIsoDatePt(block.oldestDueDate);
  const days = block.maxDaysOverdue;
  let text = `Venda bloqueada: ${count} boleto${count === 1 ? "" : "s"} vencido${count === 1 ? "" : "s"}, com ${amount} em aberto.`;
  if (oldest) text += ` Título mais antigo vencido em ${oldest}.`;
  if (days != null && days > 0) text += ` Mais antigo: ${days} dia${days === 1 ? "" : "s"} em atraso.`;
  return text;
}

export function customerHasFinancialSalesBlockDetails(block: CustomerSalesBlockPublic | null | undefined): boolean {
  return block != null && typeof block.overdueOpenBalance === "number";
}
