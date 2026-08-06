/**
 * Política centralizada dos cenários por VOLUME DE VENDAS (client-safe).
 *
 * Único lugar onde os percentuais ±20% e os parâmetros de conversão
 * venda→caixa vivem — nunca espalhar números mágicos pelos arquivos.
 * Configurável no backend (defaults aqui; persistência/admin UI é pendência
 * documentada, seguindo o mesmo caminho da TreasuryScenarioPolicy).
 */

export type TreasurySalesVolumeBaselineSource =
  | "COMMERCIAL_FORECAST" // previsão comercial oficial (não existe hoje)
  | "SALES_HISTORY" // histórico de Pedidos de Venda (padrão)
  | "MANUAL"; // volume mensal configurado manualmente

export type TreasurySalesVolumeScenarioPolicy = {
  /** Variação Otimista sobre a base de vendas, em % (padrão +20). */
  optimisticSalesVariationPct: number;
  /** Variação Pessimista sobre a base de vendas, em % (padrão −20). */
  pessimisticSalesVariationPct: number;
  baselineSource: TreasurySalesVolumeBaselineSource;
  /** Meses COMPLETOS de histórico para a base (mês corrente fica fora). */
  lookbackMonths: number;
  /** Sazonalidade mensal — v1 desligada (média simples documentada). */
  useSeasonality: boolean;
  /** Converter variação de vendas também em saídas variáveis. */
  includeVariableCosts: boolean;
  /**
   * Fallbacks de prazo (dias corridos após a venda de referência) usados
   * SOMENTE quando não há fonte oficial mensurável — sempre declarados na
   * memória/premissas como "parâmetro configurável".
   */
  defaultReceiptLagDays: number;
  defaultRawMaterialLagDays: number;
  defaultTaxLagDays: number;
  defaultCommissionLagDays: number;
  defaultFreightLagDays: number;
};

export const TREASURY_SALES_VOLUME_SCENARIO_POLICY_DEFAULTS: TreasurySalesVolumeScenarioPolicy =
  {
    optimisticSalesVariationPct: 20,
    pessimisticSalesVariationPct: -20,
    baselineSource: "SALES_HISTORY",
    lookbackMonths: 6,
    useSeasonality: false,
    includeVariableCosts: true,
    defaultReceiptLagDays: 45,
    defaultRawMaterialLagDays: 21,
    defaultTaxLagDays: 40,
    defaultCommissionLagDays: 60,
    defaultFreightLagDays: 30,
  };
