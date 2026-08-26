import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  PeopleProfileCapabilities,
  PeopleProfileSummaryDto,
  PeopleProfileTabId,
} from "@/src/lib/peopleProfileTypes";
import { ProfileHeader } from "./ProfileHeader";
import { ProfileTabs, visibleProfileTabs } from "./ProfileTabs";
import { PeopleOverviewTab } from "./PeopleOverviewTab";
import { ProfileState, formatProfileDateTime } from "./profileUi";

const PeopleProfessionalTab = lazy(() =>
  import("./PeopleProfessionalTab").then((m) => ({ default: m.PeopleProfessionalTab }))
);
const PeopleCareerTab = lazy(() =>
  import("./PeopleCareerTab").then((m) => ({ default: m.PeopleCareerTab }))
);
const PeopleCompensationTab = lazy(() =>
  import("./PeopleCompensationTab").then((m) => ({ default: m.PeopleCompensationTab }))
);
const PeopleBenefitsTab = lazy(() =>
  import("./PeopleBenefitsTab").then((m) => ({ default: m.PeopleBenefitsTab }))
);
const PeoplePersonalTab = lazy(() =>
  import("./PeoplePersonalTab").then((m) => ({ default: m.PeoplePersonalTab }))
);
const PeopleEmergencyTab = lazy(() =>
  import("./PeopleEmergencyTab").then((m) => ({ default: m.PeopleEmergencyTab }))
);
const PeopleEpiTab = lazy(() => import("./PeopleEpiTab").then((m) => ({ default: m.PeopleEpiTab })));
const PeopleDocumentsTab = lazy(() =>
  import("./PeopleDocumentsTab").then((m) => ({ default: m.PeopleDocumentsTab }))
);
const PeopleAbsencesTab = lazy(() =>
  import("./PeopleAbsencesTab").then((m) => ({ default: m.PeopleAbsencesTab }))
);
const PeopleHistoryTab = lazy(() =>
  import("./PeopleHistoryTab").then((m) => ({ default: m.PeopleHistoryTab }))
);
const PeopleNotesTab = lazy(() =>
  import("./PeopleNotesTab").then((m) => ({ default: m.PeopleNotesTab }))
);

const LAZY_TABS = new Set<PeopleProfileTabId>([
  "professional",
  "career",
  "compensation",
  "benefits",
  "personal",
  "emergency",
  "epi",
  "documents",
  "absences",
  "history",
  "notes",
]);

type TabCache = Record<string, unknown>;
type HistoryPage = {
  items: Array<{
    id: string;
    eventLabel: string;
    effectiveDate: string;
    createdAt: string;
    summary: string;
  }>;
  nextCursor: string | null;
};

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { credentials: "include", signal, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: "Resposta inválida" };
  }
  if (!res.ok) {
    const err = new Error(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: string }).error)
        : `Erro ${res.status}`
    );
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return body;
}

export function PeopleEmployeeProfileDialog({
  employeeId,
  onClose,
  canViewLinks,
  canViewAdmin,
  linksSlot,
  adminSlot,
  headerActions,
}: {
  employeeId: string;
  onClose: () => void;
  canViewLinks?: boolean;
  canViewAdmin?: boolean;
  linksSlot?: React.ReactNode;
  adminSlot?: React.ReactNode;
  headerActions?: React.ReactNode;
}) {
  const [summary, setSummary] = useState<PeopleProfileSummaryDto | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PeopleProfileTabId>("overview");
  const [tabCache, setTabCache] = useState<TabCache>({});
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const employeeIdRef = useRef(employeeId);
  employeeIdRef.current = employeeId;
  const tabCacheRef = useRef(tabCache);
  tabCacheRef.current = tabCache;
  const tabAbortRef = useRef<AbortController | null>(null);

  const caps: PeopleProfileCapabilities | null = summary?.capabilities ?? null;
  const visibleTabIds = useMemo(
    () => visibleProfileTabs(caps, { canViewLinks, canViewAdmin }),
    [caps, canViewLinks, canViewAdmin]
  );

  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
    setSummaryLoading(true);
    setTabCache({});
    setActiveTab("overview");
    const ac = new AbortController();
    const requestedId = employeeId;
    fetchJson(`/api/employees/${requestedId}/profile`, ac.signal)
      .then((body) => {
        if (employeeIdRef.current !== requestedId) return;
        setSummary(body as PeopleProfileSummaryDto);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (employeeIdRef.current !== requestedId) return;
        setSummaryError(err instanceof Error ? err.message : "Não foi possível abrir a ficha.");
      })
      .finally(() => {
        if (employeeIdRef.current === requestedId) setSummaryLoading(false);
      });
    return () => ac.abort();
  }, [employeeId]);

  const loadTab = useCallback(async (tab: PeopleProfileTabId, opts?: { appendHistory?: boolean }) => {
    if (!LAZY_TABS.has(tab)) return;
    const requestedId = employeeIdRef.current;
    const cacheKey = `${requestedId}:${tab}`;
    const cached = tabCacheRef.current[cacheKey];
    if (cached !== undefined && !(tab === "history" && opts?.appendHistory)) {
      setTabError(null);
      return;
    }
    const pathByTab: Record<string, string> = {
      professional: "professional",
      career: "career",
      compensation: "compensation",
      benefits: "benefits",
      personal: "personal",
      emergency: "emergency",
      epi: "epi",
      documents: "documents",
      absences: "absences",
      history: "history",
      notes: "notes",
    };
    const path = pathByTab[tab];
    if (!path) return;
    tabAbortRef.current?.abort();
    const ac = new AbortController();
    tabAbortRef.current = ac;
    const historyCached = cached as HistoryPage | undefined;
    const cursor =
      tab === "history" && opts?.appendHistory ? historyCached?.nextCursor ?? null : null;
    const url = cursor
      ? `/api/employees/${requestedId}/${path}?cursor=${encodeURIComponent(cursor)}`
      : `/api/employees/${requestedId}/${path}`;
    if (opts?.appendHistory) setHistoryLoadingMore(true);
    else {
      setTabLoading(true);
      setTabError(null);
    }
    try {
      const body = await fetchJson(url, ac.signal);
      if (employeeIdRef.current !== requestedId) return;
      if (tab === "history" && opts?.appendHistory && historyCached) {
        const page = body as HistoryPage;
        setTabCache((prev) => ({
          ...prev,
          [cacheKey]: {
            items: [...(historyCached.items ?? []), ...(page.items ?? [])],
            nextCursor: page.nextCursor ?? null,
          },
        }));
      } else {
        setTabCache((prev) => ({ ...prev, [cacheKey]: body }));
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      if (employeeIdRef.current !== requestedId) return;
      setTabError(err instanceof Error ? err.message : "Erro ao carregar a guia.");
    } finally {
      if (employeeIdRef.current === requestedId) {
        setTabLoading(false);
        setHistoryLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadTab(activeTab);
    return () => tabAbortRef.current?.abort();
  }, [activeTab, employeeId, loadTab]);

  const cacheKey = `${employeeId}:${activeTab}`;
  const cached = tabCache[cacheKey];
  const historyPage = (cached as HistoryPage | undefined) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="relative bg-background text-foreground w-[96vw] h-[94vh] max-w-[96vw] rounded-md border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="absolute right-4 top-3 z-10 flex items-center gap-2">
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md hover:bg-accent"
            aria-label="Fechar ficha"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {summaryLoading ? (
          <div className="p-8">
            <ProfileState kind="loading" message="Carregando ficha funcional…" />
          </div>
        ) : summaryError ? (
          <div className="p-8">
            <ProfileState kind="error" message={summaryError} />
          </div>
        ) : summary ? (
          <>
            <ProfileHeader summary={summary} />
            <ProfileTabs
              activeTab={activeTab}
              onTabChange={(tab) => {
                setTabError(null);
                setActiveTab(tab);
              }}
              visibleTabIds={visibleTabIds}
            />
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              <Suspense fallback={<ProfileState kind="loading" message="Carregando guia…" />}>
                {activeTab === "overview" && <PeopleOverviewTab summary={summary} />}
                {activeTab === "professional" && (
                  <PeopleProfessionalTab
                    data={(cached as Record<string, unknown>) ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "career" && (
                  <PeopleCareerTab
                    items={
                      cached && typeof cached === "object" && "items" in (cached as object)
                        ? ((cached as { items: never[] }).items ?? [])
                        : null
                    }
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "compensation" && (
                  <PeopleCompensationTab
                    data={(cached as { currentSalary?: number | null; items?: never[] }) ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                    canViewValues={Boolean(caps?.canViewCompensationValues)}
                  />
                )}
                {activeTab === "benefits" && (
                  <PeopleBenefitsTab
                    items={
                      cached && typeof cached === "object" && "items" in (cached as object)
                        ? ((cached as { items: never[] }).items ?? [])
                        : null
                    }
                    loading={tabLoading && !cached}
                    error={tabError}
                    canViewValues={Boolean(caps?.canViewCompensationValues)}
                  />
                )}
                {activeTab === "personal" && (
                  <PeoplePersonalTab
                    data={(cached as Record<string, unknown>) ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "emergency" && (
                  <PeopleEmergencyTab
                    data={(cached as { redacted?: boolean; contacts?: never[] }) ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "epi" && (
                  <PeopleEpiTab
                    data={(cached as { sizes?: Record<string, string | null>; deliveries?: never[] }) ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "documents" && (
                  <PeopleDocumentsTab
                    items={
                      cached && typeof cached === "object" && "items" in (cached as object)
                        ? ((cached as { items: never[] }).items ?? [])
                        : null
                    }
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "absences" && (
                  <PeopleAbsencesTab
                    items={
                      cached && typeof cached === "object" && "items" in (cached as object)
                        ? ((cached as { items: never[] }).items ?? [])
                        : null
                    }
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "history" && (
                  <PeopleHistoryTab
                    items={historyPage?.items ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                    nextCursor={historyPage?.nextCursor ?? null}
                    loadingMore={historyLoadingMore}
                    onLoadMore={() => void loadTab("history", { appendHistory: true })}
                  />
                )}
                {activeTab === "notes" && (
                  <PeopleNotesTab
                    data={(cached as { notes?: never[] }) ?? null}
                    loading={tabLoading && !cached}
                    error={tabError}
                  />
                )}
                {activeTab === "links" && (linksSlot ?? <ProfileState kind="empty" message="Vínculos indisponíveis." />)}
                {activeTab === "admin" && (adminSlot ?? <ProfileState kind="forbidden" message="🔒 Informação restrita" />)}
              </Suspense>
            </div>
            <footer className="shrink-0 border-t border-border px-6 py-2 text-[11px] text-muted-foreground">
              Registro funcional atualizado em {formatProfileDateTime(summary.identity.updatedAt)}
              {summary.identity.updatedByName ? ` · Última alteração por: ${summary.identity.updatedByName}` : ""}
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}
