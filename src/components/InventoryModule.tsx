import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { canAccessModule } from "@/src/lib/modulePermissions";
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
import {
  formatInventoryApiError,
  InventoryComingSoonTab,
  InventoryErrorBanner,
  InventoryLoading,
  InventoryPermissionDenied,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryDashboardPayload } from "@/src/types/inventory";

type Props = {
  initialTab?: InventoryTabId;
};

export function InventoryModule({ initialTab }: Props = {}) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canView = canAccessModule("inventory", auth);
  const [tab, setTab] = useState<InventoryTabId>(
    initialTab ?? resolveInventoryTabFromPath(location.pathname)
  );
  const [dashboard, setDashboard] = useState<InventoryDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromPath = resolveInventoryTabFromPath(location.pathname);
    if (fromPath !== tab) setTab(fromPath);
  }, [location.pathname]);

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
    void refresh();
  }, [refresh]);

  const selectTab = (next: InventoryTabId) => {
    setTab(next);
    if (next === "items") navigate("/inventory/items");
    else if (next === "warehouses") navigate("/inventory/warehouses");
    else if (next === "movements") navigate("/inventory/movements");
    else if (next === "balances") navigate("/inventory/balances");
    else if (next === "counts") navigate("/inventory/counts");
    else if (
      location.pathname.includes("/inventory/items") ||
      location.pathname.includes("/inventory/warehouses") ||
      location.pathname.includes("/inventory/movements") ||
      location.pathname.includes("/inventory/balances") ||
      location.pathname.includes("/inventory/counts")
    ) {
      navigate("/inventory");
    }
  };

  if (!canView) {
    return (
      <InventoryPermissionDenied message="Você não tem permissão para acessar o módulo Estoque / Almoxarifado. Solicite a permissão inventory.view ao administrador." />
    );
  }

  const visibleTabs = getVisibleInventoryTabs();
  const activeTabDef = getInventoryTabDef(tab);

  return (
    <div className="space-y-4" data-testid="inventory-module">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2">
        {visibleTabs.map((t) => (
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
