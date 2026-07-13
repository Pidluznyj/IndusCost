import React from "react";
import { Info } from "lucide-react";
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

export type CrmAuditMetric = {
  key: string;
  label: string;
  value: number | string;
  hint?: string;
};

export type CrmCommercialAuditStripProps = {
  title?: string;
  metrics: CrmAuditMetric[];
};

/** Faixa compacta de auditoria (sem inventar números). */
export const CrmCommercialAuditStrip: React.FC<CrmCommercialAuditStripProps> = ({
  title = "Auditoria da carteira",
  metrics,
}) => {
  if (metrics.length === 0) return null;
  return (
    <div
      className="rounded-xl border border-border/70 bg-card/80 px-4 py-3 space-y-2"
      data-testid="crm-commercial-audit-strip"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {metrics.map((m) => (
          <div
            key={m.key}
            className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
            title={m.hint}
          >
            <p className="text-[10px] text-muted-foreground leading-snug">{m.label}</p>
            <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
