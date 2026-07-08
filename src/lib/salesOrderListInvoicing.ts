/** Rótulos e badges da coluna Faturado (listagem Comercial). */

export function formatSalesOrderListInvoicedLabel(hasInvoice: boolean): string {
  return hasInvoice ? "Sim" : "Não";
}

export function salesOrderListInvoicedBadgeClass(hasInvoice: boolean): string {
  return hasInvoice
    ? "so-invoiced-badge so-invoiced-badge--yes"
    : "so-invoiced-badge so-invoiced-badge--no";
}
