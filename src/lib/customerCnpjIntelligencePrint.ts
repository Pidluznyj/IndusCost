import type { CnpjIntelligencePayload } from "./customerCnpjIntelligenceTypes.js";
import type { CommercialCreditIntelligenceView } from "./commercial/commercialCreditIntelligenceView.js";

export const CNPJ_INTELLIGENCE_PRINT_ROOT_ID = "cnpj-intelligence-print-root";
export const CNPJ_INTELLIGENCE_PRINT_BODY_CLASS = "cnpj-intelligence-printing";
export const CNPJ_INTELLIGENCE_PRINT_BUTTON_LABEL = "Imprimir relatório";

export type CnpjIntelligencePrintPayload = {
  generatedAt: string;
  cnpj: string;
  source: string;
  fetchedAt: string;
  fromCache: boolean;
  summary: CnpjIntelligencePayload["summary"];
  risk: CnpjIntelligencePayload["risk"];
  commercial: CnpjIntelligencePayload["commercial"];
  comparison: CnpjIntelligencePayload["comparison"];
  publicContactSuggestion: CnpjIntelligencePayload["publicContactSuggestion"];
  credit: CommercialCreditIntelligenceView | null;
  creditState: "loaded" | "loading" | "error" | "not_consulted";
};

export function canPrintCnpjIntelligenceReport(
  data: CnpjIntelligencePayload | null | undefined
): data is CnpjIntelligencePayload {
  return data != null && Boolean(data.summary?.companyName?.trim());
}

export function isCnpjIntelligencePrintButtonDisabled(
  loading: boolean,
  data: CnpjIntelligencePayload | null | undefined
): boolean {
  return loading || !canPrintCnpjIntelligenceReport(data);
}

export function toCnpjIntelligencePrintPayload(
  data: CnpjIntelligencePayload,
  extras?:
    | string
    | {
        generatedAt?: string;
        credit?: CommercialCreditIntelligenceView | null;
        creditState?: "loaded" | "loading" | "error" | "not_consulted";
      }
): CnpjIntelligencePrintPayload {
  const options = typeof extras === "string" ? { generatedAt: extras } : extras;
  return {
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    cnpj: data.cnpj,
    source: data.source,
    fetchedAt: data.fetchedAt,
    fromCache: data.fromCache,
    summary: data.summary,
    risk: data.risk,
    commercial: data.commercial,
    comparison: data.comparison,
    publicContactSuggestion: data.publicContactSuggestion,
    credit: options && typeof options !== "string" ? options.credit ?? null : null,
    creditState:
      options && typeof options !== "string" && options.creditState
        ? options.creditState
        : options && typeof options !== "string" && options.credit
          ? "loaded"
          : "not_consulted",
  };
}

export function formatCnpjPrintText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function formatCnpjPrintDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function formatCnpjPrintMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatCnpjPrintScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}/100`;
}
