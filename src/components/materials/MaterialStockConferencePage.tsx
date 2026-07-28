/**
 * Página operacional — Conferência de estoque.
 * Separada do cadastro/custos (MaterialModule).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getMaterialStockConferenceDetailPath,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import {
  canEditMaterialStockParameters,
  MATERIAL_STOCK_CONFERENCE_PAGE_TITLE,
  resolveMaterialStockConferenceLayout,
  type MaterialStockConferenceLayoutMode,
} from "@/src/lib/materialStockConferenceUi";
import {
  applyConferenceSuccessToListItem,
  type MaterialStockConferenceApiResult,
} from "@/src/lib/materialStockConferenceClient";
import { applyParametersSuccessToListItem } from "@/src/lib/materialStockParametersClient";
import type { MaterialStockParametersApiResult } from "@/src/lib/materialStockParametersClient";
import {
  appendStockTabletSearchPages,
  fetchMaterialStockTabletSearch,
  hasMoreStockTabletPages,
  isMaterialStockSearchAbortError,
  MATERIAL_STOCK_LIST_PAGE_SIZE,
  MATERIAL_STOCK_LIST_SEARCH_DEBOUNCE_MS,
  resolvePreservedStockSelection,
  shouldAutoSelectFirstStockItem,
  type MaterialStockListFilterId,
} from "@/src/lib/materialStockTabletSearchClient";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes";
import { TabResourceKeys } from "@/src/lib/moduleTabResources";
import { usePermissions } from "@/src/hooks/usePermissions";
import { MaterialStockConferenceDialog } from "@/src/components/materials/MaterialStockConferenceDialog";
import { MaterialStockHistoryPanel } from "@/src/components/materials/MaterialStockHistoryPanel";
import { MaterialStockParametersDialog } from "@/src/components/materials/MaterialStockParametersDialog";
import {
  MaterialStockConferenceWorkspace,
  type MaterialStockConferenceViewKind,
} from "@/src/components/materials/MaterialStockConferenceWorkspace";

function useStockConferenceLayoutMode(): MaterialStockConferenceLayoutMode {
  const [mode, setMode] = useState<MaterialStockConferenceLayoutMode>("split");

  useEffect(() => {
    const compute = () => {
      const width = window.innerWidth;
      const orientation = window.matchMedia("(orientation: portrait)").matches
        ? "portrait"
        : "landscape";
      setMode(resolveMaterialStockConferenceLayout({ width, orientation }));
    };
    compute();
    window.addEventListener("resize", compute);
    const mq = window.matchMedia("(orientation: portrait)");
    mq.addEventListener?.("change", compute);
    return () => {
      window.removeEventListener("resize", compute);
      mq.removeEventListener?.("change", compute);
    };
  }, []);

  return mode;
}

export function MaterialStockConferencePage() {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { materialId: routeMaterialId } = useParams<{ materialId?: string }>();
  const layoutMode = useStockConferenceLayoutMode();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<MaterialStockListFilterId>("ALL");
  const [rows, setRows] = useState<MaterialStockTabletListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    routeMaterialId ?? null
  );
  const [conferenceOpen, setConferenceOpen] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const requestGenRef = useRef(0);
  const didAutoSelectRef = useRef(Boolean(routeMaterialId));

  const canViewHistory = permissions.canViewTabResource(
    TabResourceKeys.SUPRIMENTOS_CATALOGO
  );
  const canConference = canViewHistory;
  const canEditParameters = canEditMaterialStockParameters({
    canPerformAction: (resourceKey, action) =>
      permissions.canPerformAction(resourceKey, action as "update"),
    effectivePermissions: permissions.authUser?.effectivePermissions ?? [],
    role: permissions.authUser?.role ?? null,
  });

  useEffect(() => {
    const t = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      MATERIAL_STOCK_LIST_SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setSelectedId(routeMaterialId ?? null);
    if (routeMaterialId) didAutoSelectRef.current = true;
  }, [routeMaterialId]);

  const runSearch = useCallback(
    async (nextPage: number, mode: "replace" | "append") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++requestGenRef.current;

      if (mode === "replace") {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const data = await fetchMaterialStockTabletSearch({
          page: nextPage,
          pageSize: MATERIAL_STOCK_LIST_PAGE_SIZE,
          q: debouncedSearch,
          filter,
          signal: controller.signal,
        });

        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }

        setPage(data.page);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setRows((prev) =>
          mode === "append"
            ? appendStockTabletSearchPages(prev, data.rows)
            : data.rows
        );
        setError(null);
      } catch (e: unknown) {
        if (isMaterialStockSearchAbortError(e)) return;
        if (gen !== requestGenRef.current) return;
        setError(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar matérias-primas para conferência."
        );
        if (mode === "replace") setRows([]);
      } finally {
        if (gen === requestGenRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedSearch, filter]
  );

  useEffect(() => {
    void runSearch(1, "replace");
    return () => {
      abortRef.current?.abort();
    };
  }, [runSearch]);

  useEffect(() => {
    if (loading || error || rows.length === 0) return;
    const firstId = shouldAutoSelectFirstStockItem({
      layoutMode,
      routeMaterialId,
      rows,
      alreadyAutoSelected: didAutoSelectRef.current,
    });
    if (!firstId) return;
    didAutoSelectRef.current = true;
    setSelectedId(firstId);
    navigate(getMaterialStockConferenceDetailPath(firstId), { replace: true });
  }, [loading, error, rows, layoutMode, routeMaterialId, navigate]);

  useEffect(() => {
    if (!selectedId || loading) return;
    const preserved = resolvePreservedStockSelection(selectedId, rows);
    if (preserved) return;
    if (!routeMaterialId) {
      setSelectedId(null);
    }
  }, [rows, selectedId, loading, routeMaterialId]);

  const hasMore = hasMoreStockTabletPages({
    page,
    totalPages,
    loadedCount: rows.length,
    total,
  });

  const selectedItem = rows.find((r) => r.id === selectedId) ?? null;

  const viewKind: MaterialStockConferenceViewKind = useMemo(() => {
    if (loading && rows.length === 0) return "loading";
    if (error && rows.length === 0) return "error";
    if (!loading && !error && rows.length === 0) return "empty";
    return "ready";
  }, [loading, error, rows.length]);

  const onSelect = (id: string) => {
    didAutoSelectRef.current = true;
    setSelectedId(id);
    setHistoryOpen(false);
    setParametersOpen(false);
    navigate(getMaterialStockConferenceDetailPath(id), { replace: false });
  };

  const onClearSelection = () => {
    didAutoSelectRef.current = true;
    setSelectedId(null);
    setConferenceOpen(false);
    setParametersOpen(false);
    setHistoryOpen(false);
    navigate(MATERIALS_SECTION_PATHS.stockConference, { replace: false });
  };

  const onFilterChange = (next: MaterialStockListFilterId) => {
    setFilter(next);
    setPage(1);
  };

  const onConferenceSuccess = (result: MaterialStockConferenceApiResult) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === result.material.id
          ? applyConferenceSuccessToListItem(row, result)
          : row
      )
    );
  };

  const onParametersSuccess = (result: MaterialStockParametersApiResult) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === result.material.id
          ? applyParametersSuccessToListItem(row, result)
          : row
      )
    );
  };

  return (
    <div className="space-y-4" data-testid="stock-conference-page">
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          {MATERIAL_STOCK_CONFERENCE_PAGE_TITLE}
        </h1>
        <p className="text-sm text-muted-foreground">
          Consulte o estoque atual e prepare a conferência física — sem informações de
          custo.
        </p>
      </div>

      <MaterialStockConferenceWorkspace
        viewKind={viewKind}
        layoutMode={layoutMode}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={onFilterChange}
        rows={rows}
        selectedId={selectedId}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
        error={error}
        onRetry={() => void runSearch(1, "replace")}
        isRefreshing={loading && rows.length > 0}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => {
          if (!hasMore || loadingMore || loading) return;
          void runSearch(page + 1, "append");
        }}
        totalCount={total}
        canViewHistory={canViewHistory}
        canConference={canConference}
        canEditParameters={canEditParameters}
        onConference={() => {
          if (!selectedItem) return;
          setConferenceOpen(true);
        }}
        onHistory={() => {
          if (!selectedItem) return;
          setHistoryOpen(true);
        }}
        onEditParameters={() => {
          if (!selectedItem || !canEditParameters) return;
          setParametersOpen(true);
        }}
      />

      {selectedItem ? (
        <>
          <MaterialStockConferenceDialog
            item={selectedItem}
            open={conferenceOpen}
            onClose={() => setConferenceOpen(false)}
            onSuccess={onConferenceSuccess}
            onReloadRequired={() => {
              void runSearch(1, "replace");
            }}
          />
          <MaterialStockParametersDialog
            item={selectedItem}
            open={parametersOpen && canEditParameters}
            onClose={() => setParametersOpen(false)}
            onSuccess={onParametersSuccess}
          />
          <MaterialStockHistoryPanel
            item={selectedItem}
            open={historyOpen && canViewHistory}
            onClose={() => setHistoryOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
