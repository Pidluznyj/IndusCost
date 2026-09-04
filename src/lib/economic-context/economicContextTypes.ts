/**
 * Tipos do contexto econômico (BCB) — seguros para o bundle React.
 * O BCB NÃO é fonte cadastral de CNPJ.
 */

export const ECONOMIC_CONTEXT_DISCLAIMER =
  "Contexto macroeconômico brasileiro (Banco Central). Não é score, rating, risco de crédito nem capacidade de pagamento desta empresa.";

export type EconomicIndicatorCode =
  | "SELIC_TARGET"
  | "IPCA_12M"
  | "USD_PTAX_SELL"
  | "EUR_PTAX_SELL";

export type EconomicIndicatorStatus = "ok" | "unavailable";

export type EconomicIndicatorView = {
  code: EconomicIndicatorCode;
  name: string;
  value: number | null;
  unit: string;
  referenceDate: string | null;
  displayValue: string;
  status: EconomicIndicatorStatus;
  source: string;
};

export type EconomicContextStatus = "ok" | "partial" | "unavailable";

export type EconomicContextPayload = {
  status: EconomicContextStatus;
  fetchedAt: string;
  fromCache: boolean;
  sourceLabel: "Banco Central do Brasil";
  disclaimer: string;
  indicators: EconomicIndicatorView[];
};
