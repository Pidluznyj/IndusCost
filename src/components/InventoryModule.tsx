import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { INVENTORY_UI_TABS } from "@/src/lib/moduleTabResources";
import { InventoryDashboardTab } from "@/src/components/inventory/InventoryDashboardTab";
import { InventoryItemsTab } from "@/src/components/inventory/InventoryItemsTab";
import { InventoryWarehousesTab } from "@/src/components/inventory/InventoryWarehousesTab";
import { InventoryMovementsTab } from "@/src/components/inventory/InventoryMovementsTab";
import { InventoryBalancesTab } from "@/src/components/inventory/InventoryBalancesTab";
import { InventoryCountsTab } from "@/src/components/inventory/InventoryCountsTab";
import { normalizeInventoryDashboard } from "@/src/components/inventory/inventoryDashboardPresentation";
import {
  getInventoryTabDef,
  getVisibleInventoryTabs,
  resolveInventoryTabFromPath,
  type InventoryTabId,
} from "@/src/components/inventory/inventoryNavigation";
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import {
  formatInventoryApiError,
  InventoryComingSoonTab,
  InventoryErrorBanner,
  InventoryLoading,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryDashboardPayload } from "@/src/types/inventory";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";

type Props = {
  initialTab?: InventoryTabId;
};

export function InventoryModule({ initialTab }: Props = {}) {
  const permissions = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  /** PERM-42 — view via DTO/sidebar oficial (não bag canAccessModule). */
  const canView = permissions.canViewModule("inventory");
  const [tab, setTab] = useState<InventoryTabId>(
    initialTab ?? resolveInventoryTabFromPath(location.pathname)
  );
  const [dashboard, setDashboard] = useState<InventoryDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navTabIds = new Set(getVisibleInventoryTabs().map((t) => t.id));
  const catalog = INVENTORY_UI_TABS.filter((t) => navTabIds.has(t.id));
  const { visibleTabs, activeId, isEmpty, requestedDenied } = useAuthorizedTabs({
    tabs: catalog,
    requestedId: tab,
    parentResourceKey: "operations.inventory",
    requireParentView: true,
  });

  const selectTab = useCallback(
    (next: InventoryTabId) => {
      setTab(next);
      if (next === "items") navigate("/inventory/items");
      else if (next === "warehouses") navigate("/inventory/warehouses");
      else if (next === "movements") navigate("/inventory/movements");
      else if (next === "balances") navigate("/inventory/balances");
      else if (next === "counts") navigate("/inventory/counts");
      else navigate("/inventory");
    },
    [navigate]
  );

  useEffect(() => {
    const fromPath = resolveInventoryTabFromPath(location.pathname);
    if (fromPath !== tab) setTab(fromPath);
  }, [location.pathname, tab]);

  useEffect(() => {
    // PERM-39: aba negada → modal; não corrigir URL silenciosamente
    if (requestedDenied) return;
    if (activeId && activeId !== tab) {
      selectTab(activeId as InventoryTabId);
    }
  }, [activeId, tab, selectTab, requestedDenied]);

  const loadDashboard = useCallback(async () => {
    const raw = await fetchJsonOk<unknown>("/api/inventory/dashboard");
    setDashboard(normalizeInventoryDashboard(raw));
  }, []);

  const refresh = useCallback(async () => {
    if (tab !== "overview") return;
    setLoading(true);
    setError(null);
    try {
      await loadDashboard();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar dashboard de estoque."));
    } finally {
      setLoading(false);
    }
  }, [tab, loadDashboard]);

  useEffect(() => {
    if (tab !== "overview") return;
    void refresh();
  }, [refresh, tab]);

  if (!canView) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  if (isEmpty || requestedDenied) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  const activeTabDef = getInventoryTabDef(tab);
  const visibleNavTabs = getVisibleInventoryTabs().filter((t) =>
    visibleTabs.some((v) => v.id === t.id)
  );

  return (
    <div className="space-y-4" data-testid="inventory-module">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2">
        {visibleNavTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
            data-testid={`inventory-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
        {tab === "overview" ? (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            data-testid="inventory-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
        ) : null}
      </div>

      {error && tab === "overview" ? (
        <InventoryErrorBanner message={error} onDismiss={() => setError(null)} />
      ) : null}

      {tab === "overview" ? (
        loading && !dashboard ? (
          <InventoryLoading label="Carregando visão geral…" />
        ) : (
          <InventoryDashboardTab data={dashboard ?? normalizeInventoryDashboard({})} loading={loading} />
        )
      ) : tab === "items" ? (
        <InventoryItemsTab />
      ) : tab === "warehouses" ? (
        <InventoryWarehousesTab />
      ) : tab === "movements" ? (
        <InventoryMovementsTab />
      ) : tab === "balances" ? (
        <InventoryBalancesTab />
      ) : tab === "counts" ? (
        <InventoryCountsTab />
      ) : tab === "reservations" ? (
        <InventoryComingSoonTab
          title={INVENTORY_EMPTY.noReservationsActive.title}
          description={INVENTORY_EMPTY.noReservationsActive.description}
        />
      ) : tab === "audit" ? (
        <InventoryComingSoonTab
          title={INVENTORY_EMPTY.noAuditEntries.title}
          description={INVENTORY_EMPTY.noAuditEntries.description}
        />
      ) : activeTabDef?.comingSoon ? (
        <InventoryComingSoonTab
          title={activeTabDef.label}
          description={activeTabDef.description}
        />
      ) : (
        <InventoryComingSoonTab
          title={activeTabDef?.label ?? "Em breve"}
          description="Esta área será disponibilizada em uma próxima fase."
        />
      )}
    </div>
  );
}
