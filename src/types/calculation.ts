/**
 * Contrato padronizado para explicar valores calculados (transparência analítica).
 * Backend é a fonte da verdade textual; o frontend apenas renderiza.
 */

export interface CalculationInputEntry {
  label: string;
  value: string;
}

/** Metadado explicativo de um único número/indicador calculado. */
export interface CalculationExplanation {
  title: string;
  description?: string;
  formulaText?: string;
  inputs?: CalculationInputEntry[];
  resultLabel?: string;
  /** Valor numérico final (espelha o valor exibido quando aplicável). */
  resultValue?: number;
  notes?: string;
  /** Textos de alerta (ex.: warnings do motor de custo). */
  warnings?: string[];
  /** Origem do cálculo (ex.: motor CIU, markup divisor). */
  source?: string;
}

/** Mapa por chave lógica (ex.: campos do summary da análise de custo). */
export type CalculationExplainabilityMap = Record<string, CalculationExplanation>;
