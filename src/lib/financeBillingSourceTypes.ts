/** Fonte do dashboard de faturamento (Financeiro > Faturamento). */

export type FinanceBillingSource = "nfe" | "sales_order";

export type FinanceBillingDateBase = "emissao" | "processamento";

export const FINANCE_BILLING_SOURCE_DEFAULT: FinanceBillingSource = "nfe";

export const FINANCE_BILLING_NFE_DEFAULT_FILTERS = {
  statusAuthorized: true,
  marketOnly: true,
  classification: "MARKET_REVENUE" as const,
  includeCancelled: false,
  includeReturns: false,
};

export function parseFinanceBillingSource(value: unknown): FinanceBillingSource {
  const raw = String(value ?? FINANCE_BILLING_SOURCE_DEFAULT).toLowerCase();
  if (raw === "sales_order" || raw === "salesorder" || raw === "pedido") return "sales_order";
  return "nfe";
}

export function parseFinanceBillingDateBase(value: unknown): FinanceBillingDateBase {
  const raw = String(value ?? "emissao").toLowerCase();
  if (raw === "processamento" || raw === "processing") return "processamento";
  return "emissao";
}

export function financeBillingSourceLabel(source: FinanceBillingSource): string {
  return source === "nfe" ? "Faturamento Fiscal NF-e" : "Pedidos faturados";
}

export function financeBillingSourceChip(source: FinanceBillingSource): string {
  if (source === "nfe") {
    return "Fonte: NF-e fiscal · Status: Autorizada · Mercado: Sim · Valor: líquido NF-e";
  }
  return "Fonte: Pedidos de venda · Valor: SalesOrder.totalNetValue";
}

export function buildFinanceBillingDashboardQuery(
  year: string,
  options?: { billingSource?: FinanceBillingSource; dateBase?: FinanceBillingDateBase }
): string {
  const y = year.trim();
  const params = new URLSearchParams();
  if (y) params.set("year", y);
  params.set("billingSource", options?.billingSource ?? FINANCE_BILLING_SOURCE_DEFAULT);
  if (options?.dateBase) params.set("dateBase", options.dateBase);
  return params.toString();
}
