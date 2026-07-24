/**
 * Provisões estimadas de IRPJ e CSLL para o DRE gerencial.
 * Estimativa gerencial — não substitui a apuração fiscal (LALUR/LACS, adições, exclusões, etc.).
 * Arredondamento alinhado a roundDreMoney (centavos).
 */

function roundDreMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export const FINANCE_DRE_CSLL_RATE = 0.09;
export const FINANCE_DRE_IRPJ_NORMAL_RATE = 0.15;
export const FINANCE_DRE_IRPJ_ADDITIONAL_RATE = 0.1;
/** Limite mensal do adicional de IRPJ (R$). */
export const FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD = 20_000;

export type EstimatedCorporateIncomeTaxesInput = {
  /** Resultado antes do IRPJ e da CSLL (valores monetários exatos do backend). */
  estimatedTaxBase: number;
  /** Meses do período: 1 no mês; número do mês selecionado no YTD. */
  numberOfMonthsInPeriod: number;
};

export type EstimatedCorporateIncomeTaxesResult = {
  estimatedTaxBase: number;
  positiveBase: number;
  numberOfMonthsInPeriod: number;
  estimatedCsll: number;
  estimatedIrpjNormal: number;
  estimatedIrpjAdditionalThreshold: number;
  estimatedIrpjAdditionalBase: number;
  estimatedIrpjAdditional: number;
  estimatedIrpjTotal: number;
  estimatedIrpjCsllProvision: number;
  estimatedNetIncomeAfterTaxes: number;
};

export type FinanceDreEstimatedCorporateTaxesPeriod = EstimatedCorporateIncomeTaxesResult;

export type FinanceDreEstimatedCorporateTaxesBlock = {
  month: FinanceDreEstimatedCorporateTaxesPeriod;
  ytd: FinanceDreEstimatedCorporateTaxesPeriod;
  /** Séries mensais (valores positivos de provisão — a grade aplica sinal negativo). */
  csllByMonth: number[];
  irpjByMonth: number[];
  provisionByMonth: number[];
  /** YTD recalculado sobre a base acumulada (não é soma das provisões mensais). */
  csllYtd: number;
  irpjYtd: number;
  provisionYtd: number;
  baseSource: "resultado_operacional";
  includesFinancialResult: false;
  consolidationMode: "single_legal_entity" | "per_legal_entity";
  disclaimer: string;
};

export const FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER =
  "IRPJ e CSLL são estimativas gerenciais calculadas sobre o resultado contábil apresentado. A apuração fiscal efetiva pode variar em razão de ajustes fiscais, compensações, incentivos e retenções.";

function clampMonths(months: number): number {
  if (!Number.isFinite(months)) return 1;
  return Math.min(12, Math.max(1, Math.trunc(months)));
}

/**
 * Função canônica: CSLL 9% + IRPJ 15% + adicional 10% sobre excedente de R$ 20.000 × meses.
 * CSLL não reduz a base do IRPJ. Base ≤ 0 → provisões zero (sem benefício fiscal).
 */
export function calculateEstimatedCorporateIncomeTaxes(
  input: EstimatedCorporateIncomeTaxesInput
): EstimatedCorporateIncomeTaxesResult {
  const estimatedTaxBase = roundDreMoney(input.estimatedTaxBase);
  const numberOfMonthsInPeriod = clampMonths(input.numberOfMonthsInPeriod);
  const positiveBase = estimatedTaxBase > 0 ? estimatedTaxBase : 0;

  if (positiveBase <= 0) {
    return {
      estimatedTaxBase,
      positiveBase: 0,
      numberOfMonthsInPeriod,
      estimatedCsll: 0,
      estimatedIrpjNormal: 0,
      estimatedIrpjAdditionalThreshold: roundDreMoney(
        FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD * numberOfMonthsInPeriod
      ),
      estimatedIrpjAdditionalBase: 0,
      estimatedIrpjAdditional: 0,
      estimatedIrpjTotal: 0,
      estimatedIrpjCsllProvision: 0,
      estimatedNetIncomeAfterTaxes: estimatedTaxBase,
    };
  }

  const estimatedCsll = roundDreMoney(positiveBase * FINANCE_DRE_CSLL_RATE);
  const estimatedIrpjNormal = roundDreMoney(positiveBase * FINANCE_DRE_IRPJ_NORMAL_RATE);
  const estimatedIrpjAdditionalThreshold = roundDreMoney(
    FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD * numberOfMonthsInPeriod
  );
  const estimatedIrpjAdditionalBase = roundDreMoney(
    Math.max(0, positiveBase - estimatedIrpjAdditionalThreshold)
  );
  const estimatedIrpjAdditional = roundDreMoney(
    estimatedIrpjAdditionalBase * FINANCE_DRE_IRPJ_ADDITIONAL_RATE
  );
  const estimatedIrpjTotal = roundDreMoney(estimatedIrpjNormal + estimatedIrpjAdditional);
  const estimatedIrpjCsllProvision = roundDreMoney(estimatedCsll + estimatedIrpjTotal);
  const estimatedNetIncomeAfterTaxes = roundDreMoney(
    estimatedTaxBase - estimatedIrpjCsllProvision
  );

  return {
    estimatedTaxBase,
    positiveBase,
    numberOfMonthsInPeriod,
    estimatedCsll,
    estimatedIrpjNormal,
    estimatedIrpjAdditionalThreshold,
    estimatedIrpjAdditionalBase,
    estimatedIrpjAdditional,
    estimatedIrpjTotal,
    estimatedIrpjCsllProvision,
    estimatedNetIncomeAfterTaxes,
  };
}

/** Soma provisões de várias pessoas jurídicas (sem compensar lucro × prejuízo). */
export function sumEstimatedCorporateIncomeTaxes(
  parts: readonly EstimatedCorporateIncomeTaxesResult[]
): EstimatedCorporateIncomeTaxesResult {
  if (parts.length === 0) {
    return calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 0,
      numberOfMonthsInPeriod: 1,
    });
  }

  const numberOfMonthsInPeriod = parts[0]!.numberOfMonthsInPeriod;
  let estimatedTaxBase = 0;
  let positiveBase = 0;
  let estimatedCsll = 0;
  let estimatedIrpjNormal = 0;
  let estimatedIrpjAdditionalBase = 0;
  let estimatedIrpjAdditional = 0;
  let estimatedIrpjTotal = 0;
  let estimatedIrpjCsllProvision = 0;
  let thresholdSum = 0;

  for (const part of parts) {
    estimatedTaxBase += part.estimatedTaxBase;
    positiveBase += part.positiveBase;
    estimatedCsll += part.estimatedCsll;
    estimatedIrpjNormal += part.estimatedIrpjNormal;
    estimatedIrpjAdditionalBase += part.estimatedIrpjAdditionalBase;
    estimatedIrpjAdditional += part.estimatedIrpjAdditional;
    estimatedIrpjTotal += part.estimatedIrpjTotal;
    estimatedIrpjCsllProvision += part.estimatedIrpjCsllProvision;
    thresholdSum += part.estimatedIrpjAdditionalThreshold;
  }

  return {
    estimatedTaxBase: roundDreMoney(estimatedTaxBase),
    positiveBase: roundDreMoney(positiveBase),
    numberOfMonthsInPeriod,
    estimatedCsll: roundDreMoney(estimatedCsll),
    estimatedIrpjNormal: roundDreMoney(estimatedIrpjNormal),
    estimatedIrpjAdditionalThreshold: roundDreMoney(thresholdSum),
    estimatedIrpjAdditionalBase: roundDreMoney(estimatedIrpjAdditionalBase),
    estimatedIrpjAdditional: roundDreMoney(estimatedIrpjAdditional),
    estimatedIrpjTotal: roundDreMoney(estimatedIrpjTotal),
    estimatedIrpjCsllProvision: roundDreMoney(estimatedIrpjCsllProvision),
    estimatedNetIncomeAfterTaxes: roundDreMoney(
      estimatedTaxBase - estimatedIrpjCsllProvision
    ),
  };
}

function emptySeries(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

function ytdBase(byMonth: readonly number[], highlightMonth: number): number {
  const end = Math.min(12, Math.max(1, highlightMonth));
  let sum = 0;
  for (let i = 0; i < end; i += 1) sum += byMonth[i] ?? 0;
  return roundDreMoney(sum);
}

/**
 * Monta séries mensais e detalhe mês/YTD a partir das bases por pessoa jurídica.
 * YTD usa a base acumulada com numberOfMonthsInPeriod = mês selecionado (não soma as provisões mensais).
 */
export function buildEstimatedCorporateTaxSeriesFromEntityBases(
  basesByEntity: readonly (readonly number[])[],
  highlightMonth: number,
  consolidationMode: FinanceDreEstimatedCorporateTaxesBlock["consolidationMode"]
): FinanceDreEstimatedCorporateTaxesBlock {
  const m = Math.min(12, Math.max(1, highlightMonth || 1));
  const entities =
    basesByEntity.length > 0
      ? basesByEntity
      : [emptySeries()];

  const csllByMonth = emptySeries();
  const irpjByMonth = emptySeries();
  const provisionByMonth = emptySeries();

  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    const monthParts = entities.map((series) =>
      calculateEstimatedCorporateIncomeTaxes({
        estimatedTaxBase: series[monthIdx] ?? 0,
        numberOfMonthsInPeriod: 1,
      })
    );
    const monthSum = sumEstimatedCorporateIncomeTaxes(monthParts);
    csllByMonth[monthIdx] = monthSum.estimatedCsll;
    irpjByMonth[monthIdx] = monthSum.estimatedIrpjTotal;
    provisionByMonth[monthIdx] = monthSum.estimatedIrpjCsllProvision;
  }

  const ytdParts = entities.map((series) =>
    calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: ytdBase(series, m),
      numberOfMonthsInPeriod: m,
    })
  );
  const ytd = sumEstimatedCorporateIncomeTaxes(ytdParts);

  const monthPartsHighlight = entities.map((series) =>
    calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: series[m - 1] ?? 0,
      numberOfMonthsInPeriod: 1,
    })
  );
  const month = sumEstimatedCorporateIncomeTaxes(monthPartsHighlight);

  return {
    month,
    ytd,
    csllByMonth,
    irpjByMonth,
    provisionByMonth,
    csllYtd: ytd.estimatedCsll,
    irpjYtd: ytd.estimatedIrpjTotal,
    provisionYtd: ytd.estimatedIrpjCsllProvision,
    baseSource: "resultado_operacional",
    includesFinancialResult: false,
    consolidationMode,
    disclaimer: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
  };
}

export function buildEstimatedCorporateTaxSeriesFromSingleBase(
  baseByMonth: readonly number[],
  highlightMonth: number
): FinanceDreEstimatedCorporateTaxesBlock {
  return buildEstimatedCorporateTaxSeriesFromEntityBases(
    [baseByMonth],
    highlightMonth,
    "single_legal_entity"
  );
}
