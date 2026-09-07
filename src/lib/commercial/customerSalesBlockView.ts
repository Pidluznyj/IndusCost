/**
 * Contrato público da trava de venda (browser-safe).
 * Sem motor AR — o frontend só apresenta o payload do backend.
 */

export const CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO = "CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO";

export const CUSTOMER_SALES_BLOCKED_MESSAGE =
  "Venda bloqueada. O cliente possui boleto(s) vencido(s) em aberto.";

export const CUSTOMER_SALES_BLOCKED_BUTTON_HINT =
  "Venda bloqueada: cliente possui boleto(s) vencido(s).";

export const CUSTOMER_SALES_BLOCKED_GENERIC_HINT =
  "Venda bloqueada: o cliente possui boleto(s) vencido(s).";

export type CustomerSalesBlockResolution =
  | "RESOLVED"
  | "UNRESOLVED_IDENTITY"
  | "UNRESOLVED_PAYMENT_METHOD"
  | "STALE_SOURCE";

export type CustomerSalesBlockPublic = {
  blocked: boolean;
  reason: "OVERDUE_BOLETO" | null;
  resolution: CustomerSalesBlockResolution;
  overdueBoletoCount?: number;
  overdueOpenBalance?: number;
  oldestDueDate?: string | null;
  maxDaysOverdue?: number | null;
  nomusPersonId?: number | null;
  evaluatedAt?: string;
};

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

export function customerSalesBlockTooltip(
  block: Pick<
    CustomerSalesBlockPublic,
    "blocked" | "overdueBoletoCount" | "overdueOpenBalance" | "oldestDueDate" | "maxDaysOverdue"
  >,
  includeFinancialDetails: boolean
): string {
  if (!block.blocked) return "";
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
