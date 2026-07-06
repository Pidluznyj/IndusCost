/** Constantes e opções de UI — sem Prisma (safe para import no frontend). */

export const FINANCE_AP_UNIDENTIFIED_SUPPLIER = "Fornecedor não identificado";
export const FINANCE_AP_NO_CLASSIFICATION = "Sem classificação";

export type FinanceApClassificationStatusFilter =
  | "all"
  | "classified"
  | "unclassified"
  | "manual"
  | "automatic"
  | "split";

export const FINANCE_AP_CLASSIFICATION_STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "classified", label: "Classificados" },
  { value: "unclassified", label: "Sem classificação" },
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automático" },
  { value: "split", label: "Rateio" },
] as const;
