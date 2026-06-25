import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { canAccessModule } from "@/src/lib/modulePermissions";
import { InventoryDashboardTab } from "@/src/components/inventory/InventoryDashboardTab";
import { normalizeInventoryDashboard } from "@/src/components/inventory/inventoryDashboardPresentation";
import {
  getInventoryTabDef,
  getVisibleInventoryTabs,
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

export function InventoryModule() {
  const auth = useAuth();
  const canView = canAccessModule("inventory", auth);
  const [tab, setTab] = useState<InventoryTabId>("overview");
  const [dashboard, setDashboard] = useState<InventoryDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!canView) {
    return <InventoryPermissionDenied />;
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
            onClick={() => setTab(t.id)}
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

      {error ? (
        <InventoryErrorBanner message={error} onDismiss={() => setError(null)} />
      ) : null}

      {tab === "overview" ? (
        loading && !dashboard ? (
          <InventoryLoading label="Carregando visão geral…" />
        ) : (
          <InventoryDashboardTab data={dashboard ?? normalizeInventoryDashboard({})} loading={loading} />
        )
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
