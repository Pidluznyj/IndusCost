/**
 * Orquestra a Ponte Lucro × Caixa a partir da DRE oficial.
 * v1 parcial: só o resultado DRE é numérico; demais linhas patrimoniais/caixa = null.
 */

import { buildFinanceDreReport } from "@/src/lib/financeDreService.server.js";
import {
  FINANCE_DRE_CASH_BRIDGE_COVERAGE,
  PERIOD_CASH_MOVEMENTS_ANNEX_NOTE,
  UNAVAILABLE_AS_OF_BALANCE_REASON,
  UNAVAILABLE_BANK_CASH_REASON,
} from "@/src/lib/financeDreCashBridgeCoverage.js";
import {
  buildCashBridgeExplanation,
  computeCashBridgeMateriality,
  finalizeCashBridgeReconciliation,
  sumWorkingCapitalCard,
} from "@/src/lib/financeDreCashBridgeMath.js";
import type {
  CashBridgeLine,
  CashBridgeReport,
  CashBridgeWarning,
} from "@/src/lib/financeDreCashBridgeTypes.js";
import { FINANCE_DRE_CASH_BRIDGE_TIMEZONE } from "@/src/lib/financeDreCashBridgeTypes.js";

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

function unavailableLine(
  id: CashBridgeLine["id"],
  label: string,
  opts: {
    criteria: string;
    sources: string[];
    limitations: string[];
    missingReason: string;
    includeInExplained?: boolean;
    classification?: CashBridgeLine["classification"];
  }
): CashBridgeLine {
  return {
    id,
    label,
    cashEffect: null,
    openingBalance: null,
    closingBalance: null,
    classification: opts.classification ?? "unavailable",
    missingReason: opts.missingReason,
    criteria: opts.criteria,
    sources: opts.sources,
    limitations: opts.limitations,
    lastSyncedAt: null,
    includeInExplained: opts.includeInExplained ?? true,
  };
}

function buildPartialLines(dreNetResult: number): CashBridgeLine[] {
  const dreLine: CashBridgeLine = {
    id: "dre_net_result",
    label: "Resultado líquido (DRE aproximada)",
    cashEffect: dreNetResult,
    openingBalance: null,
    closingBalance: null,
    classification: "available",
    missingReason: null,
    criteria:
      "Usa kpis.lucroLiquidoAproximado da DRE Gerencial no mês destaque (competência emissão NF-e).",
    sources: ["buildFinanceDreReport", "financeDreMath.buildFinanceDreLines"],
    limitations: [
      "Sem resultado financeiro na DRE.",
      "IRPJ/CSLL entram como provisão gerencial estimada (não apuração fiscal).",
    ],
    lastSyncedAt: null,
    includeInExplained: true,
  };

  return [
    dreLine,
    unavailableLine("non_cash_adjustments", "Ajustes sem efeito caixa", {
      criteria: "Depreciação, amortização e provisões sem desembolso.",
      sources: [],
      limitations: ["Sem ledger de imobilizado/depreciação."],
      missingReason: "Fonte de depreciação/provisões inexistente no IndusCost.",
    }),
    unavailableLine("accounts_receivable", "Δ Contas a receber", {
      criteria: "efeitoCR = −(saldoFinal − saldoInicial) as-of início/fim do mês.",
      sources: ["NomusAccountsReceivable.balanceReceivable"],
      limitations: [UNAVAILABLE_AS_OF_BALANCE_REASON],
      missingReason: UNAVAILABLE_AS_OF_BALANCE_REASON,
    }),
    unavailableLine("inventory", "Δ Estoques", {
      criteria: "efeitoEstoque = −(saldoFinal − saldoInicial) valorado as-of.",
      sources: ["InventoryBalance"],
      limitations: [UNAVAILABLE_AS_OF_BALANCE_REASON],
      missingReason: UNAVAILABLE_AS_OF_BALANCE_REASON,
    }),
    unavailableLine("operational_payables", "Δ Fornecedores operacionais", {
      criteria: "efeitoFornecedores = +(saldoFinal − saldoInicial) as-of.",
      sources: ["NomusAccountsPayable"],
      limitations: [UNAVAILABLE_AS_OF_BALANCE_REASON],
      missingReason: UNAVAILABLE_AS_OF_BALANCE_REASON,
    }),
    unavailableLine("other_working_capital", "Outros itens de capital de giro", {
      criteria: "Demais ativos/passivos operacionais identificados.",
      sources: [],
      limitations: ["Sem taxonomia patrimonial completa."],
      missingReason: "Não há mapa oficial de outros itens de CG as-of.",
    }),
    unavailableLine("investments_paid", "Investimentos pagos", {
      criteria: "Desembolsos classificados como investimento (efeito negativo no caixa).",
      sources: ["NomusAccountsPayable", "centros de custo"],
      limitations: [
        "Proxy por CC/keywords; sem evidência de pagamento de ativo vs cadastro.",
      ],
      missingReason:
        "Classificação parcial disponível, mas a v1 não inventa valor de investimento pago sem evidência as-of.",
      classification: "partial",
    }),
    unavailableLine("financing_inflows", "Captações", {
      criteria: "Entradas de financiamento (efeito positivo).",
      sources: [],
      limitations: ["Sem ledger de empréstimo."],
      missingReason: "Sem ledger de captações/empréstimos.",
    }),
    unavailableLine("principal_amortization", "Amortização de principal", {
      criteria: "Saídas de amortização de principal (efeito negativo).",
      sources: [],
      limitations: ["Sem ledger de empréstimo."],
      missingReason: "Sem ledger de amortização de principal.",
    }),
    unavailableLine("distributions", "Distribuições / sócios", {
      criteria: "Distribuições e retiradas (efeito negativo).",
      sources: [],
      limitations: ["Sem ledger de equity."],
      missingReason: "Sem ledger de distribuição/equity.",
    }),
    unavailableLine("other_identified", "Outros efeitos identificados", {
      criteria: "Itens manuais ou identificados fora das linhas padrão.",
      sources: [],
      limitations: ["Vazio na v1."],
      missingReason: "Nenhum outro efeito identificado na v1.",
    }),
    {
      id: "reconciliation_difference",
      label: "Diferença de conciliação (residual)",
      cashEffect: null,
      openingBalance: null,
      closingBalance: null,
      classification: "derived",
      missingReason:
        "Residual só é calculado quando existe variação real de caixa (actualCashVariation).",
      criteria: "residual = actualCashVariation − explainedCashVariation",
      sources: [],
      limitations: [UNAVAILABLE_BANK_CASH_REASON],
      lastSyncedAt: null,
      includeInExplained: false,
    },
    {
      id: "actual_cash_variation",
      label: "Variação real de caixa e bancos",
      cashEffect: null,
      openingBalance: null,
      closingBalance: null,
      classification: "unavailable",
      missingReason: UNAVAILABLE_BANK_CASH_REASON,
      criteria: "Saldo final − saldo inicial de disponibilidades no período.",
      sources: ["financeCashFlowDashboard (hasInitialBankBalance: false)"],
      limitations: [UNAVAILABLE_BANK_CASH_REASON],
      lastSyncedAt: null,
      includeInExplained: false,
    },
  ];
}

export async function buildFinanceDreCashBridgeReport(
  query: Record<string, unknown> = {},
  referenceNow: Date = new Date()
): Promise<CashBridgeReport> {
  const dre = await buildFinanceDreReport(query, referenceNow);
  const dreNetResult = dre.kpis.lucroLiquidoAproximado;
  const receitaLiquida = dre.kpis.receitaLiquida;
  const lines = buildPartialLines(dreNetResult);

  const canReconcile = false;
  const actualCashVariation: number | null = null;
  const hasPartialData = true;

  const reconciliation = finalizeCashBridgeReconciliation({
    canReconcile,
    actualCashVariation,
    lines,
    receitaLiquida,
    hasPartialData,
  });

  // Linha de residual espelha o cálculo (null na v1).
  const residualLine = lines.find((l) => l.id === "reconciliation_difference");
  if (residualLine) {
    residualLine.cashEffect = reconciliation.residual;
  }

  const { missingRevenueWarning } = computeCashBridgeMateriality(receitaLiquida);
  const warnings: CashBridgeWarning[] = [
    {
      code: "IMPLEMENTATION_PARTIAL",
      severity: "warning",
      message:
        "Implementação parcial: conciliação desligada até existir posição histórica de disponibilidades e saldos patrimoniais as-of.",
    },
    {
      code: "NO_BANK_CASH_HISTORY",
      severity: "critical",
      message: UNAVAILABLE_BANK_CASH_REASON,
    },
    {
      code: "NO_AS_OF_BALANCES",
      severity: "warning",
      message: UNAVAILABLE_AS_OF_BALANCE_REASON,
    },
  ];
  if (missingRevenueWarning) {
    warnings.push({
      code: "MATERIALITY_WITHOUT_REVENUE",
      severity: "info",
      message:
        "Receita líquida indisponível para materialidade percentual; usando piso de R$ 1.000.",
    });
  }

  const monthName = MONTH_NAMES[dre.filters.highlightMonth - 1] ?? String(dre.filters.highlightMonth);
  const periodLabel = `${monthName}/${dre.filters.year}`;

  const explanation = buildCashBridgeExplanation({
    dreNetResult,
    canReconcile,
    actualCashVariation,
    explainedCashVariation: reconciliation.explainedCashVariation,
    residual: reconciliation.residual,
    companyLabel: dre.companyLabel,
    periodLabel,
  });

  return {
    schemaVersion: 1,
    title: "Ponte Lucro × Caixa",
    subtitle: `${dre.companyLabel} · ${periodLabel} · timezone ${FINANCE_DRE_CASH_BRIDGE_TIMEZONE}`,
    generatedAt: new Date().toISOString(),
    timezone: FINANCE_DRE_CASH_BRIDGE_TIMEZONE,
    filters: dre.filters,
    companyLabel: dre.companyLabel,
    periodLabel,
    dreNetResult,
    receitaLiquida,
    materialityThreshold: reconciliation.materialityThreshold,
    canReconcile,
    isReconciled: reconciliation.isReconciled,
    badge: reconciliation.badge,
    explainedCashVariation: reconciliation.explainedCashVariation,
    actualCashVariation,
    residual: reconciliation.residual,
    cards: {
      netResult: dreNetResult,
      workingCapitalEffect: sumWorkingCapitalCard(lines),
      investmentsPaid: null,
      actualCashVariation,
    },
    lines,
    coverage: [...FINANCE_DRE_CASH_BRIDGE_COVERAGE],
    explanation,
    warnings,
    periodCashMovementsReference: {
      includedInExplained: false,
      classification: "partial",
      receivablesCollected: null,
      payablesPaid: null,
      netMovements: null,
      note: PERIOD_CASH_MOVEMENTS_ANNEX_NOTE,
      missingReason:
        "Nesta v1 a ponte não embute o dump AR/AP do Fluxo de Caixa para não misturar movimento do período com variação patrimonial. Consulte Financeiro → Fluxo de Caixa.",
      hasInitialBankBalance: false,
      sources: ["financeCashFlowDashboard", "financeCashFlowLedger"],
    },
    implementationStatus: "partial",
  };
}
