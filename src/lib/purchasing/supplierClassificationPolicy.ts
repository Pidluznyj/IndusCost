/**
 * Política INTERNA de classificação de desempenho de fornecedores.
 *
 * Regra da própria empresa para leitura executiva das notas já produzidas pelo
 * motor de avaliação (OP-26). É critério interno, versionado para ficar
 * rastreável em auditoria — não é prescrita por norma externa.
 *
 * O que esta política NÃO faz:
 * - não altera a nota do pedido nem a nota consolidada do fornecedor;
 * - não altera pesos, escala ou metodologia de avaliação;
 * - não converte a metodologia anterior (V1, escala 0–10) para a vigente;
 * - não usa valor financeiro;
 * - não deixa a cobertura de avaliação mudar a classificação em silêncio
 *   (cobertura é exibida separadamente, ao lado da classificação).
 *
 * Único ponto de verdade: `classifySupplierPerformance`. Tela, JSON, XLSX e PDF
 * leem o resultado desta função — nenhum consumidor reimplementa a faixa.
 */

import {
  SUPPLIER_EVALUATION_METHODOLOGY_V2,
  SUPPLIER_EVALUATION_METHODOLOGY_V2_MODEL,
} from "./supplierPerformance.js";

export const SUPPLIER_CLASSIFICATION_POLICY_ID = "SUPPLIER_PERFORMANCE_CLASSIFICATION_V1";
export const SUPPLIER_CLASSIFICATION_POLICY_VERSION = 1;

/**
 * Faixas na escala da metodologia vigente (V2, 1 a 5).
 *
 * O corte em 3 vem da própria régua de avaliação: nota 3 é
 * "Atende aos nossos padrões" (`SUPPLIER_EVALUATION_RATING_LABELS`).
 */
export const SUPPLIER_CLASSIFICATION_APPROVED_MIN_SCORE = 3;
export const SUPPLIER_CLASSIFICATION_CONDITIONAL_MIN_SCORE = 2;

export type SupplierClassificationCode =
  | "APPROVED"
  | "CONDITIONAL"
  | "NOT_APPROVED"
  | "NOT_EVALUATED"
  | "LEGACY_METHODOLOGY";

export type SupplierClassification = {
  code: SupplierClassificationCode;
  label: string;
  policyId: string;
  policyVersion: number;
};

export type SupplierClassificationBand = {
  code: SupplierClassificationCode;
  label: string;
  /** Critério objetivo, exibido na legenda da tela e das exportações. */
  rule: string;
};

export const SUPPLIER_CLASSIFICATION_LABELS: Record<SupplierClassificationCode, string> = {
  APPROVED: "Aprovado",
  CONDITIONAL: "Condicional",
  NOT_APPROVED: "Não aprovado",
  NOT_EVALUATED: "Não avaliado",
  LEGACY_METHODOLOGY: "Não classificado (metodologia anterior)",
};

export const SUPPLIER_CLASSIFICATION_BANDS: readonly SupplierClassificationBand[] = [
  {
    code: "APPROVED",
    label: SUPPLIER_CLASSIFICATION_LABELS.APPROVED,
    rule: "Nota geral maior ou igual a 3,00 (escala 1 a 5).",
  },
  {
    code: "CONDITIONAL",
    label: SUPPLIER_CLASSIFICATION_LABELS.CONDITIONAL,
    rule: "Nota geral maior ou igual a 2,00 e menor que 3,00.",
  },
  {
    code: "NOT_APPROVED",
    label: SUPPLIER_CLASSIFICATION_LABELS.NOT_APPROVED,
    rule: "Nota geral menor que 2,00.",
  },
  {
    code: "NOT_EVALUATED",
    label: SUPPLIER_CLASSIFICATION_LABELS.NOT_EVALUATED,
    rule: "Sem avaliação finalizada no período: não recebe nota e não recebe zero.",
  },
  {
    code: "LEGACY_METHODOLOGY",
    label: SUPPLIER_CLASSIFICATION_LABELS.LEGACY_METHODOLOGY,
    rule: "Consolidado formado apenas por avaliações da metodologia anterior (V1, escala 0 a 10): a faixa vigente não se aplica e a nota não é convertida.",
  },
];

/** Texto declarado na tela, no XLSX e no PDF — sem invocar norma externa. */
export const SUPPLIER_CLASSIFICATION_POLICY_TEXT: readonly string[] = [
  "Critério interno da empresa para leitura executiva das notas de avaliação de fornecedores.",
  "A classificação é derivada da nota geral consolidada do fornecedor no período, calculada pelo motor oficial de avaliação.",
  "Aplica-se somente à metodologia vigente (V2, escala 1 a 5, quatro critérios com peso de 25% cada).",
  "Avaliações da metodologia anterior (V1, escala 0 a 10) não são convertidas e não recebem faixa da política vigente.",
  "Valor comprado e número de pedidos são contexto e não entram no cálculo da classificação.",
  "A cobertura de avaliação é informada separadamente e não altera a classificação: pedido sem avaliação não recebe nota zero.",
  "A classificação não bloqueia fornecedor, não altera cadastro e não substitui a situação cadastral.",
];

/**
 * Classificação de desempenho a partir da nota consolidada.
 *
 * `methodologyVersion` é a versão da escala em que a nota foi consolidada
 * (`DashboardSupplierEvaluationDto.methodologyVersion`). Nota consolidada em
 * escala diferente da vigente NUNCA é medida pela faixa 1–5.
 */
export function classifySupplierPerformance(input: {
  overallScore: number | null | undefined;
  methodologyVersion?: number | null;
}): SupplierClassification {
  const policy = {
    policyId: SUPPLIER_CLASSIFICATION_POLICY_ID,
    policyVersion: SUPPLIER_CLASSIFICATION_POLICY_VERSION,
  };
  const build = (code: SupplierClassificationCode): SupplierClassification => ({
    code,
    label: SUPPLIER_CLASSIFICATION_LABELS[code],
    ...policy,
  });

  const score = input.overallScore;
  if (score == null || !Number.isFinite(score)) return build("NOT_EVALUATED");

  const version = input.methodologyVersion ?? SUPPLIER_EVALUATION_METHODOLOGY_V2;
  if (version !== SUPPLIER_EVALUATION_METHODOLOGY_V2) return build("LEGACY_METHODOLOGY");

  if (score >= SUPPLIER_CLASSIFICATION_APPROVED_MIN_SCORE) return build("APPROVED");
  if (score >= SUPPLIER_CLASSIFICATION_CONDITIONAL_MIN_SCORE) return build("CONDITIONAL");
  return build("NOT_APPROVED");
}

/** Escala em que a política vigente é válida — declarada nas exportações. */
export const SUPPLIER_CLASSIFICATION_POLICY_SCALE = {
  methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_V2_MODEL.version,
  methodologyId: SUPPLIER_EVALUATION_METHODOLOGY_V2_MODEL.id,
  scaleMin: SUPPLIER_EVALUATION_METHODOLOGY_V2_MODEL.scaleMin,
  scaleMax: SUPPLIER_EVALUATION_METHODOLOGY_V2_MODEL.scaleMax,
} as const;
