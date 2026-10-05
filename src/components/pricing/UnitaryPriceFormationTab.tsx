import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Loader2,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCivilDatePtBrFromIso } from "@/src/lib/productionCostTablesUi";
import {
  buildUnitaryFormationProductSearchUrl,
  UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS,
  UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT,
  UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS,
  type UnitaryFormationProductSearchResponse,
  type UnitaryFormationProductSearchResult,
} from "@/src/lib/pricing/unitaryFormationProductSearch";
import {
  buildUnitaryFormationProductDetailUrl,
  unitaryFormationBomLineStatusLabel,
  unitaryFormationBomLineTypeLabel,
  unitaryFormationComparisonBadgeClass,
  unitaryFormationComparisonStatusLabel,
  unitaryFormationProcessSourceLabel,
  unitaryFormationTypeLabel,
  unitaryFormationWorkflowStateLabel,
  type UnitaryFormationProductDetailResponse,
} from "@/src/lib/pricing/unitaryFormationDetail";
import {
  appendUnitaryFormationCacheBust,
  countUnitaryFormationBomIssues,
  createUnitaryFormationRequestSequencer,
  formatUnitaryFormationDetailLoadError,
  formatUnitaryFormationSearchLoadError,
  shouldApplyUnitaryFormationDetailResult,
  shouldApplyUnitaryFormationMutationResult,
  shouldApplyUnitaryFormationSearchResult,
  shouldShowUnitaryFormationSearchCapHint,
  shouldShowUnitaryFormationSlowDetailHint,
  UNITARY_FORMATION_SLOW_DETAIL_HINT_MS,
} from "@/src/lib/pricing/unitaryFormationRequestGuard";
import {
  buildUnitaryProductionCostDraftUrl,
  buildUnitaryProductionCostPublishBody,
  buildUnitaryProductionCostPublishUrl,
  buildUnitaryPublishReviewModel,
  buildUnitaryStaleCompareModel,
  formatUnitaryDraftMutationError,
  formatUnitaryPublishMutationError,
  resolvePostPublishStatus,
  shouldShowGenerateUnitaryDraftAction,
  shouldShowMultipleUnitaryDraftsHint,
  shouldShowReviewPublishUnitaryDraftAction,
  shouldShowUnitaryStaleDraftBanner,
  unitaryWorkflowActionLabels,
} from "@/src/lib/pricing/unitaryFormationWorkflowUi";
import type { UnitaryProductionCostDraftResponse } from "@/src/lib/pricing/unitaryFormationProductionCost";
import type { UnitaryProductionCostPublishResponse } from "@/src/lib/pricing/unitaryFormationProductionCost";

export type UnitaryFormationSelectedProduct = {
  productId: string;
  sku: string;
  name: string;
  type: "PRODUCT" | "COMPONENT";
  status: string | null;
};

type UnitaryPriceFormationTabProps = {
  selected: UnitaryFormationSelectedProduct | null;
  onSelect: (product: UnitaryFormationSelectedProduct | null) => void;
  /** Alinhado a PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS. */
  canGenerateDraft?: boolean;
  /** Alinhado a PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS. */
  canPublishDraft?: boolean;
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCurrency(value, 4);
}

function qty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(value, 4);
}

function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 2)}%`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-accent/15 px-3 py-2 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold break-words mt-0.5">{value}</p>
    </div>
  );
}

function CostRow({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border/70",
        emphasize ? "bg-background font-bold" : "bg-accent/10"
      )}
    >
      <span className={cn("text-xs", emphasize ? "font-bold" : "text-muted-foreground")}>{label}</span>
      <span className={cn("text-sm tabular-nums", emphasize && "text-primary")}>{value}</span>
    </div>
  );
}

function OriginPill({
  kind,
  testId,
}: {
  kind: "LIVE" | "PUBLISHED" | "DRAFT";
  testId: string;
}) {
  const styles =
    kind === "LIVE"
      ? "border-sky-300 bg-sky-100 text-sky-900"
      : kind === "PUBLISHED"
        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
        : "border-violet-300 bg-violet-100 text-violet-900";
  const label =
    kind === "LIVE"
      ? "LIVE · engenharia"
      : kind === "PUBLISHED"
        ? "PUBLISHED · oficial"
        : "DRAFT · rascunho";
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
        styles
      )}
    >
      {label}
    </span>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  tone = "default",
  testId,
  origin,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tone?: "default" | "live" | "published" | "draft";
  testId?: string;
  origin?: "LIVE" | "PUBLISHED" | "DRAFT";
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        "rounded-2xl border bg-card p-4 sm:p-5 space-y-4",
        tone === "live" && "border-sky-200 bg-sky-50/40",
        tone === "published" && "border-emerald-200 bg-emerald-50/40",
        tone === "draft" && "border-violet-200 bg-violet-50/40",
        tone === "default" && "border-border"
      )}
    >
      <div>
        <h4 className="text-sm font-bold flex flex-wrap items-center gap-2">
          {tone === "live" ? <AlertCircle className="h-4 w-4 text-sky-700" /> : null}
          {tone === "published" ? <ShieldCheck className="h-4 w-4 text-emerald-700" /> : null}
          {title}
          {origin ? (
            <OriginPill
              kind={origin}
              testId={
                origin === "LIVE"
                  ? "unitary-formation-live-origin"
                  : origin === "PUBLISHED"
                    ? "unitary-formation-published-origin"
                    : "unitary-formation-draft-origin"
              }
            />
          ) : null}
        </h4>
        {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function UnitaryPriceFormationTab({
  selected,
  onSelect,
  canGenerateDraft = false,
  canPublishDraft = false,
}: UnitaryPriceFormationTabProps) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef(createUnitaryFormationRequestSequencer());
  const detailSeqRef = useRef(createUnitaryFormationRequestSequencer());
  const mutationSeqRef = useRef(createUnitaryFormationRequestSequencer());
  const selectedProductIdRef = useRef<string | null>(selected?.productId ?? null);
  selectedProductIdRef.current = selected?.productId ?? null;
  const softDetailRefetchRef = useRef(false);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [rows, setRows] = useState<UnitaryFormationProductSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const [detail, setDetail] = useState<UnitaryFormationProductDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailElapsedMs, setDetailElapsedMs] = useState(0);
  const [detailRefetchNonce, setDetailRefetchNonce] = useState(0);

  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);
  const [lastPublishMeta, setLastPublishMeta] = useState<{
    code: string;
    revision: number;
    publishedBy: string | null;
    publishedAt: string | null;
    status: "ATUALIZADO" | "DIVERGENTE" | "SEM_COMPARACAO";
  } | null>(null);

  const mutating = generating || publishing;

  useEffect(() => {
    if (!selected) return;
    setQuery(`${selected.sku} — ${selected.name}`);
  }, [selected]);

  useEffect(() => {
    if (!selected?.productId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setDetailElapsedMs(0);
      setConfirmGenerateOpen(false);
      setReviewOpen(false);
      setActionError(null);
      setStaleConflict(false);
      setLastPublishMeta(null);
      return;
    }

    const requestedProductId = selected.productId;
    const token = detailSeqRef.current.begin();
    const ac = new AbortController();
    const soft = softDetailRefetchRef.current;
    softDetailRefetchRef.current = false;
    setDetailLoading(true);
    setDetailError(null);
    if (!soft) setDetail(null);
    setDetailElapsedMs(0);

    void (async () => {
      try {
        const url = appendUnitaryFormationCacheBust(
          buildUnitaryFormationProductDetailUrl(requestedProductId)
        );
        const data = await fetchJsonOk<UnitaryFormationProductDetailResponse>(url, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (ac.signal.aborted) return;
        if (!detailSeqRef.current.isCurrent(token)) return;
        if (
          !shouldApplyUnitaryFormationDetailResult(
            requestedProductId,
            selectedProductIdRef.current
          )
        ) {
          return;
        }
        setDetail(data);
        setDetailError(null);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (!detailSeqRef.current.isCurrent(token)) return;
        if (
          !shouldApplyUnitaryFormationDetailResult(
            requestedProductId,
            selectedProductIdRef.current
          )
        ) {
          return;
        }
        setDetail(null);
        setDetailError(formatUnitaryFormationDetailLoadError(e));
      } finally {
        if (!ac.signal.aborted && detailSeqRef.current.isCurrent(token)) {
          setDetailLoading(false);
        }
      }
    })();

    return () => ac.abort();
  }, [selected?.productId, detailRefetchNonce]);

  const requestDetailRefetch = useCallback(() => {
    softDetailRefetchRef.current = true;
    setDetailRefetchNonce((n) => n + 1);
  }, []);

  const runGenerateDraft = useCallback(async () => {
    if (!selected?.productId || generating) return;
    const productId = selected.productId;
    const token = mutationSeqRef.current.begin();
    setGenerating(true);
    setActionError(null);
    setStaleConflict(false);
    try {
      const url = appendUnitaryFormationCacheBust(buildUnitaryProductionCostDraftUrl(productId));
      await fetchJsonOk<UnitaryProductionCostDraftResponse>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      if (
        !shouldApplyUnitaryFormationMutationResult({
          requestedProductId: productId,
          selectedProductId: selectedProductIdRef.current,
          mutationToken: token,
          latestMutationToken: mutationSeqRef.current.latest,
        })
      ) {
        return;
      }
      setConfirmGenerateOpen(false);
      setLastPublishMeta(null);
      requestDetailRefetch();
    } catch (e) {
      if (
        !shouldApplyUnitaryFormationMutationResult({
          requestedProductId: productId,
          selectedProductId: selectedProductIdRef.current,
          mutationToken: token,
          latestMutationToken: mutationSeqRef.current.latest,
        })
      ) {
        return;
      }
      setActionError(formatUnitaryDraftMutationError(e));
    } finally {
      if (mutationSeqRef.current.isCurrent(token)) setGenerating(false);
    }
  }, [selected?.productId, generating, requestDetailRefetch]);

  const runPublishDraft = useCallback(async () => {
    if (!selected?.productId || !detail?.draftCost.versionId || publishing) return;
    const productId = selected.productId;
    const draftVersionId = detail.draftCost.versionId;
    const token = mutationSeqRef.current.begin();
    setPublishing(true);
    setActionError(null);
    setStaleConflict(false);
    try {
      const url = appendUnitaryFormationCacheBust(
        buildUnitaryProductionCostPublishUrl(productId)
      );
      const published = await fetchJsonOk<UnitaryProductionCostPublishResponse>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildUnitaryProductionCostPublishBody(draftVersionId)),
        cache: "no-store",
      });
      if (
        !shouldApplyUnitaryFormationMutationResult({
          requestedProductId: productId,
          selectedProductId: selectedProductIdRef.current,
          mutationToken: token,
          latestMutationToken: mutationSeqRef.current.latest,
        })
      ) {
        return;
      }
      setReviewOpen(false);
      setLastPublishMeta({
        code: published.code,
        revision: published.revision,
        publishedBy: published.publishedBy,
        publishedAt: published.publishedAt,
        status: "SEM_COMPARACAO",
      });
      requestDetailRefetch();
    } catch (e) {
      if (
        !shouldApplyUnitaryFormationMutationResult({
          requestedProductId: productId,
          selectedProductId: selectedProductIdRef.current,
          mutationToken: token,
          latestMutationToken: mutationSeqRef.current.latest,
        })
      ) {
        return;
      }
      const formatted = formatUnitaryPublishMutationError(e);
      setActionError(formatted.message);
      setStaleConflict(formatted.stale);
      if (formatted.stale) {
        setReviewOpen(false);
        requestDetailRefetch();
      }
    } finally {
      if (mutationSeqRef.current.isCurrent(token)) setPublishing(false);
    }
  }, [selected?.productId, detail?.draftCost.versionId, publishing, requestDetailRefetch]);

  useEffect(() => {
    if (!detailLoading) {
      setDetailElapsedMs(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setDetailElapsedMs(Date.now() - started);
    }, 500);
    return () => window.clearInterval(timer);
  }, [detailLoading, selected?.productId]);

  const runSearch = useCallback(async (term: string, signal: AbortSignal, token: number) => {
    const q = term.trim();
    if (q.length < UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS) {
      if (shouldApplyUnitaryFormationSearchResult(token, searchSeqRef.current.latest)) {
        setRows([]);
        setSearchError(null);
        setSearchLoading(false);
      }
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      const url = appendUnitaryFormationCacheBust(buildUnitaryFormationProductSearchUrl(q));
      const data = await fetchJsonOk<UnitaryFormationProductSearchResponse>(url, {
        signal,
        cache: "no-store",
      });
      if (signal.aborted) return;
      if (!shouldApplyUnitaryFormationSearchResult(token, searchSeqRef.current.latest)) return;
      setRows(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      if (signal.aborted) return;
      if (!shouldApplyUnitaryFormationSearchResult(token, searchSeqRef.current.latest)) return;
      setRows([]);
      setSearchError(formatUnitaryFormationSearchLoadError(e));
    } finally {
      if (!signal.aborted && shouldApplyUnitaryFormationSearchResult(token, searchSeqRef.current.latest)) {
        setSearchLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (selected && query === `${selected.sku} — ${selected.name}`) {
      setRows([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    const ac = new AbortController();
    const token = searchSeqRef.current.begin();
    const timer = window.setTimeout(() => {
      void runSearch(query, ac.signal, token);
    }, UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [query, open, runSearch, selected]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const trimmed = query.trim();
  const showMinCharsHint =
    open && trimmed.length > 0 && trimmed.length < UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS;
  const showCapHint = shouldShowUnitaryFormationSearchCapHint(rows.length);
  const showSlowDetailHint = shouldShowUnitaryFormationSlowDetailHint(
    detailLoading,
    detailElapsedMs,
    UNITARY_FORMATION_SLOW_DETAIL_HINT_MS
  );
  const bomIssues = countUnitaryFormationBomIssues(detail?.bom ?? []);

  const clearSelection = () => {
    detailSeqRef.current.begin();
    searchSeqRef.current.begin();
    mutationSeqRef.current.begin();
    onSelect(null);
    setQuery("");
    setRows([]);
    setOpen(true);
    setActiveIndex(-1);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setSearchError(null);
    setConfirmGenerateOpen(false);
    setReviewOpen(false);
    setActionError(null);
    setStaleConflict(false);
    setLastPublishMeta(null);
  };

  const selectRow = (row: UnitaryFormationProductSearchResult) => {
    // Invalida detalhe/busca/mutation em voo imediatamente ao trocar SKU.
    detailSeqRef.current.begin();
    mutationSeqRef.current.begin();
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setConfirmGenerateOpen(false);
    setReviewOpen(false);
    setActionError(null);
    setStaleConflict(false);
    setLastPublishMeta(null);
    onSelect({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      type: row.type,
      status: row.status,
    });
    setQuery(`${row.sku} — ${row.name}`);
    setOpen(false);
    setRows([]);
    setActiveIndex(-1);
    setSearchError(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0 && rows[activeIndex]) {
      e.preventDefault();
      selectRow(rows[activeIndex]!);
    }
  };

  const identification = detail?.identification;
  const process = detail?.process;
  const live = detail?.liveCost;
  const draft = detail?.draftCost;
  const published = detail?.publishedCost;
  const comparison = detail?.comparisons?.liveVsPublished ?? detail?.comparison;
  const comparisons = detail?.comparisons;
  const workflow = detail?.workflow;
  const bom = detail?.bom ?? [];
  const liveProcess = live?.processTotal ?? live?.processCost;
  const publishedProcess = published?.processTotal ?? published?.processCost;
  const draftProcess = draft?.processTotal ?? draft?.processCost;

  const showGenerate = shouldShowGenerateUnitaryDraftAction({
    canGenerate: canGenerateDraft,
    detail,
    mutating,
  });
  const showReviewPublish = shouldShowReviewPublishUnitaryDraftAction({
    canPublish: canPublishDraft,
    detail,
    mutating,
  });
  const showStaleBanner = shouldShowUnitaryStaleDraftBanner(detail) || staleConflict;
  const showMultipleDraftsHint = shouldShowMultipleUnitaryDraftsHint(detail);
  const actionLabels = unitaryWorkflowActionLabels(workflow?.state ?? "NO_DRAFT");
  const reviewModel = detail && reviewOpen ? buildUnitaryPublishReviewModel(detail) : null;
  const staleCompare = detail && showStaleBanner ? buildUnitaryStaleCompareModel(detail) : null;

  useEffect(() => {
    if (!detail) return;
    setLastPublishMeta((prev) => {
      if (!prev) return prev;
      const status = resolvePostPublishStatus({
        live: detail.liveCost,
        published: detail.publishedCost,
      });
      if (status === prev.status) return prev;
      return { ...prev, status };
    });
  }, [detail]);

  return (
    <div className="space-y-4" data-tour="pricing-unitary-formation-tab">
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3">
        <div>
          <h3 className="text-base font-bold">Formação de Preço Unitária</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            LIVE = engenharia atual · DRAFT = rascunho congelado · PUBLISHED = oficial vigente.
            Os três conceitos permanecem separados.
          </p>
        </div>

        <div ref={rootRef} className="relative max-w-xl">
          <label htmlFor={`${autoId}-input`} className="text-xs font-bold uppercase text-muted-foreground">
            Buscar produto / componente
          </label>
          <div className="relative mt-1.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              id={`${autoId}-input`}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              autoComplete="off"
              placeholder="Digite SKU ou nome (ex.: 320.03AA)…"
              className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActiveIndex(-1);
                if (selected) {
                  detailSeqRef.current.begin();
                  onSelect(null);
                  setDetail(null);
                  setDetailError(null);
                  setDetailLoading(false);
                }
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              data-testid="unitary-formation-product-search"
            />
            {searchLoading ? (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            ) : query || selected ? (
              <button
                type="button"
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent"
                onClick={clearSelection}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {open ? (
            <div
              id={listId}
              role="listbox"
              className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden"
              data-testid="unitary-formation-search-dropdown"
            >
              {showMinCharsHint ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Digite ao menos {UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS} caracteres.
                </p>
              ) : null}
              {searchError ? (
                <p
                  className="px-3 py-2 text-xs text-red-700"
                  data-testid="unitary-formation-search-error"
                >
                  {searchError}
                </p>
              ) : null}
              {!showMinCharsHint &&
              !searchError &&
              !searchLoading &&
              trimmed.length >= UNITARY_FORMATION_PRODUCT_SEARCH_MIN_CHARS &&
              rows.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum produto encontrado.</p>
              ) : null}
              {rows.length > 0 ? (
                <>
                  <ul className="max-h-72 overflow-y-auto py-1">
                    {rows.map((row, index) => (
                      <li key={row.productId}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={activeIndex === index}
                          className={cn(
                            "w-full px-3 py-2 text-left hover:bg-accent/60",
                            activeIndex === index && "bg-accent/60"
                          )}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectRow(row)}
                          data-testid={`unitary-formation-search-option-${row.sku}`}
                        >
                          <p className="text-sm font-semibold tracking-tight">
                            {row.sku} — {row.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {unitaryFormationTypeLabel(row.type)}
                            {row.status && row.status !== "ACTIVE" ? ` · ${row.status}` : ""}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {showCapHint ? (
                    <p
                      className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border bg-accent/20"
                      data-testid="unitary-formation-search-cap-hint"
                    >
                      Mostrando até {UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT} resultados. Refine a
                      busca (SKU completo) para priorizar o item desejado.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {selected ? (
          <div
            className="rounded-xl border border-border bg-accent/20 px-3 py-2 text-sm"
            data-testid="unitary-formation-selected-product"
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Produto selecionado
            </p>
            <p className="font-semibold">
              {selected.sku} — {selected.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {unitaryFormationTypeLabel(selected.type)}
              {selected.status ? ` · ${selected.status}` : ""}
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            data-testid="unitary-formation-empty-state"
          >
            Selecione um produto ou componente para visualizar a formação unitária.
          </div>
        )}
      </div>

      {selected && detailLoading ? (
        <div
          className="rounded-2xl border border-border bg-card p-8 text-center"
          data-testid="unitary-formation-detail-loading"
        >
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          <p className="text-xs text-muted-foreground">
              Carregando detalhe unitário (LIVE + DRAFT + PUBLISHED)…
          </p>
          {showSlowDetailHint ? (
            <p
              className="text-xs text-amber-800 mt-2"
              data-testid="unitary-formation-slow-detail-hint"
            >
              Consulta demorando — os motores oficiais ainda estão respondendo. Aguarde sem
              trocar o SKU.
            </p>
          ) : null}
        </div>
      ) : null}

      {selected && detailError && !detailLoading ? (
        <div
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          data-testid="unitary-formation-detail-error"
        >
          <p className="font-bold inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Erro ao carregar
          </p>
          <p className="mt-1 text-xs">{detailError}</p>
        </div>
      ) : null}

      {selected && detail && !detailLoading ? (
        <div className="space-y-4" data-testid="unitary-formation-detail">
          {(showGenerate ||
            showReviewPublish ||
            showMultipleDraftsHint ||
            actionError ||
            (!canGenerateDraft && !canPublishDraft)) ? (
            <SectionCard title="Ações do workflow" testId="unitary-formation-actions">
              <div className="flex flex-wrap items-center gap-2">
                {showGenerate ? (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => {
                      setActionError(null);
                      setConfirmGenerateOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
                    data-testid="unitary-formation-generate-draft"
                  >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {actionLabels.generateLabel}
                  </button>
                ) : null}
                {showReviewPublish ? (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => {
                      setActionError(null);
                      setStaleConflict(false);
                      setReviewOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-950 disabled:opacity-50"
                    data-testid="unitary-formation-review-publish"
                  >
                    {actionLabels.reviewLabel}
                  </button>
                ) : null}
                {!canGenerateDraft && !canPublishDraft ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="unitary-formation-actions-view-only"
                  >
                    Consulta disponível. Sem permissão para gerar ou publicar rascunhos.
                  </p>
                ) : null}
              </div>
              {showMultipleDraftsHint ? (
                <p
                  className="text-[11px] text-muted-foreground"
                  data-testid="unitary-formation-multiple-drafts-hint"
                >
                  Existem {draft?.draftCount} rascunhos. O workflow usa somente o mais recente —
                  versões antigas não podem ser selecionadas nesta tela.
                </p>
              ) : null}
              {actionError ? (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  data-testid="unitary-formation-action-error"
                >
                  {actionError}
                </div>
              ) : null}
            </SectionCard>
          ) : null}

          {showStaleBanner ? (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 space-y-3"
              data-testid="unitary-formation-stale-banner"
            >
              <p className="text-sm font-bold text-amber-950">
                Este rascunho não representa mais o custo LIVE atual.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="DRAFT" value={money(staleCompare?.draftTotal)} />
                <Field label="LIVE atual" value={money(staleCompare?.liveTotal)} />
                <Field label="Diferença R$" value={money(staleCompare?.diffValue)} />
              </div>
              {canGenerateDraft ? (
                <button
                  type="button"
                  disabled={mutating}
                  onClick={() => {
                    setActionError(null);
                    setConfirmGenerateOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
                  data-testid="unitary-formation-generate-new-draft"
                >
                  Gerar novo rascunho
                </button>
              ) : null}
            </div>
          ) : null}

          {lastPublishMeta ? (
            <div
              className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3"
              data-testid="unitary-formation-post-publish"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-emerald-950">Publicação concluída</span>
                <span
                  className="inline-flex rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-black uppercase"
                  data-testid="unitary-formation-post-publish-status"
                >
                  {lastPublishMeta.status}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Versão" value={lastPublishMeta.code} />
                <Field label="Revisão" value={String(lastPublishMeta.revision)} />
                <Field label="Publicado por" value={lastPublishMeta.publishedBy ?? "—"} />
                <Field
                  label="Publicado em"
                  value={
                    lastPublishMeta.publishedAt
                      ? new Date(lastPublishMeta.publishedAt).toLocaleString("pt-BR")
                      : "—"
                  }
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="LIVE" value={money(live?.totalIndustrialCost)} />
                <Field label="PUBLISHED novo" value={money(published?.unitProductionCost)} />
                <Field label="Diferença" value={money(comparison?.diffValue)} />
              </div>
            </div>
          ) : null}

          <SectionCard title="Identificação" testId="unitary-formation-identification">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="SKU" value={identification?.sku ?? "—"} />
              <Field label="Nome" value={identification?.name ?? "—"} />
              <Field
                label="Tipo"
                value={unitaryFormationTypeLabel(identification?.type ?? "")}
              />
              <Field label="Status" value={identification?.status ?? "—"} />
              <Field label="Costing Mode" value={identification?.costingMode ?? "—"} />
            </div>
          </SectionCard>

          <SectionCard title="Processo" testId="unitary-formation-process">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field
                label="Ciclo (s)"
                value={
                  process?.cycleTimeSeconds == null
                    ? "—"
                    : formatNumber(process.cycleTimeSeconds, 2)
                }
              />
              <Field
                label="Cavidades"
                value={process?.cavities == null ? "—" : String(process.cavities)}
              />
              <Field label="Eficiência" value={percent(process?.efficiencyExpected)} />
              <Field
                label="Setup (min)"
                value={process?.setupTimeMin == null ? "—" : formatNumber(process.setupTimeMin, 2)}
              />
              <Field
                label="Lote padrão"
                value={
                  process?.defaultLotSize == null ? "—" : formatNumber(process.defaultLotSize, 2)
                }
              />
              <Field
                label="Fonte do processo"
                value={
                  process
                    ? unitaryFormationProcessSourceLabel(process.processSource)
                    : "—"
                }
              />
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <SectionCard
              title="Custo Atual / LIVE"
              subtitle="Motor oficial de engenharia (não publicado). Não é custo oficial vigente."
              tone="live"
              origin="LIVE"
              testId="unitary-formation-live-cost"
            >
              {live?.status === "ERROR" ? (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  data-testid="unitary-formation-live-error"
                >
                  <p className="font-bold">Erro no cálculo LIVE</p>
                  <p className="text-xs mt-1">
                    {live.error?.code ? `${live.error.code}: ` : ""}
                    {live.error?.message ?? "Custo LIVE indisponível."}
                  </p>
                </div>
              ) : null}
              {live?.costAnalysisPartial ? (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 inline-flex items-start gap-2"
                  data-testid="unitary-formation-live-partial"
                >
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Custo parcial: há linhas de BOM excluídas ou subárvore incompleta.
                </div>
              ) : null}
              <div className="space-y-2">
                <CostRow label="Material" value={money(live?.materialCost)} />
                <CostRow label="HH" value={money(live?.laborCost)} />
                <CostRow label="HM" value={money(live?.machineCost)} />
                <CostRow label="Processo (HH+HM)" value={money(liveProcess)} />
                <CostRow label="Overhead" value={money(live?.overheadCost)} />
                <CostRow label="Outros" value={money(live?.otherCost)} />
                <CostRow label="Custo Industrial Total" value={money(live?.totalIndustrialCost)} emphasize />
              </div>
              {live?.calculationHash ? (
                <p className="text-[10px] text-muted-foreground break-all">
                  Hash: {live.calculationHash}
                </p>
              ) : null}
              {live?.warnings && live.warnings.length > 0 ? (
                <div className="rounded-xl border border-border bg-background/70 p-3 space-y-1">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Warnings</p>
                  <ul className="text-xs space-y-1 list-disc pl-4">
                    {live.warnings.map((w) => (
                      <li key={`${w.code}-${w.message}`}>
                        <span className="font-semibold">{w.code}</span>: {w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="DRAFT mais recente"
              subtitle="Rascunho congelado. O workflow utiliza somente a versão mais recente."
              tone="draft"
              origin="DRAFT"
              testId="unitary-formation-draft-cost"
            >
              {!draft?.exists ? (
                <div
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                  data-testid="unitary-formation-draft-missing"
                >
                  Sem DRAFT de custo de produção para este item.
                </div>
              ) : (
                <>
                  {draft.staleRelativeToLive ? (
                    <div
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
                      data-testid="unitary-formation-draft-stale"
                    >
                      DRAFT desatualizado em relação ao LIVE atual.
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <CostRow label="Material" value={money(draft.materialCost)} />
                    <CostRow label="HH" value={money(draft.laborCost)} />
                    <CostRow label="HM" value={money(draft.machineCost)} />
                    <CostRow label="Processo (HH+HM)" value={money(draftProcess)} />
                    <CostRow label="Overhead" value={money(draft.overheadCost)} />
                    <CostRow label="Outros" value={money(draft.otherCost)} />
                    <CostRow
                      label="Custo do DRAFT"
                      value={money(draft.unitProductionCost)}
                      emphasize
                    />
                  </div>
                </>
              )}
            </SectionCard>

            <SectionCard
              title="Custo Oficial / PUBLISHED"
              subtitle="Tabela versionada vigente para a data de referência. Fonte oficial — distinta do LIVE."
              tone="published"
              origin="PUBLISHED"
              testId="unitary-formation-published-cost"
            >
              {published?.status === "SEM_CUSTO" || published?.exists === false ? (
                <div
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                  data-testid="unitary-formation-published-missing"
                >
                  Sem custo oficial publicado vigente para este item.
                </div>
              ) : null}
              {published?.status === "ERROR" ? (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  data-testid="unitary-formation-published-error"
                >
                  <p className="font-bold">Erro ao consultar custo publicado</p>
                  <p className="text-xs mt-1">{published.error?.message ?? "—"}</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <CostRow label="Material" value={money(published?.materialCost)} />
                <CostRow label="HH" value={money(published?.laborCost)} />
                <CostRow label="HM" value={money(published?.machineCost)} />
                <CostRow label="Processo (HH+HM)" value={money(publishedProcess)} />
                <CostRow label="Overhead" value={money(published?.overheadCost)} />
                <CostRow label="Outros" value={money(published?.otherCost)} />
                <CostRow
                  label="Custo industrial publicado"
                  value={money(published?.unitProductionCost)}
                  emphasize
                />
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="Referências de versão"
            subtitle="Metadados de DRAFT e PUBLISHED — fora dos grids de custo para não atrapalhar a comparação."
            testId="unitary-formation-version-refs"
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div
                className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-3"
                data-testid="unitary-formation-draft-version-meta"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-violet-900">
                  DRAFT
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label="Versão"
                    value={
                      draft?.exists && draft.code
                        ? `${draft.code} (${draft.status ?? "DRAFT"})`
                        : "—"
                    }
                  />
                  <Field
                    label="Revisão"
                    value={
                      draft?.exists && draft.revision != null ? String(draft.revision) : "—"
                    }
                  />
                  <Field
                    label="Criado em"
                    value={
                      draft?.exists && draft.createdAt
                        ? new Date(draft.createdAt).toLocaleString("pt-BR")
                        : "—"
                    }
                  />
                  <Field
                    label="Criado por"
                    value={draft?.exists ? draft.createdBy ?? "—" : "—"}
                  />
                </div>
              </div>
              <div
                className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-3"
                data-testid="unitary-formation-published-version-meta"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900">
                  PUBLISHED · publicação
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label="Versão"
                    value={
                      published?.code
                        ? `${published.code}${
                            published.versionStatus ? ` (${published.versionStatus})` : ""
                          }`
                        : "—"
                    }
                  />
                  <Field
                    label="Revisão"
                    value={published?.revision == null ? "—" : String(published.revision)}
                  />
                  <Field
                    label="Vigência"
                    value={formatCivilDatePtBrFromIso(published?.effectiveDate)}
                  />
                  <Field
                    label="Publicado em"
                    value={
                      published?.publishedAt
                        ? new Date(published.publishedAt).toLocaleString("pt-BR")
                        : "—"
                    }
                  />
                  <Field label="Publicado por" value={published?.publishedBy ?? "—"} />
                </div>
              </div>
            </div>
          </SectionCard>

          {workflow ? (
            <SectionCard title="Estado do workflow" testId="unitary-formation-workflow">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex rounded-full border border-border bg-accent/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide"
                  data-testid="unitary-formation-workflow-state"
                >
                  {unitaryFormationWorkflowStateLabel(workflow.state)}
                </span>
                {workflow.traceStatus ? (
                  <span className="text-[11px] text-muted-foreground">
                    Trace oficial: {workflow.traceStatus}
                  </span>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Comparações" testId="unitary-formation-comparison">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {comparison ? (
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                    unitaryFormationComparisonBadgeClass(comparison.status)
                  )}
                  data-testid="unitary-formation-comparison-badge"
                >
                  LIVE × PUBLISHED: {unitaryFormationComparisonStatusLabel(comparison.status)}
                </span>
              ) : null}
              {detail.meta.referenceDate ? (
                <span className="text-[11px] text-muted-foreground">
                  Referência: {formatCivilDatePtBrFromIso(detail.meta.referenceDate)}
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Field label="Custo LIVE" value={money(comparison?.liveCost)} />
              <Field label="Custo PUBLISHED" value={money(comparison?.publishedCost)} />
              <Field label="Diferença R$" value={money(comparison?.diffValue)} />
              <Field label="Diferença %" value={percent(comparison?.diffPercent)} />
            </div>
            {comparisons ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div
                  className="rounded-xl border border-border p-3 space-y-2"
                  data-testid="unitary-formation-comparison-draft-published"
                >
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    DRAFT × PUBLISHED · {unitaryFormationComparisonStatusLabel(comparisons.draftVsPublished.status)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="DRAFT" value={money(comparisons.draftVsPublished.leftTotal)} />
                    <Field label="PUBLISHED" value={money(comparisons.draftVsPublished.rightTotal)} />
                  </div>
                </div>
                <div
                  className="rounded-xl border border-border p-3 space-y-2"
                  data-testid="unitary-formation-comparison-draft-live"
                >
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    DRAFT × LIVE · {unitaryFormationComparisonStatusLabel(comparisons.draftVsLive.status)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="DRAFT" value={money(comparisons.draftVsLive.leftTotal)} />
                    <Field label="LIVE" value={money(comparisons.draftVsLive.rightTotal)} />
                  </div>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="BOM (do motor LIVE)" testId="unitary-formation-bom">
            {bomIssues.errorLines > 0 || bomIssues.excludedLines > 0 ? (
              <div
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 inline-flex items-start gap-2"
                data-testid="unitary-formation-bom-issues"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                BOM com alertas: {bomIssues.errorLines} linha(s) com erro
                {bomIssues.excludedLines > 0
                  ? ` · ${bomIssues.excludedLines} excluída(s) do custo`
                  : ""}
                .
              </div>
            ) : null}
            {bom.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma linha de BOM disponível nesta resposta
                {live?.status === "ERROR" ? " (cálculo LIVE com erro)." : "."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="bg-muted text-muted-foreground uppercase tracking-wide">
                    <tr>
                      <th className="p-3 text-left font-semibold">SKU</th>
                      <th className="p-3 text-left font-semibold">Nome</th>
                      <th className="p-3 text-left font-semibold">Tipo</th>
                      <th className="p-3 text-right font-semibold">Quantidade</th>
                      <th className="p-3 text-right font-semibold">Perda</th>
                      <th className="p-3 text-right font-semibold">Custo unitário usado</th>
                      <th className="p-3 text-right font-semibold">Custo total</th>
                      <th className="p-3 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bom.map((line, index) => (
                      <tr
                        key={line.bomLineId ?? `${line.sku}-${index}`}
                        className={cn(line.excludedFromCost && "bg-amber-50/50")}
                      >
                        <td className="p-3 font-mono font-semibold">{line.sku ?? "—"}</td>
                        <td className="p-3">{line.name ?? "—"}</td>
                        <td className="p-3">{unitaryFormationBomLineTypeLabel(line.lineType)}</td>
                        <td className="p-3 text-right tabular-nums">{qty(line.quantity)}</td>
                        <td className="p-3 text-right tabular-nums">{percent(line.lossPercentage)}</td>
                        <td className="p-3 text-right tabular-nums">{money(line.unitCostUsed)}</td>
                        <td className="p-3 text-right tabular-nums font-semibold">
                          {money(line.lineTotalCost)}
                        </td>
                        <td className="p-3">
                          <span
                            className={cn(
                              "inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                              line.excludedFromCost || line.errorCode
                                ? "bg-amber-100 text-amber-950"
                                : "bg-emerald-100 text-emerald-900"
                            )}
                          >
                            {unitaryFormationBomLineStatusLabel(line)}
                          </span>
                          {line.message ? (
                            <p className="text-[10px] text-muted-foreground mt-1 max-w-[220px] whitespace-normal">
                              {line.message}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {confirmGenerateOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar geração de rascunho"
          data-testid="unitary-formation-generate-confirm"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 space-y-4 shadow-lg">
            <h4 className="text-sm font-bold">Gerar rascunho de custo?</h4>
            <p className="text-xs text-muted-foreground">
              O servidor recalcula o LIVE oficial e congela um novo DRAFT (1 item). Nenhum custo
              enviado pelo browser será usado. Versões PUBLISHED não são alteradas.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={generating}
                onClick={() => setConfirmGenerateOpen(false)}
                className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={generating}
                onClick={() => void runGenerateDraft()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
                data-testid="unitary-formation-generate-confirm-submit"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar geração
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewOpen && reviewModel ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Revisar e publicar custo"
          data-testid="unitary-formation-review-modal"
        >
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 space-y-4 shadow-lg">
            <div>
              <h4 className="text-sm font-bold">Revisar e publicar</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comparação OFICIAL atual × NOVO DRAFT. A publicação envia apenas productId e
                draftVersionId.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Oficial atual" value={money(reviewModel.officialTotal)} />
              <Field label="Novo DRAFT" value={money(reviewModel.draftTotal)} />
              <Field label="Diferença R$" value={money(reviewModel.diffValue)} />
              <Field label="Diferença %" value={percent(reviewModel.diffPercent)} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-accent/30 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Componente</th>
                    <th className="p-2 text-right">Oficial</th>
                    <th className="p-2 text-right">DRAFT</th>
                    <th className="p-2 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewModel.lines.map((line) => (
                    <tr key={line.key} className="border-t border-border/70">
                      <td className={cn("p-2", line.indent && "pl-6 text-muted-foreground")}>
                        {line.label}
                      </td>
                      <td className="p-2 text-right tabular-nums">{money(line.official)}</td>
                      <td className="p-2 text-right tabular-nums">{money(line.draft)}</td>
                      <td className="p-2 text-right tabular-nums">{money(line.diff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={publishing}
                onClick={() => setReviewOpen(false)}
                className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={publishing || !reviewModel.draftVersionId}
                onClick={() => void runPublishDraft()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                data-testid="unitary-formation-publish-submit"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Publicar novo custo oficial
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
