/**
 * Matemática pura da Ponte Lucro × Caixa — sem I/O.
 * Regras de sinal (quando saldos disponíveis):
 *   efeitoCR = -(final - inicial)
 *   efeitoEstoque = -(final - inicial)
 *   efeitoFornecedores = +(final - inicial)
 */

import type {
  CashBridgeLine,
  CashBridgeLineId,
  CashBridgeReconciliationBadge,
  CashBridgeReport,
  CashBridgeWorkingCapitalBalances,
} from "@/src/lib/financeDreCashBridgeTypes.js";

const DEFAULT_MATERIALITY_FLOOR = 1000;

export function roundCashBridgeMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Materialidade = max(1000, 1% × receita líquida); sem receita → 1000 + warning. */
export function computeCashBridgeMateriality(receitaLiquida: number | null | undefined): {
  threshold: number;
  missingRevenueWarning: boolean;
} {
  if (receitaLiquida == null || !Number.isFinite(receitaLiquida)) {
    return { threshold: DEFAULT_MATERIALITY_FLOOR, missingRevenueWarning: true };
  }
  const pct = Math.abs(receitaLiquida) * 0.01;
  return {
    threshold: roundCashBridgeMoney(Math.max(DEFAULT_MATERIALITY_FLOOR, pct)),
    missingRevenueWarning: false,
  };
}

export function effectFromBalanceDelta(
  opening: number | null | undefined,
  closing: number | null | undefined,
  sign: "asset" | "liability"
): number | null {
  if (opening == null || closing == null) return null;
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) return null;
  const delta = closing - opening;
  const effect = sign === "asset" ? -delta : delta;
  return roundCashBridgeMoney(effect);
}

export function computeWorkingCapitalEffects(balances: CashBridgeWorkingCapitalBalances): {
  accountsReceivable: number | null;
  inventory: number | null;
  operationalPayables: number | null;
  total: number | null;
} {
  const accountsReceivable = effectFromBalanceDelta(
    balances.accountsReceivableOpening,
    balances.accountsReceivableClosing,
    "asset"
  );
  const inventory = effectFromBalanceDelta(
    balances.inventoryOpening,
    balances.inventoryClosing,
    "asset"
  );
  const operationalPayables = effectFromBalanceDelta(
    balances.payablesOpening,
    balances.payablesClosing,
    "liability"
  );
  const parts = [accountsReceivable, inventory, operationalPayables];
  if (parts.every((p) => p == null)) {
    return { accountsReceivable, inventory, operationalPayables, total: null };
  }
  const total = roundCashBridgeMoney(
    parts.reduce<number>((sum, p) => sum + (p ?? 0), 0)
  );
  return { accountsReceivable, inventory, operationalPayables, total };
}

export function sumExplainedCashVariation(lines: readonly CashBridgeLine[]): number | null {
  const included = lines.filter((l) => l.includeInExplained && l.cashEffect != null);
  if (included.length === 0) return null;
  return roundCashBridgeMoney(included.reduce((sum, l) => sum + (l.cashEffect as number), 0));
}

/**
 * Residual só quando há variação real de caixa.
 * residual = actualCash - explained
 */
export function computeCashBridgeResidual(
  actualCashVariation: number | null | undefined,
  explainedCashVariation: number | null | undefined
): number | null {
  if (actualCashVariation == null || !Number.isFinite(actualCashVariation)) return null;
  if (explainedCashVariation == null || !Number.isFinite(explainedCashVariation)) return null;
  return roundCashBridgeMoney(actualCashVariation - explainedCashVariation);
}

export function resolveCashBridgeBadge(input: {
  canReconcile: boolean;
  isReconciled: boolean;
  hasPartialData: boolean;
}): CashBridgeReconciliationBadge {
  if (input.canReconcile && input.isReconciled) return "reconciled";
  if (input.hasPartialData || !input.canReconcile) return "partial_data";
  return "not_reconciled";
}

export function resolveIsReconciled(input: {
  canReconcile: boolean;
  residual: number | null;
  materialityThreshold: number;
}): boolean {
  if (!input.canReconcile) return false;
  if (input.residual == null || !Number.isFinite(input.residual)) return false;
  return Math.abs(input.residual) <= input.materialityThreshold;
}

/** Moeda da tabela: null → "—"; negativos entre parênteses. */
export function formatCashBridgeAccountingMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (value < 0) return `(${formatted})`;
  return formatted;
}

export function cashBridgeBadgeLabel(badge: CashBridgeReconciliationBadge): string {
  switch (badge) {
    case "reconciled":
      return "Conciliado";
    case "not_reconciled":
      return "Não conciliado";
    case "partial_data":
      return "Dados parciais";
    default:
      return "Dados parciais";
  }
}

export function buildCashBridgeExplanation(input: {
  dreNetResult: number;
  canReconcile: boolean;
  actualCashVariation: number | null;
  explainedCashVariation: number | null;
  residual: number | null;
  companyLabel: string;
  periodLabel: string;
}): string {
  const resultWord = input.dreNetResult >= 0 ? "lucro líquido aproximado" : "prejuízo líquido aproximado";
  const resultFmt = formatCashBridgeAccountingMoney(input.dreNetResult);
  const parts: string[] = [
    `No período ${input.periodLabel} (${input.companyLabel}), a DRE Gerencial aponta ${resultWord} de ${resultFmt}.`,
  ];

  if (!input.canReconcile || input.actualCashVariation == null) {
    parts.push(
      "A variação real de caixa e bancos não pode ser conciliada: o IndusCost não possui saldo bancário histórico nem snapshots patrimoniais as-of (contas a receber, estoques e fornecedores)."
    );
    parts.push(
      "Linhas de capital de giro, investimentos e financiamento permanecem indisponíveis (null), sem substituir ausência por zero."
    );
  } else {
    const explainedFmt = formatCashBridgeAccountingMoney(input.explainedCashVariation);
    const actualFmt = formatCashBridgeAccountingMoney(input.actualCashVariation);
    const residualFmt = formatCashBridgeAccountingMoney(input.residual);
    parts.push(
      `Variação de caixa explicada: ${explainedFmt}. Variação real: ${actualFmt}. Residual: ${residualFmt}.`
    );
  }

  parts.push(
    "Movimentos de recebimentos e pagamentos do período, quando exibidos no anexo, são apenas referência operacional e não entram na soma patrimonial."
  );

  return parts.join(" ");
}

export function findCashBridgeLine(
  lines: readonly CashBridgeLine[],
  id: CashBridgeLineId
): CashBridgeLine | undefined {
  return lines.find((l) => l.id === id);
}

/** Soma efeitos de CG quando ao menos um componente numérico existe; senão null. */
export function sumWorkingCapitalCard(
  lines: readonly CashBridgeLine[]
): number | null {
  const ids: CashBridgeLineId[] = [
    "accounts_receivable",
    "inventory",
    "operational_payables",
    "other_working_capital",
  ];
  const effects = ids.map((id) => findCashBridgeLine(lines, id)?.cashEffect ?? null);
  if (effects.every((e) => e == null)) return null;
  return roundCashBridgeMoney(effects.reduce<number>((s, e) => s + (e ?? 0), 0));
}

export function assertCashBridgeNullNotZero(
  value: number | null | undefined
): value is null | undefined {
  return value == null;
}

/** Helper de teste/fixture: monta residual + badge a partir de um esqueleto. */
export function finalizeCashBridgeReconciliation(input: {
  canReconcile: boolean;
  actualCashVariation: number | null;
  lines: CashBridgeLine[];
  receitaLiquida: number | null;
  hasPartialData: boolean;
}): Pick<
  CashBridgeReport,
  | "explainedCashVariation"
  | "residual"
  | "isReconciled"
  | "badge"
  | "materialityThreshold"
> {
  const { threshold } = computeCashBridgeMateriality(input.receitaLiquida);
  const explainedCashVariation = sumExplainedCashVariation(input.lines);
  const residual = computeCashBridgeResidual(
    input.actualCashVariation,
    explainedCashVariation
  );
  const isReconciled = resolveIsReconciled({
    canReconcile: input.canReconcile,
    residual,
    materialityThreshold: threshold,
  });
  const badge = resolveCashBridgeBadge({
    canReconcile: input.canReconcile,
    isReconciled,
    hasPartialData: input.hasPartialData,
  });
  return {
    explainedCashVariation,
    residual,
    isReconciled,
    badge,
    materialityThreshold: threshold,
  };
}
