/**
 * Peças visuais do módulo Competências e Desenvolvimento.
 * Só tokens do tema / paleta Tailwind já usada no app (mapa semântico do OverlayBadge);
 * nenhum CSS novo. Segmentado, toggle e toast seguem os padrões locais do repositório
 * (Dashboard de Pessoas, CRM), que não têm primitivo compartilhado.
 */
import React, { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { OverlayBadge, type OverlayBadgeTone } from "@/src/components/ui/overlay";
import { cn } from "@/src/lib/utils";
import {
  COMPETENCY_ASSESSMENT_STATUS_LABELS,
  COMPETENCY_LEVEL_LABELS,
  TRAINING_STATUS_LABELS,
  isCompetencyAssessmentStatus,
  isCompetencyLevel,
  isTrainingStatus,
} from "@/src/lib/competencies/competencyDomain";
import type { ReadinessTone } from "@/src/lib/competencies/competencyEngine";

export const BTN_PRIMARY =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SECONDARY =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_GHOST =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50";
export const PANEL = "rounded-xl border border-border bg-card";

/** Cores da escala: 0 cinza, 1 vermelho, 2 âmbar, 3 azul (primary), 4 verde. */
export const LEVEL_TONE_CLASS: Record<number, string> = {
  0: "bg-slate-100 text-slate-500",
  1: "bg-rose-100 text-rose-700",
  2: "bg-amber-100 text-amber-800",
  3: "bg-primary/10 text-primary",
  4: "bg-emerald-100 text-emerald-700",
};
export const LEVEL_ACTIVE_BORDER_CLASS: Record<number, string> = {
  0: "border-slate-400",
  1: "border-rose-500",
  2: "border-amber-500",
  3: "border-primary",
  4: "border-emerald-500",
};

export function levelToneClass(level: number): string {
  return LEVEL_TONE_CLASS[isCompetencyLevel(level) ? level : 0];
}

export function LevelChip({ level, className, title }: { level: number; className?: string; title?: string }) {
  return (
    <span
      title={title ?? (isCompetencyLevel(level) ? COMPETENCY_LEVEL_LABELS[level] : undefined)}
      className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums", levelToneClass(level), className)}
    >
      {level > 0 ? level : "—"}
    </span>
  );
}

const STATUS_TONE: Record<string, OverlayBadgeTone> = {
  COMPLETED: "emerald",
  IN_PROGRESS: "sky",
  PENDING: "amber",
  SCHEDULED: "slate",
};

export function AssessmentStatusBadge({ status }: { status: string }) {
  return (
    <OverlayBadge tone={STATUS_TONE[status] ?? "slate"}>
      {isCompetencyAssessmentStatus(status) ? COMPETENCY_ASSESSMENT_STATUS_LABELS[status] : status}
    </OverlayBadge>
  );
}

export function TrainingStatusBadge({ status }: { status: string }) {
  return (
    <OverlayBadge tone={STATUS_TONE[status] ?? "slate"}>
      {isTrainingStatus(status) ? TRAINING_STATUS_LABELS[status] : status}
    </OverlayBadge>
  );
}

const READINESS_BAR: Record<ReadinessTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-300",
};

export function ReadinessBar({
  ready,
  total,
  ratio,
  tone,
  testId,
}: {
  ready: number;
  total: number;
  ratio: number | null;
  tone: ReadinessTone;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground tabular-nums">{ready}</strong> aptos de {total}
        </span>
        <span className="tabular-nums">{ratio === null ? "—" : `${Math.round(ratio * 100)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          data-tone={tone}
          className={cn("h-full rounded-full transition-[width]", READINESS_BAR[tone])}
          style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Seletor segmentado (padrão do Dashboard de Pessoas). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} data-testid={testId} className="inline-flex flex-wrap rounded-md border border-border bg-muted/60 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium transition-colors",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  testId?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-slate-300",
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

/** Botões de nível (1–4 na avaliação, 0–4 no posto). */
export function LevelButtons({
  value,
  from,
  onChange,
  ariaLabel,
  testId,
}: {
  value: number;
  from: 0 | 1;
  onChange: (level: number) => void;
  ariaLabel: string;
  testId?: string;
}) {
  const levels = [0, 1, 2, 3, 4].filter((n) => n >= from);
  return (
    <div role="radiogroup" aria-label={ariaLabel} data-testid={testId} className="flex gap-1">
      {levels.map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            title={COMPETENCY_LEVEL_LABELS[n as 0 | 1 | 2 | 3 | 4]}
            onClick={() => onChange(n)}
            className={cn(
              "h-8 w-9 rounded-md border text-sm font-bold tabular-nums transition-colors",
              on ? cn(levelToneClass(n), LEVEL_ACTIVE_BORDER_CLASS[n]) : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

type ChipToggleProps = {
  label: string;
  selected: boolean;
  flagged?: boolean;
  flagTitle?: string;
  onToggle: () => void;
};

export const ChipToggle: React.FC<ChipToggleProps> = ({ label, selected, flagged, flagTitle, onToggle }) => {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        selected ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {flagged ? <span title={flagTitle} aria-label={flagTitle} className="h-1.5 w-1.5 rounded-full bg-rose-500" /> : null}
      {label}
    </button>
  );
};

export function PanelState({
  kind,
  message,
  onRetry,
  testId,
}: {
  kind: "loading" | "empty" | "error";
  message: string;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      role={kind === "error" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm",
        kind === "error" ? "text-rose-700" : "text-muted-foreground",
      )}
    >
      {kind === "loading" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
      {kind === "error" ? <AlertTriangle className="h-5 w-5" aria-hidden /> : null}
      <p>{message}</p>
      {kind === "error" && onRetry ? (
        <button type="button" className={BTN_SECONDARY} onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

/** Toast local (padrão CRM): some sozinho. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="competencies-toast"
      className="fixed bottom-6 right-6 z-[110] flex items-center gap-2.5 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
    >
      <CheckCircle2 className="h-[18px] w-[18px] text-emerald-400" aria-hidden />
      {message}
    </div>
  );
}
