import React from "react";
import { cn } from "@/src/lib/utils";
import {
  COMMERCIAL_CLASSIFICATION_LABEL_PT,
  HEALTH_CLASSIFICATION_LABEL_PT,
} from "@/src/lib/customerIntelligenceNavigation";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-700";
  if (score >= 60) return "text-sky-700";
  if (score >= 40) return "text-amber-700";
  return "text-red-700";
}

function scoreRingColor(score: number): string {
  if (score >= 80) return "stroke-emerald-500";
  if (score >= 60) return "stroke-sky-500";
  if (score >= 40) return "stroke-amber-500";
  return "stroke-red-500";
}

function healthBadgeClass(health: CustomerIntelligenceReport["scoring"]["healthClassification"]): string {
  switch (health) {
    case "excelente":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "saudavel":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "atencao":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "risco":
    case "inativo":
      return "bg-red-100 text-red-900 border-red-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function ScoreRing({ score }: { score: number }) {
  const safe = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safe / 100) * circumference;

  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={scoreRingColor(safe)}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-bold tabular-nums", scoreTone(safe))}>{safe}</span>
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Score</span>
      </div>
    </div>
  );
}

export function CustomerIntelligenceSignals({ report }: { report: CustomerIntelligenceReport }) {
  const { scoring, opportunities } = report;
  const topOpportunities = opportunities.slice(0, 3);

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <ScoreRing score={scoring.score} />
        <div className="min-w-0 space-y-2 flex-1">
          <div>
            <h2 className="text-sm font-bold">Saúde comercial</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{scoring.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                healthBadgeClass(scoring.healthClassification)
              )}
            >
              {HEALTH_CLASSIFICATION_LABEL_PT[scoring.healthClassification]}
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold">
              {COMMERCIAL_CLASSIFICATION_LABEL_PT[scoring.commercialClassification]}
            </span>
          </div>
        </div>
      </div>

      {topOpportunities.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Prioridades comerciais
          </h3>
          <ul className="space-y-2">
            {topOpportunities.map((item) => (
              <li
                key={`${item.kind}-${item.title}`}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  item.type === "RISK"
                    ? "border-red-200 bg-red-50/70"
                    : item.type === "OPPORTUNITY"
                      ? "border-emerald-200 bg-emerald-50/70"
                      : "border-border bg-muted/20"
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{item.title}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    Prioridade {item.priorityScore}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{item.suggestedAction}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
