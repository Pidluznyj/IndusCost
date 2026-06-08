/** Regras de ação sugerida por fornecedor (read-only, orientação operacional). */

export function buildSupplierSuggestedAction(input: {
  maxDaysOverdue: number;
  hasSuspendedOpen: boolean;
  overdueAmount: number;
}): string {
  if (input.hasSuspendedOpen) {
    return "Revisar bloqueio de pagamento";
  }
  if (input.overdueAmount <= 0 || input.maxDaysOverdue <= 0) {
    return "Programar pagamento";
  }
  if (input.maxDaysOverdue <= 7) {
    return "Priorizar conferência";
  }
  if (input.maxDaysOverdue <= 15) {
    return "Avaliar multa/juros";
  }
  if (input.maxDaysOverdue <= 30) {
    return "Negociar fornecedor";
  }
  return "Escalonar financeiro/diretoria";
}
