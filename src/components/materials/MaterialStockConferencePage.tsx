/**
 * Página operacional — Conferência de estoque.
 * Separada do cadastro/custos (MaterialModule).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import {
  getMaterialStockConferenceDetailPath,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import {
  MATERIAL_STOCK_CONFERENCE_PAGE_TITLE,
  resolveMaterialStockConferenceLayout,
  type MaterialStockConferenceLayoutMode,
} from "@/src/lib/materialStockConferenceUi";
import {
  MATERIAL_STOCK_TABLET_SEARCH_PATH,
  type MaterialStockTabletListItem,
  type MaterialStockTabletSearchResponse,
} from "@/src/lib/materialStockTabletTypes";
import { TabResourceKeys } from "@/src/lib/moduleTabResources";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  MaterialStockConferenceWorkspace,
  type MaterialStockConferenceViewKind,
} from "@/src/components/materials/MaterialStockConferenceWorkspace";

function useStockConferenceLayoutMode(): MaterialStockConferenceLayoutMode {
  const [mode, setMode] = useState<MaterialStockConferenceLayoutMode>("split");

  useEffect(() => {
    const compute = () => {
      const width = window.innerWidth;
      const orientation =
        window.matchMedia("(orientation: portrait)").matches
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
  const [rows, setRows] = useState<MaterialStockTabletListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    routeMaterialId ?? null
  );

  const canViewHistory = permissions.canViewTabResource(
    TabResourceKeys.SUPRIMENTOS_CATALOGO
  );
  /** CTA visível com view; a API de gravação exige update. */
  const canConference = canViewHistory;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setSelectedId(routeMaterialId ?? null);
  }, [routeMaterialId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("pageSize", "50");
      if (debouncedSearch) params.set("q", debouncedSearch);
      const data = await fetchJsonOk<MaterialStockTabletSearchResponse>(
        `${MATERIAL_STOCK_TABLET_SEARCH_PATH}?${params.toString()}`
      );
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar matérias-primas para conferência."
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewKind: MaterialStockConferenceViewKind = useMemo(() => {
    if (loading) return "loading";
    if (error) return "error";
    if (rows.length === 0) return "empty";
    return "ready";
  }, [loading, error, rows.length]);

  const onSelect = (id: string) => {
    setSelectedId(id);
    navigate(getMaterialStockConferenceDetailPath(id), { replace: false });
  };

  const onClearSelection = () => {
    setSelectedId(null);
    navigate(MATERIALS_SECTION_PATHS.stockConference, { replace: false });
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
        rows={rows}
        selectedId={selectedId}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
        error={error}
        onRetry={() => void load()}
        canViewHistory={canViewHistory}
        canConference={canConference}
        onConference={() => {
          /* fluxo de gravação em entrega seguinte */
        }}
        onHistory={() => {
          /* histórico em entrega seguinte */
        }}
      />
    </div>
  );
}
