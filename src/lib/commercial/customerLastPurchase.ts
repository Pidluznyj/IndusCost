/**
 * "Última compra" do cliente: uma VISUALIZAÇÃO da mesma verdade operacional
 * que alimenta a rotina de inatividade de carteira (90 dias).
 *
 * Não há regra própria aqui. A data vem de `LastValidInvoice`, resolvida pelo
 * motor canônico em `customerCommercialOwnerInactivity` (última NF /
 * Documento de Saída válido vinculado a Pedido de Venda: NF cancelada,
 * devolução e transferência não contam; PV sem NF não conta; faturamento
 * parcial conta; data = xmlDhEmi → dataProcessamento → DS válido).
 * Este módulo só converte esse resultado em DTO e texto para o grid/export.
 */
import type { LastValidInvoice } from "./customerCommercialOwnerInactivity.js";

export type CustomerLastPurchaseStatus = "VALID" | "NEVER_INVOICED" | "DATA_ANOMALY";

export type CustomerLastPurchase = {
  /** ISO da data fiscal canônica da última compra válida; nulo sem compra válida datada. */
  lastPurchaseAt: string | null;
  /** VALID = data conhecida; NEVER_INVOICED = nunca faturou; DATA_ANOMALY = NF válida sem data utilizável. */
  lastPurchaseStatus: CustomerLastPurchaseStatus;
};

export const CUSTOMER_LAST_PURCHASE_NEVER_LABEL = "Nunca";
/** NF válida cujo documento não traz data utilizável (DATA_ANOMALY do motor): não se inventa competência. */
export const CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL = "—";

/** Mesmo `kind` que `pickInvoiceClock` devolve: entrada ausente = nunca faturou; entrada sem data = anomalia. */
export function customerLastPurchaseFromInvoice(
  invoice: Pick<LastValidInvoice, "invoiceDate"> | null | undefined
): CustomerLastPurchase {
  if (!invoice) return { lastPurchaseAt: null, lastPurchaseStatus: "NEVER_INVOICED" };
  if (!invoice.invoiceDate) return { lastPurchaseAt: null, lastPurchaseStatus: "DATA_ANOMALY" };
  return { lastPurchaseAt: invoice.invoiceDate.toISOString(), lastPurchaseStatus: "VALID" };
}

const SAO_PAULO = "America/Sao_Paulo";
const MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, month: "2-digit", year: "numeric" });
const DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, dateStyle: "short" });

/**
 * Competência "MM/AAAA" no dia civil de Brasília — o mesmo calendário da rotina
 * (`saoPauloDateIso`), para 01/08 às 00:00 não virar julho por UTC.
 */
export function formatCustomerLastPurchaseMonth(input: Pick<CustomerLastPurchase, "lastPurchaseAt" | "lastPurchaseStatus">): string {
  if (input.lastPurchaseStatus === "NEVER_INVOICED") return CUSTOMER_LAST_PURCHASE_NEVER_LABEL;
  if (!input.lastPurchaseAt) return CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL;
  const date = new Date(input.lastPurchaseAt);
  if (Number.isNaN(date.getTime())) return CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL;
  return MONTH_YEAR.format(date);
}

/** Data completa (dd/mm/aaaa, Brasília) para o título da célula; nulo quando não há data. */
export function formatCustomerLastPurchaseDay(lastPurchaseAt: string | null): string | null {
  if (!lastPurchaseAt) return null;
  const date = new Date(lastPurchaseAt);
  if (Number.isNaN(date.getTime())) return null;
  return DAY.format(date);
}
