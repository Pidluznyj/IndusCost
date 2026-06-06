/** Regras de ação sugerida por cliente (read-only, orientação operacional). */

export function buildCustomerSuggestedAction(input: {
  maxDaysOverdue: number;
  hasSuspendedOpen: boolean;
  overdueAmount: number;
}): string {
  if (input.hasSuspendedOpen) {
    return "Revisar motivo da cobrança suspensa";
  }
  if (input.overdueAmount <= 0 || input.maxDaysOverdue <= 0) {
    return "Acompanhar";
  }
  if (input.maxDaysOverdue <= 7) {
    return "Lembrete leve";
  }
  if (input.maxDaysOverdue <= 15) {
    return "Cobrança ativa";
  }
  if (input.maxDaysOverdue <= 30) {
    return "Contato financeiro/comercial";
  }
  return "Escalonar";
}
