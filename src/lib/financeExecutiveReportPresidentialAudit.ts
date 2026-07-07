/**
 * Matriz estática de auditoria — Relatório Presidencial / Executivo Financeiro e Comercial.
 * Cada indicador mapeia fonte oficial esperada e status de conformidade conhecido.
 */

export type PresidentialAuditStatus =
  | "OK_USA_MOTOR_OFICIAL"
  | "ERRO_CALCULO_PARALELO"
  | "ERRO_FONTE_INCORRETA"
  | "ERRO_FILTRO"
  | "ERRO_DATA"
  | "ERRO_EMPRESA_GRUPO"
  | "ERRO_PROPOSTA_COMO_FONTE"
  | "ERRO_RESPONSIBLE_LEGADO"
  | "PRECISA_VALIDACAO"
  | "NAO_APLICAVEL";

export type PresidentialAuditRow = {
  section: string;
  indicator: string;
  componentOrBuilder: string;
  currentSource: string;
  officialMotor: string;
  status: PresidentialAuditStatus;
  notes?: string;
};

export const PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX: PresidentialAuditRow[] = [
  {
    section: "Resumo",
    indicator: "Faturamento do mês",
    componentOrBuilder: "financeExecutiveReport.ts → billingTab.target.actual",
    currentSource: "buildFinanceBillingDashboard (NF-e processamento)",
    officialMotor: "financeBillingNfeDashboard.ts / buildBillingDashboardFromNfes",
    status: "OK_USA_MOTOR_OFICIAL",
  },
  {
    section: "Resumo",
    indicator: "AR em aberto",
    componentOrBuilder: "buildOfficialAccountsReceivableDashboard",
    currentSource: "NomusAccountsReceivable + rules adapter",
    officialMotor: "financeAccountsReceivableRulesAdapter",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Carteira sem filtro de mês (paridade tela AR).",
  },
  {
    section: "Resumo",
    indicator: "AP em aberto",
    componentOrBuilder: "buildOfficialAccountsPayableDashboard",
    currentSource: "NomusAccountsPayable + rules adapter",
    officialMotor: "financeAccountsPayableRulesAdapter",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Carteira sem filtro de mês; AP por vencimento operacional.",
  },
  {
    section: "Resumo",
    indicator: "Fluxo líquido (período)",
    componentOrBuilder: "buildFinanceCashFlowDashboard",
    currentSource: "AR + AP com dateBase=due",
    officialMotor: "financeCashFlowDashboard.ts",
    status: "OK_USA_MOTOR_OFICIAL",
  },
  {
    section: "Pedidos de Venda",
    indicator: "Vendido mês / YTD / variação / gráfico",
    componentOrBuilder: "buildSalesOrdersDashboardTab → salesOrderRulesEngine",
    currentSource: "SalesOrder + SalesOrderItem (Nomus sync)",
    officialMotor: "salesOrdersDashboardMetrics / salesOrderRulesAdapter",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Não usa Proposal. Paridade com aba Pedidos de Venda.",
  },
  {
    section: "Pedidos de Venda",
    indicator: "Exclusão empresas do grupo (cliente)",
    componentOrBuilder: "salesOrderRulesEngine → applySalesOrderRulesUniverseFilters",
    currentSource: "isSalesOrderMarketCustomer / isGroupCompanyCustomer",
    officialMotor: "groupCompanyCustomer.ts",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Padrão excludeGroupCompanyCustomers=true no motor oficial.",
  },
  {
    section: "Pedidos de Venda",
    indicator: "Filtro empresa (Lazarios/Koppetel/SM)",
    componentOrBuilder: "buildSalesOrdersDashboardTab + salesOrderRulesEngine",
    currentSource: "filters.company → companyIssuer (Prisma + motor)",
    officialMotor: "financeExecutiveReportCompany + financeSalesOrdersDashboard",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Relatório presidencial repassa company ao motor oficial de Pedidos.",
  },
  {
    section: "Faturamento",
    indicator: "Filtro empresa (Lazarios/Koppetel/SM)",
    componentOrBuilder: "buildFinanceBillingDashboard → buildBillingDashboardFromNfes",
    currentSource: "filters.company → cnpjEmitente NF-e",
    officialMotor: "financeBillingNfeDashboard.ts",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Consolidado (all) mantém mercado; empresa específica filtra emitente.",
  },
  {
    section: "Faturamento",
    indicator: "Faturado mês / YTD / comparativo / gráfico",
    componentOrBuilder: "buildFinanceBillingDashboard (nfe, processamento)",
    currentSource: "NomusNfe autorizada",
    officialMotor: "financeBillingNfeDashboard.ts",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "intercompanyExclusionApplied; não confunde com pedidos.",
  },
  {
    section: "Contas a Receber",
    indicator: "Aberto / vencido / recebido mês/YTD / gráfico",
    componentOrBuilder: "financeExecutiveReportDataSources.ts",
    currentSource: "official-accounts-receivable-engine",
    officialMotor: "sumOfficialArReceivedBySettlementInPeriod + dashboard cards",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Exclui contraparte do grupo (customerType=external default).",
  },
  {
    section: "Contas a Pagar",
    indicator: "Aberto / vencido / pago mês/YTD / gráfico",
    componentOrBuilder: "financeExecutiveReportDataSources.ts",
    currentSource: "official-accounts-payable-engine",
    officialMotor: "sumOfficialApPaidInPaymentPeriod + dashboard cards",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Eixo operacional vencimento; pago por data de pagamento.",
  },
  {
    section: "Contas a Pagar",
    indicator: "Card Agendados",
    componentOrBuilder: "AP cards purchaseOrderScheduleAudit",
    currentSource: "Motor AP oficial",
    officialMotor: "financeAccountsPayableRulesAdapter",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Informativo/auditoria — não substitui vencimento no fluxo.",
  },
  {
    section: "Fluxo de Caixa",
    indicator: "Entradas / saídas / saldo / gráfico Jan–Dez",
    componentOrBuilder: "buildFinanceCashFlowDashboard (período + anual)",
    currentSource: "AR + AP; AP por dueDate",
    officialMotor: "financeCashFlowDashboard.ts",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Gráfico anual ignora mês selecionado (12 meses).",
  },
  {
    section: "Fluxo de Caixa",
    indicator: "Radar diário",
    componentOrBuilder: "financeExecutiveReportCashRadar.ts",
    currentSource: "buildCashFlowDailyRadarData",
    officialMotor: "financeCashFlowDailyRadar.ts",
    status: "OK_USA_MOTOR_OFICIAL",
  },
  {
    section: "Centros de Custo",
    indicator: "Gastos por centro (gráfico)",
    componentOrBuilder: "buildFinanceCostCenterDashboardDefault",
    currentSource: "AP alocado por centro",
    officialMotor: "financeCostCenterAnnualSpendingChart.ts",
    status: "OK_USA_MOTOR_OFICIAL",
  },
  {
    section: "Margem / Rentabilidade",
    indicator: "Margem por produto/cliente",
    componentOrBuilder: "—",
    currentSource: "Não renderizado no relatório presidencial",
    officialMotor: "Motor de margem IndusCost (telas de produto/preço)",
    status: "NAO_APLICAVEL",
    notes: "Seção ausente por design; não há cálculo paralelo oculto.",
  },
  {
    section: "Metas",
    indicator: "Meta mês / ano (+30%)",
    componentOrBuilder: "salesOrderDashboardRules / billingDashboardMetrics",
    currentSource: "Derivada (+30% período anterior)",
    officialMotor: "Mesma regra das telas oficiais",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "targetsDerived: true — sem tabela de metas editável.",
  },
  {
    section: "Comissão / Vendedor",
    indicator: "Vendedor nos KPIs",
    componentOrBuilder: "—",
    currentSource: "Não exibido no relatório",
    officialMotor: "SalesOrder.externalSellerId + CommissionPerson",
    status: "NAO_APLICAVEL",
  },
  {
    section: "Propostas",
    indicator: "Qualquer KPI financeiro",
    componentOrBuilder: "financeExecutiveReport.ts",
    currentSource: "Sem import Proposal",
    officialMotor: "N/A",
    status: "OK_USA_MOTOR_OFICIAL",
    notes: "Proposal não é fonte do relatório presidencial.",
  },
];

export function summarizePresidentialAuditMatrix(rows = PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX) {
  const byStatus = new Map<PresidentialAuditStatus, number>();
  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  }
  return {
    total: rows.length,
    byStatus: Object.fromEntries(byStatus) as Record<PresidentialAuditStatus, number>,
    needsAttention: rows.filter(
      (r) =>
        r.status !== "OK_USA_MOTOR_OFICIAL" &&
        r.status !== "NAO_APLICAVEL"
    ),
  };
}
