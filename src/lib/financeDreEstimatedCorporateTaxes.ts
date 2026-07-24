/**
 * Estimativa gerencial mensal de IRPJ e CSLL para a DRE Gerencial.
 *
 * Regras desta tela (intencionais e distintas da apuração fiscal):
 * - Cada mês é calculado isoladamente com limite de adicional de R$ 20.000.
 * - YTD = soma das estimativas mensais (não recalcula sobre a base acumulada).
 * - Mês negativo não gera crédito nem compensa outro mês.
 * - Pessoas jurídicas distintas não se compensam; filiais do mesmo CNPJ
 *   devem ser consolidadas antes (aqui cada chave já é um CNPJ).
 *
 * Não substitui DARF, LALUR/LACS, Lucro Presumido/Real nem gera lançamento.
 * Arredondamento alinhado a roundDreMoney (centavos).
 */

function roundDreMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export const FINANCE_DRE_CSLL_RATE = 0.09;
export const FINANCE_DRE_IRPJ_NORMAL_RATE = 0.15;
export const FINANCE_DRE_IRPJ_ADDITIONAL_RATE = 0.1;
/** Limite mensal do adicional de IRPJ (R$) — reaplicado a cada mês e PJ. */
export const FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD = 20_000;

export type EstimatedCorporateIncomeTaxesInput = {
  /** Resultado do mês antes do IRPJ e da CSLL (valores exatos do backend). */
  estimatedTaxBase: number;
};

export type EstimatedCorporateIncomeTaxesResult = {
  estimatedTaxBase: number;
  positiveBase: number;
  /** Sempre 1 nesta estimativa mensal (limite mensal fixo). */
  numberOfMonthsInPeriod: 1;
  estimatedCsll: number;
  estimatedIrpjNormal: number;
  estimatedIrpjAdditionalThreshold: number;
  estimatedIrpjAdditionalBase: number;
  estimatedIrpjAdditional: number;
  estimatedIrpjTotal: number;
  estimatedIrpjCsllProvision: number;
  estimatedNetIncomeAfterTaxes: number;
};

export type FinanceDreEstimatedCorporateTaxesPeriod = EstimatedCorporateIncomeTaxesResult & {
  /** Para o bloco YTD: quantos meses foram somados (1–12). */
  monthsSummed?: number;
  /** Como o período foi obtido. */
  aggregation?: "monthly_independent" | "sum_of_monthly_estimates";
};

export type FinanceDreEstimatedTaxEntityMonth = {
  companyKey: string;
  companyLabel: string;
  /** CNPJ mascarado (nunca completo na UI). */
  cnpjMasked: string;
  /** Resultado do mês (série) e detalhe do cálculo. */
  result: EstimatedCorporateIncomeTaxesResult;
};

export type FinanceDreEstimatedCorporateTaxesBlock = {
  month: FinanceDreEstimatedCorporateTaxesPeriod;
  ytd: FinanceDreEstimatedCorporateTaxesPeriod;
  /** Séries mensais (valores positivos de provisão — a grade aplica sinal negativo). */
  csllByMonth: number[];
  irpjByMonth: number[];
  irpjNormalByMonth: number[];
  irpjAdditionalByMonth: number[];
  provisionByMonth: number[];
  /** YTD = soma das provisões mensais até o mês destaque. */
  csllYtd: number;
  irpjYtd: number;
  provisionYtd: number;
  baseSource: "resultado_operacional";
  includesFinancialResult: false;
  consolidationMode: "single_legal_entity" | "per_legal_entity";
  ytdMethod: "sum_of_monthly_estimates";
  /** Decomposição do mês destaque por pessoa jurídica (quando multi-PJ). */
  entitiesHighlightMonth: FinanceDreEstimatedTaxEntityMonth[];
  disclaimer: string;
};

export const FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER =
  "Esta é uma estimativa gerencial mensal baseada no resultado contábil antes de IRPJ e CSLL. " +
  "O valor não representa necessariamente o DARF do mês. A apuração fiscal efetiva pode variar " +
  "conforme o regime tributário (Lucro Real/Presumido), ajustes fiscais, compensações, incentivos, " +
  "retenções e periodicidade de apuração. Cada mês é estimado de forma independente " +
  "(limite de adicional de R$ 20.000 por mês e por pessoa jurídica); o YTD soma essas estimativas mensais.";

export type FinanceDreTaxEntitySeries = {
  companyKey: string;
  companyLabel: string;
  cnpjDigits: string;
  /** Resultado operacional mensal (12 posições). */
  baseByMonth: readonly number[];
};

/**
 * Função canônica mensal: CSLL 9% + IRPJ 15% + adicional 10% sobre excedente de R$ 20.000.
 * CSLL não reduz a base do IRPJ. Base ≤ 0 → provisões zero (sem benefício fiscal).
 */
export function calculateEstimatedCorporateIncomeTaxes(
  input: EstimatedCorporateIncomeTaxesInput
): EstimatedCorporateIncomeTaxesResult {
  const estimatedTaxBase = roundDreMoney(input.estimatedTaxBase);
  const positiveBase = estimatedTaxBase > 0 ? estimatedTaxBase : 0;
  const estimatedIrpjAdditionalThreshold = FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD;

  if (positiveBase <= 0) {
    return {
      estimatedTaxBase,
      positiveBase: 0,
      numberOfMonthsInPeriod: 1,
      estimatedCsll: 0,
      estimatedIrpjNormal: 0,
      estimatedIrpjAdditionalThreshold,
      estimatedIrpjAdditionalBase: 0,
      estimatedIrpjAdditional: 0,
      estimatedIrpjTotal: 0,
      estimatedIrpjCsllProvision: 0,
      estimatedNetIncomeAfterTaxes: estimatedTaxBase,
    };
  }

  const estimatedCsll = roundDreMoney(positiveBase * FINANCE_DRE_CSLL_RATE);
  const estimatedIrpjNormal = roundDreMoney(positiveBase * FINANCE_DRE_IRPJ_NORMAL_RATE);
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
    numberOfMonthsInPeriod: 1,
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
    return calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 0 });
  }

  let estimatedTaxBase = 0;
  let positiveBase = 0;
  let estimatedCsll = 0;
  let estimatedIrpjNormal = 0;
  let estimatedIrpjAdditionalBase = 0;
  let estimatedIrpjAdditional = 0;
  let estimatedIrpjTotal = 0;
  let estimatedIrpjCsllProvision = 0;

  for (const part of parts) {
    estimatedTaxBase += part.estimatedTaxBase;
    positiveBase += part.positiveBase;
    estimatedCsll += part.estimatedCsll;
    estimatedIrpjNormal += part.estimatedIrpjNormal;
    estimatedIrpjAdditionalBase += part.estimatedIrpjAdditionalBase;
    estimatedIrpjAdditional += part.estimatedIrpjAdditional;
    estimatedIrpjTotal += part.estimatedIrpjTotal;
    estimatedIrpjCsllProvision += part.estimatedIrpjCsllProvision;
  }

  return {
    estimatedTaxBase: roundDreMoney(estimatedTaxBase),
    positiveBase: roundDreMoney(positiveBase),
    numberOfMonthsInPeriod: 1,
    estimatedCsll: roundDreMoney(estimatedCsll),
    estimatedIrpjNormal: roundDreMoney(estimatedIrpjNormal),
    estimatedIrpjAdditionalThreshold: FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD,
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

function sumThroughMonth(byMonth: readonly number[], highlightMonth: number): number {
  const end = Math.min(12, Math.max(1, highlightMonth));
  let sum = 0;
  for (let i = 0; i < end; i += 1) sum += byMonth[i] ?? 0;
  return roundDreMoney(sum);
}

export function maskFinanceDreCnpj(digits: string): string {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length !== 14) return "**.***.***/****-**";
  return `${d.slice(0, 2)}.***.***/****-${d.slice(12)}`;
}

/**
 * Consolida unidades/filiais do mesmo CNPJ antes do cálculo tributário.
 * Chave oficial = dígitos do CNPJ (não o nome exibido).
 */
export function consolidateFinanceDreTaxEntitiesByCnpj(
  entities: readonly FinanceDreTaxEntitySeries[]
): FinanceDreTaxEntitySeries[] {
  if (entities.length <= 1) return [...entities];

  const byKey = new Map<string, FinanceDreTaxEntitySeries>();
  for (const entity of entities) {
    const cnpj = String(entity.cnpjDigits ?? "").replace(/\D/g, "");
    const groupKey = cnpj.length === 14 ? cnpj : `name:${entity.companyKey}`;
    const existing = byKey.get(groupKey);
    if (!existing) {
      byKey.set(groupKey, {
        companyKey: cnpj.length === 14 ? cnpj : entity.companyKey,
        companyLabel: entity.companyLabel,
        cnpjDigits: cnpj,
        baseByMonth: [...entity.baseByMonth],
      });
      continue;
    }
    const merged = emptySeries();
    for (let i = 0; i < 12; i += 1) {
      merged[i] = roundDreMoney(
        (existing.baseByMonth[i] ?? 0) + (entity.baseByMonth[i] ?? 0)
      );
    }
    byKey.set(groupKey, {
      ...existing,
      companyLabel:
        existing.companyLabel === entity.companyLabel
          ? existing.companyLabel
          : `${existing.companyLabel} + ${entity.companyLabel}`,
      baseByMonth: merged,
    });
  }
  return [...byKey.values()];
}

/**
 * Monta séries mensais e YTD a partir das bases por pessoa jurídica.
 * YTD = soma das estimativas mensais independentes (não recalcula sobre base acumulada).
 */
export function buildEstimatedCorporateTaxSeriesFromEntityBases(
  entities: readonly FinanceDreTaxEntitySeries[],
  highlightMonth: number,
  consolidationMode: FinanceDreEstimatedCorporateTaxesBlock["consolidationMode"]
): FinanceDreEstimatedCorporateTaxesBlock {
  const m = Math.min(12, Math.max(1, highlightMonth || 1));
  const list =
    entities.length > 0
      ? consolidateFinanceDreTaxEntitiesByCnpj(entities)
      : [
          {
            companyKey: "unknown",
            companyLabel: "Empresa",
            cnpjDigits: "",
            baseByMonth: emptySeries(),
          },
        ];

  const csllByMonth = emptySeries();
  const irpjByMonth = emptySeries();
  const irpjNormalByMonth = emptySeries();
  const irpjAdditionalByMonth = emptySeries();
  const provisionByMonth = emptySeries();
  const baseByMonth = emptySeries();
  const positiveBaseByMonth = emptySeries();
  const additionalBaseByMonth = emptySeries();
  const netByMonth = emptySeries();

  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    const monthParts = list.map((entity) =>
      calculateEstimatedCorporateIncomeTaxes({
        estimatedTaxBase: entity.baseByMonth[monthIdx] ?? 0,
      })
    );
    const monthSum = sumEstimatedCorporateIncomeTaxes(monthParts);
    csllByMonth[monthIdx] = monthSum.estimatedCsll;
    irpjByMonth[monthIdx] = monthSum.estimatedIrpjTotal;
    irpjNormalByMonth[monthIdx] = monthSum.estimatedIrpjNormal;
    irpjAdditionalByMonth[monthIdx] = monthSum.estimatedIrpjAdditional;
    provisionByMonth[monthIdx] = monthSum.estimatedIrpjCsllProvision;
    baseByMonth[monthIdx] = monthSum.estimatedTaxBase;
    // Soma das bases positivas por PJ (não max(0, consolidado) — evita compensação cruzada).
    positiveBaseByMonth[monthIdx] = monthSum.positiveBase;
    additionalBaseByMonth[monthIdx] = monthSum.estimatedIrpjAdditionalBase;
    netByMonth[monthIdx] = monthSum.estimatedNetIncomeAfterTaxes;
  }

  const entitiesHighlightMonth: FinanceDreEstimatedTaxEntityMonth[] = list.map((entity) => ({
    companyKey: entity.companyKey,
    companyLabel: entity.companyLabel,
    cnpjMasked: maskFinanceDreCnpj(entity.cnpjDigits),
    result: calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: entity.baseByMonth[m - 1] ?? 0,
    }),
  }));

  const month: FinanceDreEstimatedCorporateTaxesPeriod = {
    ...sumEstimatedCorporateIncomeTaxes(entitiesHighlightMonth.map((e) => e.result)),
    aggregation: "monthly_independent",
    monthsSummed: 1,
  };

  const ytd: FinanceDreEstimatedCorporateTaxesPeriod = {
    estimatedTaxBase: sumThroughMonth(baseByMonth, m),
    positiveBase: sumThroughMonth(positiveBaseByMonth, m),
    numberOfMonthsInPeriod: 1,
    estimatedCsll: sumThroughMonth(csllByMonth, m),
    estimatedIrpjNormal: sumThroughMonth(irpjNormalByMonth, m),
    estimatedIrpjAdditionalThreshold: FINANCE_DRE_IRPJ_ADDITIONAL_MONTHLY_THRESHOLD,
    estimatedIrpjAdditionalBase: sumThroughMonth(additionalBaseByMonth, m),
    estimatedIrpjAdditional: sumThroughMonth(irpjAdditionalByMonth, m),
    estimatedIrpjTotal: sumThroughMonth(irpjByMonth, m),
    estimatedIrpjCsllProvision: sumThroughMonth(provisionByMonth, m),
    estimatedNetIncomeAfterTaxes: sumThroughMonth(netByMonth, m),
    aggregation: "sum_of_monthly_estimates",
    monthsSummed: m,
  };

  return {
    month,
    ytd,
    csllByMonth,
    irpjByMonth,
    irpjNormalByMonth,
    irpjAdditionalByMonth,
    provisionByMonth,
    csllYtd: ytd.estimatedCsll,
    irpjYtd: ytd.estimatedIrpjTotal,
    provisionYtd: ytd.estimatedIrpjCsllProvision,
    baseSource: "resultado_operacional",
    includesFinancialResult: false,
    consolidationMode,
    ytdMethod: "sum_of_monthly_estimates",
    entitiesHighlightMonth,
    disclaimer: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
  };
}

export function buildEstimatedCorporateTaxSeriesFromSingleBase(
  baseByMonth: readonly number[],
  highlightMonth: number,
  meta?: { companyKey?: string; companyLabel?: string; cnpjDigits?: string }
): FinanceDreEstimatedCorporateTaxesBlock {
  return buildEstimatedCorporateTaxSeriesFromEntityBases(
    [
      {
        companyKey: meta?.companyKey ?? "single",
        companyLabel: meta?.companyLabel ?? "Empresa",
        cnpjDigits: meta?.cnpjDigits ?? "",
        baseByMonth,
      },
    ],
    highlightMonth,
    "single_legal_entity"
  );
}
