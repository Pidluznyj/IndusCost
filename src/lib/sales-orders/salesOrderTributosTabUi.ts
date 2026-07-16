/**
 * TRIB-06 — Estados visuais da aba Tributos (contrato TRIB-05).
 * Sem alterar layout do modal: só resolve view-state + copy.
 */

import type {
  SalesOrderFiscalTaxAmount,
  SalesOrderFiscalTaxesPayload,
  SalesOrderFiscalTaxesStatus,
} from "./salesOrderFiscalTaxesClient.js";
import { SALES_ORDER_FISCAL_TAX_LABELS } from "./salesOrderFiscalTaxesClient.js";

export const SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE =
  "Não há NF-e válida vinculada a este pedido para apresentação dos tributos documentais.";

export const SALES_ORDER_TRIBUTOS_LOADING_MESSAGE =
  "Carregando tributos documentais…";

export const SALES_ORDER_TRIBUTOS_DENIED_MESSAGE =
  "Você não tem permissão para visualizar a aba Tributos deste pedido.";

export const SALES_ORDER_TRIBUTOS_ERROR_FALLBACK_MESSAGE =
  "Falha técnica ao carregar os tributos documentais.";

export const SALES_ORDER_TRIBUTOS_EMPTY_MESSAGE =
  "Tributos documentais indisponíveis para este pedido.";

export const SALES_ORDER_TRIBUTOS_PARTIAL_WARNING =
  "Parte dos tributos documentais está indisponível. Os valores disponíveis são exibidos abaixo.";

/** Tributos destacados prioritários na UI. */
export const SALES_ORDER_TRIBUTOS_PRIMARY_TAX_TYPES = [
  "ICMS",
  "IPI",
  "PIS",
  "COFINS",
  "ICMS_ST",
] as const;

export type SalesOrderTributosTabViewState =
  | "loading"
  | "denied"
  | "error"
  | "empty"
  | "unavailable"
  | "partial"
  | "available";

export type ResolveSalesOrderTributosTabViewStateInput = {
  loading?: boolean;
  denied?: boolean;
  fiscalTaxesAccess?: "allowed" | "denied" | null;
  error?: string | null;
  fiscalTaxes?: SalesOrderFiscalTaxesPayload | null;
};

export function resolveSalesOrderTributosTabViewState(
  input: ResolveSalesOrderTributosTabViewStateInput
): SalesOrderTributosTabViewState {
  if (input.loading) return "loading";
  if (input.denied || input.fiscalTaxesAccess === "denied") return "denied";
  if (input.error) return "error";
  if (input.fiscalTaxes?.status === "error") return "error";
  if (!input.fiscalTaxes) return "empty";
  if (input.fiscalTaxes.status === "unavailable") return "unavailable";
  if (input.fiscalTaxes.status === "partial") return "partial";
  return "available";
}

export function salesOrderTributosErrorMessage(
  input: ResolveSalesOrderTributosTabViewStateInput
): string {
  if (input.error && String(input.error).trim()) return String(input.error).trim();
  if (input.fiscalTaxes?.status === "error") {
    return (
      input.fiscalTaxes.statusReason?.trim() ||
      SALES_ORDER_TRIBUTOS_ERROR_FALLBACK_MESSAGE
    );
  }
  return SALES_ORDER_TRIBUTOS_ERROR_FALLBACK_MESSAGE;
}

/** Valor adicional (frete, desconto, despesa, seguro) existe para exibição. */
export function salesOrderTributosAdditiveExists(
  value: number | null | undefined
): boolean {
  return value != null && Number.isFinite(value);
}

export function buildPrimaryHighlightedTaxCards(
  highlightedTaxes: ReadonlyArray<SalesOrderFiscalTaxAmount>
): Array<{ taxType: string; label: string; amount: number | null }> {
  const byType = new Map(highlightedTaxes.map((t) => [t.taxType, t]));
  const primary = SALES_ORDER_TRIBUTOS_PRIMARY_TAX_TYPES.map((taxType) => {
    const hit = byType.get(taxType);
    return {
      taxType,
      label: hit?.label ?? SALES_ORDER_FISCAL_TAX_LABELS[taxType] ?? taxType,
      amount: hit?.amount ?? null,
    };
  });
  const extras = highlightedTaxes.filter(
    (t) =>
      !(SALES_ORDER_TRIBUTOS_PRIMARY_TAX_TYPES as readonly string[]).includes(
        t.taxType
      )
  );
  return [
    ...primary,
    ...extras.map((t) => ({
      taxType: t.taxType,
      label: t.label,
      amount: t.amount,
    })),
  ];
}

export function formatSalesOrderTributosLinkOrigins(
  linkOrigins: SalesOrderFiscalTaxesPayload["linkOrigins"] | undefined
): string | null {
  if (!linkOrigins || linkOrigins.length === 0) return null;
  const parts = linkOrigins
    .map((o) => {
      const origin = o.primaryOrigin ?? o.origins[0] ?? null;
      if (!origin) return null;
      const num = o.numero ? `NF ${o.numero}` : `NF #${o.nfeExternalId}`;
      return `${num}: ${origin}`;
    })
    .filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export const SALES_ORDER_TRIBUTOS_VIEWPORTS = [
  { id: "1366" as const, width: 1366, height: 768, label: "1366×768" },
  { id: "1920" as const, width: 1920, height: 1080, label: "1920×1080" },
];

export function salesOrderTributosViewportClass(
  viewport: "1366" | "1920"
): string {
  return viewport === "1366" ? "w-[1366px] max-w-full" : "w-[1920px] max-w-full";
}

export function isSalesOrderTributosDataStatus(
  status: SalesOrderFiscalTaxesStatus | undefined
): status is "available" | "partial" {
  return status === "available" || status === "partial";
}
