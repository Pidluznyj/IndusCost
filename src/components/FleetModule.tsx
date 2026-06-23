import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Settings, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { FleetVehiclesTab } from "@/src/components/fleet/FleetVehiclesTab";
import { FleetDriversTab } from "@/src/components/fleet/FleetDriversTab";
import { FleetReservationsTab } from "@/src/components/fleet/FleetReservationsTab";
import { FleetMaintenancesTab } from "@/src/components/fleet/FleetMaintenancesTab";
import { FleetFinancialTab } from "@/src/components/fleet/FleetFinancialTab";
import { FleetReportsTab } from "@/src/components/fleet/FleetReportsTab";
import { FleetMobileUsageFlow } from "@/src/components/fleet/FleetMobileUsageFlow";
import { FleetImportSettings } from "@/src/components/fleet/FleetImportSettings";
import { FleetPublicReservationQrPanel } from "@/src/components/fleet/FleetPublicReservationQrPanel";
import { FleetPublicReservationRequestsTab } from "@/src/components/fleet/FleetPublicReservationRequestsTab";
import { FleetReservationsCleanupPanel } from "@/src/components/fleet/FleetReservationsCleanupPanel";
import { FleetChecklistsTab } from "@/src/components/fleet/FleetChecklistsTab";
import {
  FleetPermissionDenied,
  useFleetPermissions,
  formatFleetApiError,
} from "@/src/components/fleet/fleetUi";
import {
  getAdvancedFleetTabs,
  getFleetTabDef,
  getVisibleFleetTabs,
  type FleetTabId,
} from "@/src/components/fleet/fleetNavigation";
import { FleetOverviewTab } from "@/src/components/fleet/FleetOverviewTab";
import type { FleetDashboardResponse } from "@/src/types/fleet";

const BOOL_SETTING_KEYS = [
  "bloquearReservaDocumentoVencido",
  "bloquearRetiradaCnhVencida",
  "checklistRetiradaObrigatorio",
  "checklistDevolucaoObrigatorio",
  "publicReservationEnabled",
];

type OverviewFilters = {
  year: number;
  month: number;
  status: string;
  plate: string;
  unit: string;
  vehicleType: string;
};

function buildOverviewQuery(filters: OverviewFilters): string {
  const qs = new URLSearchParams();
  qs.set("year", String(filters.year));
  qs.set("month", String(filters.month));
  if (filters.status) qs.set("status", filters.status);
  if (filters.plate) qs.set("plate", filters.plate);
  if (filters.unit) qs.set("unit", filters.unit);
  if (filters.vehicleType) qs.set("vehicleType", filters.vehicleType);
  return qs.toString();
}

export function FleetModule() {
  const fleet = useFleetPermissions();
  const [tab, setTab] = useState<FleetTabId>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overviewFilters, setOverviewFilters] = useState<OverviewFilters>(() => {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      status: "",
      plate: "",
      unit: "",
      vehicleType: "",
    };
  });

  const { canView, canSettings, canManage, canFinancial } = fleet;

  if (!canView) {
    return <FleetPermissionDenied />;
  }

  const visibleTabs = getVisibleFleetTabs(fleet);
  const advancedTabs = getAdvancedFleetTabs(fleet);

  const [dashboard, setDashboard] = useState<FleetDashboardResponse | null>(null);
  const [settings, setSettings] = useState<
    { key: string; value: string; description: string | null }[]
  >([]);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadDashboard = useCallback(async (filters: OverviewFilters) => {
    const query = buildOverviewQuery(filters);
    const [data, alertsRes] = await Promise.all([
      fetchJsonOk<FleetDashboardResponse>(`/api/fleet/dashboard?${query}`),
      fetchJsonOk<{ alerts: FleetDashboardResponse["alerts"]; count: number }>("/api/fleet/alerts"),
    ]);
    setDashboard({ ...data, alerts: alertsRes.alerts });
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await fetchJsonOk<{ settings: typeof settings }>("/api/fleet/settings");
    setSettings(data.settings);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSettingsSaved(false);
    try {
      if (tab === "overview") await loadDashboard(overviewFilters);
      else if (tab === "settings") await loadSettings();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar dados."));
    } finally {
      setLoading(false);
    }
  }, [tab, loadDashboard, loadSettings, overviewFilters]);

  useEffect(() => {
    void refresh();
  }, [tab, refresh]);

  useEffect(() => {
    if (tab !== "overview") return;
    const timer = window.setInterval(() => {
      void loadDashboard(overviewFilters);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [tab, loadDashboard, overviewFilters]);

  const saveSettings = async () => {
    if (!canSettings) return;
    setLoading(true);
    setError(null);
    try {
      await fetchJsonOk("/api/fleet/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      setSettingsSaved(true);
      await loadSettings();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao salvar configurações."));
    } finally {
      setLoading(false);
    }
  };

  const activeTabDef = getFleetTabDef(tab);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {t.label}
          </button>
        ))}
        {advancedTabs.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                advancedTabs.some((t) => t.id === tab)
                  ? "bg-slate-700 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              )}
            >
              Avançado ▾
            </button>
            {showAdvanced && (
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {advancedTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTab(t.id);
                      setShowAdvanced(false);
                    }}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-sm hover:bg-slate-50",
                      tab === t.id ? "font-medium text-slate-900" : "text-slate-600"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {activeTabDef?.description && tab !== "overview" && (
        <p className="text-sm text-slate-500">{activeTabDef.description}</p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button type="button" className="ml-auto" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading && !dashboard && tab === "overview" && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      )}

      {tab === "overview" && dashboard && (
        <FleetOverviewTab
          dashboard={dashboard}
          canFinancial={canFinancial}
          filters={overviewFilters}
          onFiltersChange={(patch) => setOverviewFilters((prev) => ({ ...prev, ...patch }))}
          onNavigateTab={setTab}
        />
      )}

      {tab === "vehicles" && <FleetVehiclesTab />}
      {tab === "drivers" && <FleetDriversTab />}
      {tab === "reservations" && <FleetReservationsTab />}
      {tab === "publicRequests" && <FleetPublicReservationRequestsTab />}
      {tab === "checklists" && <FleetChecklistsTab />}
      {tab === "mobile" && <FleetMobileUsageFlow />}
      {tab === "maintenances" && <FleetMaintenancesTab />}
      {tab === "reports" && <FleetReportsTab />}

      {tab === "contracts" && (
        <p className="text-sm text-slate-600">
          Contratos são gerenciados na ficha de cada veículo (menu Veículos → abrir veículo →
          Contratos).
        </p>
      )}
      {tab === "documents" && (
        <p className="text-sm text-slate-600">
          Documentos são gerenciados na ficha de cada veículo (menu Veículos → abrir veículo →
          Documentos).
        </p>
      )}
      {tab === "costs" && <FleetFinancialTab initialSubTab="costs" />}
      {tab === "incidents" && <FleetFinancialTab initialSubTab="incidents" />}

      {tab === "settings" && (
        <div className="space-y-6 max-w-3xl">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Configurações da frota</p>
            <p className="mt-1">
              Link público para solicitação de reserva, parâmetros operacionais e ferramentas
              administrativas. O QR de checklist fica em cada veículo (menu Veículos).
            </p>
          </div>
          <FleetReservationsCleanupPanel />
          {canManage && <FleetImportSettings />}
          <FleetPublicReservationQrPanel canManage={canSettings} />
          <div className="space-y-3 max-w-xl">
            <h3 className="font-semibold text-slate-900">Parâmetros operacionais</h3>
            {loading && settings.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (
              settings.map((s, idx) => (
                <label key={s.key} className="block text-sm">
                  <span className="font-medium text-slate-700">{s.description ?? s.key}</span>
                  {BOOL_SETTING_KEYS.includes(s.key) ? (
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={s.value === "true" ? "true" : "false"}
                      disabled={!canSettings}
                      onChange={(e) => {
                        const next = [...settings];
                        next[idx] = { ...s, value: e.target.value };
                        setSettings(next);
                      }}
                    >
                      <option value="false">Não</option>
                      <option value="true">Sim</option>
                    </select>
                  ) : (
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={s.value}
                      disabled={!canSettings}
                      onChange={(e) => {
                        const next = [...settings];
                        next[idx] = { ...s, value: e.target.value };
                        setSettings(next);
                      }}
                    />
                  )}
                </label>
              ))
            )}
            {!canSettings && (
              <p className="text-sm text-amber-700">
                Somente leitura — peça ao administrador a permissão de configuração da frota.
              </p>
            )}
            {canSettings && (
              <button
                type="button"
                onClick={() => void saveSettings()}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                <Settings className="h-4 w-4" />
                Salvar parâmetros
              </button>
            )}
            {settingsSaved && (
              <p className="text-sm text-green-700">Parâmetros salvos com sucesso.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
