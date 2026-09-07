/**
 * Tag de score CNPJ no grid de Clientes: "83 · VENDA LIBERADA".
 * Só apresenta o que o backend persistiu na última consulta — nunca calcula.
 * Sem consulta: chip neutro que abre a Consulta CNPJ (quando permitido).
 */
import React from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL,
  customerCnpjRiskTone,
  formatCustomerCnpjRiskTagLabel,
  formatCustomerCnpjRiskTooltip,
  type CustomerCnpjRiskSummary,
  type CustomerCnpjRiskTone,
} from "@/src/lib/customerCnpjRiskSummary";

/** Mesmas cores do veredito no painel Consulta CNPJ. */
const TONE_CLASS: Record<CustomerCnpjRiskTone, string> = {
  blocked: "bg-red-100 text-red-900 border-red-200",
  advance: "bg-amber-100 text-amber-900 border-amber-200",
  conditional: "bg-yellow-50 text-yellow-900 border-yellow-200",
  released: "bg-emerald-100 text-emerald-900 border-emerald-200",
  unknown: "bg-slate-100 text-slate-700 border-slate-200",
};

const BASE_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap";

export function CustomerCnpjRiskTag({
  risk,
  onConsult,
  className,
}: {
  risk: CustomerCnpjRiskSummary | null | undefined;
  /** Abre a Consulta CNPJ do cliente (chip "Sem consulta" ou consulta vencida). */
  onConsult?: () => void;
  className?: string;
}) {
  if (!risk) {
    const label = CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL;
    const title = "Nenhuma consulta CNPJ registrada para este cliente.";
    if (!onConsult) {
      return (
        <span className={cn(BASE_CLASS, TONE_CLASS.unknown, "font-semibold normal-case", className)} title={title} data-testid="customer-cnpj-risk-none">
          {label}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={onConsult}
        className={cn(BASE_CLASS, TONE_CLASS.unknown, "font-semibold normal-case hover:bg-slate-200", className)}
        title={`${title} Clique para consultar.`}
        data-testid="customer-cnpj-risk-none"
      >
        {label}
      </button>
    );
  }

  const tone = customerCnpjRiskTone(risk.verdict);
  const label = formatCustomerCnpjRiskTagLabel(risk);
  const title = formatCustomerCnpjRiskTooltip(risk);
  return (
    <span
      className={cn(BASE_CLASS, TONE_CLASS[tone], risk.expired && "opacity-70", className)}
      title={title}
      data-testid="customer-cnpj-risk-tag"
      data-tone={tone}
      data-expired={risk.expired ? "true" : "false"}
    >
      <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
