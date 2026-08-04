/**
 * Contratos tipados (browser-safe) do resultado dos três cenários da Caixa.
 * Reexportados a partir do motor puro para consumo no cliente sem arrastar
 * dependências de servidor.
 */

export type {
  TreasuryScenarioComputationResult,
  TreasuryScenarioConfidence,
  TreasuryScenarioDay,
  TreasuryScenarioDayFacts,
  TreasuryScenarioLabel,
  TreasuryScenarioReasonCode,
  TreasuryScenarioSummary,
  TreasuryScenarioTitleProjection,
} from "./treasuryCaixaScenarios.js";

export { TREASURY_SCENARIO_LABELS } from "./treasuryCaixaScenarios.js";
