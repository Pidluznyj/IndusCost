import React from "react";
import { Info, type LucideIcon } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  CRM_OFFICIAL_SOURCE_NOTE,
  collectCrmSourceWarnings,
  formatCrmSourceInfoLine,
  type CrmSourceInfoLike,
} from "@/src/components/crm/crmCommercialUiConcepts";

export type CrmCommercialSourceInfoNoteProps = {
  sourceInfo?: CrmSourceInfoLike | null;
  showOfficialNote?: boolean;
  className?: string;
};

/** Nota discreta de fonte / eixo de carteira (sem cálculo no frontend). */
export const CrmCommercialSourceInfoNote: React.FC<CrmCommercialSourceInfoNoteProps> = ({
  sourceInfo,
  showOfficialNote = true,
  className,
}) => {
  const line = formatCrmSourceInfoLine(sourceInfo ?? null);
  const warnings = collectCrmSourceWarnings(sourceInfo ?? null);
  if (!showOfficialNote && !line && warnings.length === 0) return null;
  return (
    <div className="space-y-2 max-w-3xl">
      {showOfficialNote || line ? (
        <div
          className={
            className ??
            "text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 space-y-1.5"
          }
          role="note"
        >
          <div className="flex items-start gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
            <div className="space-y-1 min-w-0">
              {showOfficialNote ? <p>{CRM_OFFICIAL_SOURCE_NOTE}</p> : null}
              {line ? (
                <p className="text-[10px] text-muted-foreground/90 font-medium tabular-nums">{line}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div
          className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-950 leading-relaxed"
          role="status"
        >
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Tom semântico do card — vocabulário único do CRM Comercial (mesmo em
 * todas as telas): azul/neutro = contagem informativa; âmbar = precisa de
 * atenção/ação; verde = saudável; vermelho = crítico.
 */
export type CrmAuditMetricTone = "neutral" | "info" | "warning" | "danger" | "success";

export type CrmAuditMetric = {
  key: string;
  label: string;
  value: number | string;
  hint?: string;
  tone?: CrmAuditMetricTone;
  icon?: LucideIcon;
};

export type CrmCommercialAuditStripProps = {
  title?: string;
  metrics: CrmAuditMetric[];
};

const AUDIT_TONE_STYLES: Record<
  CrmAuditMetricTone,
  { card: string; iconWrap: string; value: string }
> = {
  neutral: {
    card: "border-slate-200 bg-slate-50/70",
    iconWrap: "bg-slate-200/80 text-slate-700",
    value: "text-slate-900",
  },
  info: {
    card: "border-sky-200 bg-sky-50/70",
    iconWrap: "bg-sky-100 text-sky-700",
    value: "text-sky-950",
  },
  warning: {
    card: "border-amber-200 bg-amber-50/80",
    iconWrap: "bg-amber-100 text-amber-800",
    value: "text-amber-950",
  },
  danger: {
    card: "border-red-200 bg-red-50/80",
    iconWrap: "bg-red-100 text-red-700",
    value: "text-red-950",
  },
  success: {
    card: "border-emerald-200 bg-emerald-50/80",
    iconWrap: "bg-emerald-100 text-emerald-700",
    value: "text-emerald-950",
  },
};

/**
 * Faixa de indicadores de auditoria — números do universo do filtro (nunca
 * calculados no frontend, nunca inventados). Cor por card é só apresentação
 * (`tone`); o significado semântico já vem decidido por quem monta cada
 * métrica em cada tela.
 */
export const CrmCommercialAuditStrip: React.FC<CrmCommercialAuditStripProps> = ({
  title = "Auditoria da carteira",
  metrics,
}) => {
  if (metrics.length === 0) return null;
  return (
    <div
      className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 space-y-3 shadow-sm"
      data-testid="crm-commercial-audit-strip"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {metrics.map((m) => {
          const tone = AUDIT_TONE_STYLES[m.tone ?? "neutral"];
          const Icon = m.icon ?? Info;
          return (
            <div
              key={m.key}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-shadow hover:shadow-sm",
                tone.card
              )}
              title={m.hint}
            >
              <span className={cn("mt-0.5 shrink-0 rounded-lg p-2", tone.iconWrap)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-medium leading-snug text-muted-foreground">
                  {m.label}
                </span>
                <span
                  className={cn(
                    "block text-xl font-bold tabular-nums leading-tight mt-0.5",
                    tone.value
                  )}
                >
                  {m.value}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
