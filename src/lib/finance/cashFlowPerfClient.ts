/**
 * PERF 3.1 — marks de abertura do Fluxo de Caixa (somente DEV + flag).
 *
 * `cf:ready` = dashboard + annual-comparison + daily-radar concluídos
 * (sucesso ou erro). Se annual/radar não entram na viewport, ficam em
 * `pending` e `cf:ready` não dispara — o tempo de tela completo exige
 * as três seções; `cf:dashboard` é o primeiro conteúdo útil.
 *
 * Cache de sessão (60s) é anotado como hit/miss; hits não passam pelo
 * probe de `fetch` do PERF 02.
 */

import { isDevPerfBaselineClientEnabled } from "@/src/lib/devPerfBaseline.js";
import {
  fetchUiSessionCachedJson,
  readUiSessionGetCache,
  type FetchUiSessionCachedJsonOptions,
} from "@/src/lib/uiSessionGetCache.js";

export const CASH_FLOW_PERF_SECTIONS = ["dashboard", "annual", "radar"] as const;
export type CashFlowPerfSection = (typeof CASH_FLOW_PERF_SECTIONS)[number];

export type CashFlowPerfFetchNote = {
  path: string;
  cache: "hit" | "miss";
  ms: number;
  section?: CashFlowPerfSection;
};

export type CashFlowPerfSnapshot = {
  openAt: number | null;
  dashboardMs: number | null;
  annualMs: number | null;
  radarMs: number | null;
  readyMs: number | null;
  pending: CashFlowPerfSection[];
  fetches: CashFlowPerfFetchNote[];
};

export type CashFlowReadyTracker = {
  note(section: CashFlowPerfSection): { ready: boolean; pending: CashFlowPerfSection[] };
  reset(): void;
  pending(): CashFlowPerfSection[];
};

export function createCashFlowReadyTracker(): CashFlowReadyTracker {
  const done = new Set<CashFlowPerfSection>();
  return {
    note(section) {
      done.add(section);
      const pending = CASH_FLOW_PERF_SECTIONS.filter((s) => !done.has(s));
      return { ready: pending.length === 0, pending: [...pending] };
    },
    reset() {
      done.clear();
    },
    pending() {
      return CASH_FLOW_PERF_SECTIONS.filter((s) => !done.has(s));
    },
  };
}

type SessionState = {
  tracker: CashFlowReadyTracker;
  openAt: number;
  dashboardMs: number | null;
  annualMs: number | null;
  radarMs: number | null;
  readyMs: number | null;
  fetches: CashFlowPerfFetchNote[];
};

let session: SessionState | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function enabled(): boolean {
  return isDevPerfBaselineClientEnabled();
}

function mark(name: string): void {
  try {
    if (typeof performance !== "undefined" && typeof performance.mark === "function") {
      performance.mark(name);
    }
  } catch {
    /* ignore */
  }
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.info(`[perf-baseline:cf] ${message}`);
}

function attachSnapshotGetter(): void {
  if (typeof window === "undefined") return;
  const host = window as unknown as {
    __induscostPerfBaseline?: { getCashFlow?: () => CashFlowPerfSnapshot };
  };
  if (!host.__induscostPerfBaseline) return;
  host.__induscostPerfBaseline.getCashFlow = getCashFlowPerfSnapshot;
}

export function getCashFlowPerfSnapshot(): CashFlowPerfSnapshot {
  if (!session) {
    return {
      openAt: null,
      dashboardMs: null,
      annualMs: null,
      radarMs: null,
      readyMs: null,
      pending: [...CASH_FLOW_PERF_SECTIONS],
      fetches: [],
    };
  }
  return {
    openAt: session.openAt,
    dashboardMs: session.dashboardMs,
    annualMs: session.annualMs,
    radarMs: session.radarMs,
    readyMs: session.readyMs,
    pending: session.tracker.pending(),
    fetches: [...session.fetches],
  };
}

export function beginCashFlowPerfSession(): void {
  if (!enabled()) return;
  session = {
    tracker: createCashFlowReadyTracker(),
    openAt: nowMs(),
    dashboardMs: null,
    annualMs: null,
    radarMs: null,
    readyMs: null,
    fetches: [],
  };
  mark("cf:open");
  attachSnapshotGetter();
  log("open");
}

export function noteCashFlowSectionDone(section: CashFlowPerfSection): void {
  if (!enabled() || !session) return;
  const elapsed = nowMs() - session.openAt;
  if (section === "dashboard" && session.dashboardMs == null) {
    session.dashboardMs = Math.round(elapsed * 100) / 100;
    mark("cf:dashboard");
  }
  if (section === "annual" && session.annualMs == null) {
    session.annualMs = Math.round(elapsed * 100) / 100;
    mark("cf:annual");
  }
  if (section === "radar" && session.radarMs == null) {
    session.radarMs = Math.round(elapsed * 100) / 100;
    mark("cf:radar");
  }
  const { ready, pending } = session.tracker.note(section);
  if (ready && session.readyMs == null) {
    session.readyMs = Math.round((nowMs() - session.openAt) * 100) / 100;
    mark("cf:ready");
    log(`ready ${session.readyMs}ms (dashboard=${session.dashboardMs} annual=${session.annualMs} radar=${session.radarMs})`);
  } else {
    log(`${section} done; pending=${pending.join(",") || "none"}`);
  }
}

export async function fetchCashFlowSessionJson<T>(
  url: string,
  options: FetchUiSessionCachedJsonOptions = {},
  section?: CashFlowPerfSection
): Promise<T> {
  const cacheKey = options.cacheKey ?? url;
  const profilingOn = enabled();
  const hadHit =
    profilingOn && !options.skipCache && readUiSessionGetCache(cacheKey) != null;
  const t0 = nowMs();
  try {
    const data = await fetchUiSessionCachedJson<T>(url, options);
    if (profilingOn && session) {
      let path = url;
      try {
        path = new URL(url, "http://local.invalid").pathname;
      } catch {
        path = url.split("?")[0] ?? url;
      }
      session.fetches.push({
        path,
        cache: hadHit ? "hit" : "miss",
        ms: Math.round((nowMs() - t0) * 100) / 100,
        section,
      });
      if (section) {
        const already =
          (section === "dashboard" && session.dashboardMs != null) ||
          (section === "annual" && session.annualMs != null) ||
          (section === "radar" && session.radarMs != null);
        if (!already) noteCashFlowSectionDone(section);
      }
    }
    return data;
  } catch (error) {
    const aborted =
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");
    if (enabled() && section && !aborted) {
      noteCashFlowSectionDone(section);
    }
    throw error;
  }
}
