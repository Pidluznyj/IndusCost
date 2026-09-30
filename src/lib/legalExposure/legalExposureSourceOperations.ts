/**
 * Observabilidade das fontes: agenda, última run, duração, próxima, cobertura.
 * Sem chamada externa.
 */

import {
  SOURCE_LABELS,
  type LegalExposureSource,
  type LegalQueryOutcome,
} from "./legalExposureContracts.js";
import { listCanonicalCases } from "./legalExposureExecutive.js";
import type { LegalExposureEnv } from "./legalExposureFeatureFlags.js";
import {
  LEGAL_EXPOSURE_HEALTH_INTERVAL_MINUTES,
  LEGAL_EXPOSURE_SOURCE_SCHEDULE,
  SOURCE_RUN_STALE_MS,
  nextScheduledAt,
  scheduleForSource,
  sourceReadinessOf,
  type SourceReadiness,
} from "./legalExposureSourceSchedule.js";
import type { LegalExposureMemory } from "./legalExposureStore.js";

export type ExposureSourceRunView = {
  id: string;
  source: string;
  job: string | null;
  status: string;
  trigger: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  outcome: string | null;
  processesRequested: number | null;
  processesFound: number | null;
  movementsReceived: number | null;
  communicationsReceived: number | null;
  entitiesProcessed: number | null;
  errorCode: string | null;
  sanitizedError: string | null;
  externalCall: boolean | null;
};

export type ExposureSourceCoverage = {
  claimantPct: number | null;
  polePct: number | null;
  claimValuePct: number | null;
  movementsPct: number | null;
  processCount: number;
};

export type ExposureSourceOperation = {
  source: LegalExposureSource;
  label: string;
  description: string;
  readiness: SourceReadiness;
  configured: boolean;
  enabled: boolean;
  missingEnvVars: string[];
  hint: string;
  running: boolean;
  interrupted: boolean;
  lastRun: ExposureSourceRunView | null;
  nextScheduledAt: string | null;
  frequencyLabel: string;
  times: string[];
  timezone: string;
  coverage: ExposureSourceCoverage | null;
  healthCheckExternalCall: false;
  healthIntervalMinutes: number;
};

function pct(part: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((part / total) * 100);
}

function durationOf(run: ExposureSourceRunView): number | null {
  if (typeof run.durationMs === "number" && Number.isFinite(run.durationMs)) return run.durationMs;
  if (run.startedAt && run.finishedAt) {
    const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  return null;
}

export function isRunInterrupted(run: ExposureSourceRunView, now: Date): boolean {
  if (run.status !== "RUNNING") return false;
  if (!run.startedAt) return true;
  const age = now.getTime() - Date.parse(run.startedAt);
  return !Number.isFinite(age) || age > SOURCE_RUN_STALE_MS;
}

export function frequencyLabel(times: string[]): string {
  if (times.length === 0) return "Manual / sob demanda";
  if (times.length === 1) return "1 vez ao dia";
  return `${times.length} vezes ao dia`;
}

function coverageForSource(memory: LegalExposureMemory, source: LegalExposureSource): ExposureSourceCoverage | null {
  if (source === "DOMICILIO" || source === "TRT_CERTIFICATE" || source === "CNDT" || source === "WEB_DISCOVERY") {
    return null;
  }
  const items = listCanonicalCases(memory, {});
  const touched = items.filter((row) => row.evidenceSources.includes(source) || row.primarySource === source);
  const total = items.length;
  const base = touched.length > 0 ? touched : items;
  return {
    processCount: touched.length,
    claimantPct: pct(base.filter((row) => row.coverage?.fields.claimant === "FOUND").length, total || base.length),
    polePct: pct(base.filter((row) => row.coverage?.fields.groupPoles === "FOUND").length, total || base.length),
    claimValuePct: pct(base.filter((row) => row.coverage?.fields.claimValue === "FOUND").length, total || base.length),
    movementsPct: pct(base.filter((row) => (row.movementCount ?? 0) > 0).length, total || base.length),
  };
}

export function buildSourceOperations(input: {
  memory: LegalExposureMemory;
  now?: Date;
  runs?: ExposureSourceRunView[];
  env?: LegalExposureEnv;
}): ExposureSourceOperation[] {
  const now = input.now ?? new Date();
  const runs = input.runs ?? [];
  const env = input.env ?? process.env;
  const sources: LegalExposureSource[] = [
    "DJEN",
    "DATAJUD",
    "TRIBUNAL_PUBLIC",
    "ESCAVADOR",
    "JUSBRASIL",
    "DOMICILIO",
    "TRT_CERTIFICATE",
    "CNDT",
  ];
  return sources.map((source) => {
    const schedule = scheduleForSource(source) ?? LEGAL_EXPOSURE_SOURCE_SCHEDULE.find((row) => row.source === source);
    const readiness = sourceReadinessOf(source, env);
    const ofSource = runs
      .filter((row) => row.source === source || row.source === `LEGAL_EXPOSURE_${source}`)
      .map((row) => ({ ...row, durationMs: durationOf(row) }))
      .sort((a, b) => Date.parse(b.startedAt ?? b.finishedAt ?? "") - Date.parse(a.startedAt ?? a.finishedAt ?? ""));
    const lastRun = ofSource[0] ?? null;
    const live = lastRun && lastRun.status === "RUNNING" && !isRunInterrupted(lastRun, now) ? lastRun : null;
    const interrupted = Boolean(lastRun && isRunInterrupted(lastRun, now));
    const times = schedule?.times ?? [];
    return {
      source,
      label: SOURCE_LABELS[source],
      description: schedule?.description ?? "",
      readiness: readiness.readiness,
      configured: readiness.configured,
      enabled: readiness.enabled,
      missingEnvVars: readiness.missingEnvVars,
      hint: readiness.hint,
      running: Boolean(live),
      interrupted,
      lastRun: lastRun ? { ...lastRun, durationMs: durationOf(lastRun) } : null,
      nextScheduledAt: nextScheduledAt(times, now),
      frequencyLabel: frequencyLabel(times),
      times,
      timezone: schedule?.timezone ?? "America/Sao_Paulo",
      coverage: coverageForSource(input.memory, source),
      healthCheckExternalCall: false,
      healthIntervalMinutes: LEGAL_EXPOSURE_HEALTH_INTERVAL_MINUTES,
    };
  });
}

export function summarizeRunOutcome(input: {
  outcome: LegalQueryOutcome | string;
  processesRequested?: number;
  processesFound?: number;
  communications?: number;
  movements?: number;
}): string {
  if (input.outcome === "FAILED" || input.outcome === "SOURCE_ERROR" || input.outcome === "CONFIGURATION_ERROR") {
    return "Falhou";
  }
  if (input.outcome === "RATE_LIMITED") return "Limite de taxa";
  if (input.outcome === "NO_RESULTS") return "Sem resultados";
  const found = input.processesFound ?? 0;
  const requested = input.processesRequested ?? found;
  const extra = [
    found ? `${found} processos` : null,
    input.communications ? `${input.communications} comunicações` : null,
    input.movements ? `${input.movements} movimentos` : null,
  ].filter(Boolean);
  if (extra.length === 0) return String(input.outcome);
  return extra.join(" / ") + (requested && requested !== found ? ` (${requested} consultados)` : "");
}
