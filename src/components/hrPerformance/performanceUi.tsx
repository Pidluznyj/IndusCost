/**
 * Peças visuais do módulo Desempenho e Cultura. Reaproveita o kit de Competências
 * (botões, painel, estados, toast, moldura de modal) e o Overlay do design system.
 * Nenhum CSS novo: só tokens do tema e a paleta já usada nos badges do app.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Search, UserRound } from "lucide-react";
import { OverlayBadge, OverlayField, OverlayInput, OverlayTextarea, type OverlayBadgeTone } from "@/src/components/ui/overlay";
import { CompetencyModalFrame } from "@/src/components/competencies/CompetencyModalFrame";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST, PANEL, PanelState, Toast } from "@/src/components/competencies/competencyUi";
import {
  ASSIGNMENT_STATUS_LABELS,
  CULTURE_BAND_LABELS,
  CYCLE_STATUS_LABELS,
  ELIGIBILITY_LABELS,
  PDI_STATUS_LABELS,
  TECHNICAL_VALIDATION_LABELS,
  UNCLASSIFIED_QUADRANT,
  formatDateBr,
  formatPillarMean,
  type AssignmentStatus,
  type CultureBand,
  type CycleStatus,
  type EligibilityState,
  type PdiStatus,
  type TechnicalValidation,
} from "@/src/lib/hrPerformance/performanceDomain";
import { searchPerformanceDirectory, type DirectoryPerson, type RateDto } from "@/src/lib/hrPerformance/performanceClient";
import { cn } from "@/src/lib/utils";

export { BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST, PANEL, PanelState, Toast };

export const PERF_EYEBROW = "Gestão de pessoas · Desempenho e Cultura";

type PerformanceModalProps = {
  open: boolean;
  title: string;
  subtitle: string;
  saveLabel: string;
  footerHint: React.ReactNode;
  canSave: boolean;
  onSave: () => Promise<void>;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  testId: string;
  children: React.ReactNode;
};

export function PerformanceModal(props: PerformanceModalProps) {
  return <CompetencyModalFrame {...props} eyebrow={PERF_EYEBROW} />;
}

const CYCLE_TONE: Record<string, OverlayBadgeTone> = {
  DRAFT: "slate",
  PREPARED: "sky",
  OPEN: "emerald",
  CONSOLIDATION: "amber",
  CALIBRATION: "violet",
  HOMOLOGATED: "primary",
  CLOSED: "slate",
};

export function CycleStatusBadge({ status }: { status: string }) {
  return <OverlayBadge tone={CYCLE_TONE[status] ?? "slate"}>{CYCLE_STATUS_LABELS[status as CycleStatus] ?? status}</OverlayBadge>;
}

const ASSIGNMENT_TONE: Record<string, OverlayBadgeTone> = { NOT_STARTED: "slate", IN_PROGRESS: "sky", SUBMITTED: "emerald", RETURNED: "amber" };

export function AssignmentBadge({ status, testId }: { status: string | null | undefined; testId?: string }) {
  if (!status) return <OverlayBadge tone="slate" variant="outline" testId={testId}>Sem tarefa</OverlayBadge>;
  return (
    <OverlayBadge tone={ASSIGNMENT_TONE[status] ?? "slate"} testId={testId}>
      {ASSIGNMENT_STATUS_LABELS[status as AssignmentStatus] ?? status}
    </OverlayBadge>
  );
}

const ELIGIBILITY_TONE: Record<string, OverlayBadgeTone> = { ELIGIBLE: "emerald", NOT_ELIGIBLE: "slate", INSUFFICIENT_EVIDENCE: "amber" };

export function EligibilityBadge({ state, title }: { state: string; title?: string }) {
  return (
    <OverlayBadge tone={ELIGIBILITY_TONE[state] ?? "slate"} title={title}>
      {ELIGIBILITY_LABELS[state as EligibilityState] ?? state}
    </OverlayBadge>
  );
}

const INVITE_LABEL: Record<string, string> = { NONE: "Sem convite", ACTIVE: "Convite ativo", REVOKED: "Revogado", LOCKED: "Bloqueado", EXPIRED: "Expirado" };
const INVITE_TONE: Record<string, OverlayBadgeTone> = { NONE: "slate", ACTIVE: "sky", REVOKED: "slate", LOCKED: "rose", EXPIRED: "amber" };

export function InviteBadge({ status }: { status: string }) {
  return (
    <OverlayBadge tone={INVITE_TONE[status] ?? "slate"} variant={status === "NONE" ? "outline" : "soft"}>
      {INVITE_LABEL[status] ?? status}
    </OverlayBadge>
  );
}

const CULTURE_TONE: Record<string, OverlayBadgeTone> = { CONSISTENT: "emerald", DEVELOPING: "sky", NEEDS_REVIEW: "amber", INSUFFICIENT: "slate" };

export function CultureBadge({ band }: { band: string | null | undefined }) {
  if (!band) return <span className="text-xs text-muted-foreground">—</span>;
  return <OverlayBadge tone={CULTURE_TONE[band] ?? "slate"}>{CULTURE_BAND_LABELS[band as CultureBand] ?? band}</OverlayBadge>;
}

export function ValidationBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const tone: OverlayBadgeTone = value === "VALIDATED" ? "emerald" : value === "PENDING_VALIDATION" ? "amber" : "slate";
  return <OverlayBadge tone={tone}>{TECHNICAL_VALIDATION_LABELS[value as TechnicalValidation] ?? value}</OverlayBadge>;
}

export function OfficialBadge({ official, adjusted }: { official: boolean; adjusted?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <OverlayBadge tone={official ? "primary" : "slate"} variant={official ? "soft" : "outline"}>
        {official ? "Oficial · homologado" : "Preliminar"}
      </OverlayBadge>
      {adjusted ? <OverlayBadge tone="violet">Ajustado na calibração</OverlayBadge> : null}
    </span>
  );
}

const PDI_TONE: Record<string, OverlayBadgeTone> = { PLANNED: "slate", IN_PROGRESS: "sky", DONE: "emerald", SUSPENDED: "amber", CANCELLED: "slate" };

export function PdiBadge({ status }: { status: string }) {
  return <OverlayBadge tone={PDI_TONE[status] ?? "slate"}>{PDI_STATUS_LABELS[status as PdiStatus] ?? status}</OverlayBadge>;
}

export function quadrantText(quadrant: string | null | undefined): string {
  if (!quadrant || quadrant === UNCLASSIFIED_QUADRANT) return "Sem classificação";
  return quadrant;
}

export function mean(sum: number | null | undefined, count: number | null | undefined): string {
  if (sum == null || !count) return "—";
  return formatPillarMean(sum, count) ?? "—";
}

export function rateText(rate: RateDto | undefined): string {
  if (!rate || rate.denominator === 0) return "—";
  return `${rate.numerator} de ${rate.denominator} (${Math.round((rate.ratio ?? 0) * 100)}%)`;
}

export const dateBr = formatDateBr;

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function addDaysIso(days: number): string {
  const base = new Date(`${todayIso()}T12:00:00`);
  base.setDate(base.getDate() + days);
  return new Date(base.getTime() - base.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function ErrorBanner({ message, testId }: { message: string | null; testId?: string }) {
  if (!message) return null;
  return (
    <div role="alert" data-testid={testId} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </div>
  );
}

export function InfoBanner({ children, tone = "sky", testId }: { children: React.ReactNode; tone?: "sky" | "amber" | "slate"; testId?: string }) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "slate"
        ? "border-border bg-muted/40 text-foreground"
        : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <div role="status" data-testid={testId} className={cn("rounded-lg border px-3 py-2 text-sm", cls)}>
      {children}
    </div>
  );
}

/** Texto com contador, para motivo e justificativa (mínimo validado também no servidor). */
export function ReasonField({
  label,
  value,
  onChange,
  min = 8,
  placeholder,
  required = true,
  testId,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  placeholder?: string;
  required?: boolean;
  testId?: string;
  description?: string;
}) {
  const length = value.trim().length;
  return (
    <OverlayField label={label} required={required} description={description} hint={min > 0 ? `${length}/${min} caracteres mínimos` : undefined}>
      {(p) => <OverlayTextarea {...p} rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />}
    </OverlayField>
  );
}

/** Busca no cadastro oficial de Pessoas. Nunca pede id: a pessoa é escolhida pelo nome. */
export function EmployeePicker({
  value,
  onChange,
  excludeIds = [],
  label = "Pessoa",
  testId,
}: {
  value: DirectoryPerson | null;
  onChange: (person: DirectoryPerson | null) => void;
  excludeIds?: string[];
  label?: string;
  testId?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    if (value) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPerformanceDirectory(term)
        .then((payload) => {
          if (current !== seq.current) return;
          setResults(payload.employees.filter((p) => !excludeIds.includes(p.id) && !p.terminated && (p.status ?? "ACTIVE") === "ACTIVE"));
          setError(null);
        })
        .catch((cause) => current === seq.current && setError(cause instanceof Error ? cause.message : "Falha na busca."))
        .finally(() => current === seq.current && setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, value, excludeIds.join("|")]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2" data-testid={testId ? `${testId}-selected` : undefined}>
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{value.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {value.roleName} · {value.departmentName}
            </span>
          </span>
        </span>
        <button type="button" className={BTN_GHOST} onClick={() => onChange(null)}>
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <OverlayField label={label} required description="Digite pelo menos duas letras do nome, do cargo ou do setor.">
        {(p) => (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <OverlayInput {...p} className="pl-9" value={query} aria-controls={listId} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no cadastro de Pessoas" data-testid={testId ? `${testId}-search` : undefined} />
          </div>
        )}
      </OverlayField>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <ul id={listId} role="listbox" className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {loading ? <li className="px-3 py-2 text-sm text-muted-foreground">Buscando…</li> : null}
        {!loading && query.trim().length >= 2 && results.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Ninguém ativo encontrado.</li> : null}
        {results.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
              onClick={() => onChange(person)}
            >
              <span className="text-sm font-medium">{person.name}</span>
              <span className="text-xs text-muted-foreground">
                {person.roleName} · {person.departmentName}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KpiTile({ label, value, hint, tone = "neutral", testId }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "neutral" | "warning" | "positive"; testId?: string }) {
  return (
    <div className={`${PANEL} flex min-w-0 flex-col gap-1 p-3`} data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", tone === "warning" ? "text-amber-600" : tone === "positive" ? "text-emerald-600" : "text-foreground")}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Tabela com rolagem horizontal própria: a página nunca rola de lado no celular. */
export function TableScroll({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * Toast do módulo: mesmo visual do kit de Competências, centralizado embaixo e sem capturar
 * clique (pointer-events-none). O toast do canto direito cobria o rodapé dos modais e
 * engolia o clique em "Salvar" por alguns segundos (achado no teste de navegador).
 */
export function PerformanceToast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="perf-toast"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[110] flex max-w-[90vw] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
    >
      <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-emerald-400" aria-hidden />
      {message}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const clear = React.useCallback(() => setToast(null), []);
  return { toast, setToast, node: <PerformanceToast message={toast} onDone={clear} /> };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
