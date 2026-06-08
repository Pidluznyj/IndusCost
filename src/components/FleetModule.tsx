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
import { FleetPermissionDenied, useFleetPermissions, formatFleetApiError } from "@/src/components/fleet/fleetUi";
import type { FleetDashboardResponse } from "@/src/types/fleet";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "vehicles", label: "Veículos" },
  { id: "reservations", label: "Agenda / Reservas" },
  { id: "publicRequests", label: "Solicitações QR" },
  { id: "mobile", label: "Uso em campo" },
  { id: "drivers", label: "Motoristas" },
  { id: "maintenances", label: "Manutenções" },
  { id: "reports", label: "Relatórios" },
  { id: "contracts", label: "Contratos" },
  { id: "documents", label: "Documentos" },
  { id: "costs", label: "Custos" },
  { id: "incidents", label: "Ocorrências" },
  { id: "settings", label: "Configurações" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const BOOL_SETTING_KEYS = [
  "bloquearReservaDocumentoVencido",
  "bloquearRetiradaCnhVencida",
  "checklistRetiradaObrigatorio",
  "checklistDevolucaoObrigatorio",
  "publicReservationEnabled",
];

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function FleetModule() {
  const fleet = useFleetPermissions();
  const [tab, setTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { canView, canSettings, canManage, canFinancial } = fleet;

  if (!canView) {
    return <FleetPermissionDenied />;
  }

  const [dashboard, setDashboard] = useState<FleetDashboardResponse | null>(null);
  const [settings, setSettings] = useState<{ key: string; value: string; description: string | null }[]>([]);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadDashboard = useCallback(async () => {
    const [data, alertsRes] = await Promise.all([
      fetchJsonOk<FleetDashboardResponse>("/api/fleet/dashboard"),
      fetchJsonOk<{ alerts: FleetDashboardResponse["alerts"]; count: number }>(
        "/api/fleet/alerts"
      ),
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
      if (tab === "dashboard") await loadDashboard();
      else if (tab === "settings") await loadSettings();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar dados."));
    } finally {
      setLoading(false);
    }
  }, [tab, loadDashboard, loadSettings]);

  useEffect(() => {
    void refresh();
  }, [tab, refresh]);

  useEffect(() => {
    if (tab !== "dashboard") return;
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [tab, loadDashboard]);

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

  const c = dashboard?.cards;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
        {TABS.map((t) => (
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
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button type="button" className="ml-auto" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading && !dashboard && tab === "dashboard" && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      )}

      {tab === "dashboard" && dashboard && c && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Operação</h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              <Card label="Total veículos" value={c.totalVehicles} />
              <Card label="Operacionais" value={c.totalOperational} />
              <Card label="Disponíveis" value={c.available} />
              <Card label="Reservados" value={c.reserved} />
              <Card label="Em uso" value={c.inUse} />
              <Card label="Manutenção" value={c.maintenance} />
              <Card label="Bloqueados" value={c.blocked} />
              <Card label="Sinistrados" value={c.claimed} />
              <Card label="Inativos / devolvidos / vendidos" value={c.inactiveReturnedSold} />
              <Card label="Reservas hoje" value={c.reservationsToday} />
              <Card label="Reservas atrasadas" value={c.reservationsOverdue} />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Conformidade</h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              <Card label="Docs vencidos" value={c.documentsExpired} />
              <Card label="Docs vencendo" value={c.documentsExpiring} />
              <Card label="CNHs vencidas" value={c.cnhsExpired} />
              <Card label="CNHs vencendo" value={c.cnhsExpiring} />
              <Card label="Contratos vencidos" value={c.contractsExpired} />
              <Card label="Contratos vencendo" value={c.contractsExpiring} />
              <Card label="Manutenções abertas" value={c.openMaintenances} />
              <Card label="Preventivas vencidas" value={c.maintenanceOverdue} />
              <Card label="Preventivas próximas" value={c.maintenanceUpcoming} />
              <Card label="Multas pendentes" value={c.pendingFines} />
              <Card label="Sinistros abertos" value={c.openIncidents} />
            </div>
          </div>

          {dashboard.financial && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">Financeiro do mês</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Custo total ({dashboard.financial.competence})</p>
                  <p className="text-xl font-semibold">
                    {canFinancial && dashboard.financial.totalMonth != null
                      ? dashboard.financial.totalMonth.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "••••••"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Custo por km</p>
                  <p className="text-xl font-semibold">
                    {canFinancial && dashboard.financial.costPerKm != null
                      ? dashboard.financial.costPerKm.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : dashboard.financial.kmMonth > 0
                        ? "••••••"
                        : "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Alertas</h3>
            {dashboard.alerts.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nenhum alerta no momento.</p>
            ) : (
              <ul className="mt-2 max-h-80 overflow-y-auto space-y-1">
                {dashboard.alerts.slice(0, 50).map((a, i) => (
                  <li
                    key={`${a.code ?? "alert"}-${i}`}
                    className={cn(
                      "text-sm flex gap-2",
                      a.level === "critical" ? "text-red-700" : a.level === "warning" ? "text-amber-700" : "text-slate-600"
                    )}
                  >
                    <span className="shrink-0 text-[10px] uppercase font-mono opacity-60">
                      {a.code ?? a.level}
                    </span>
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {dashboard.alerts.length > 50 && (
              <p className="mt-2 text-xs text-slate-500">
                +{dashboard.alerts.length - 50} alertas — use a API /api/fleet/alerts para lista completa.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "vehicles" && <FleetVehiclesTab />}
      {tab === "drivers" && <FleetDriversTab />}
      {tab === "reservations" && <FleetReservationsTab />}
      {tab === "publicRequests" && <FleetPublicReservationRequestsTab />}
      {tab === "mobile" && <FleetMobileUsageFlow />}
      {tab === "maintenances" && <FleetMaintenancesTab />}
      {tab === "reports" && <FleetReportsTab />}

      {tab === "contracts" && (
        <p className="text-sm text-slate-600">
          Contratos são gerenciados na ficha de cada veículo (aba Veículos → abrir veículo → Contratos).
        </p>
      )}
      {tab === "documents" && (
        <p className="text-sm text-slate-600">
          Documentos são gerenciados na ficha de cada veículo (aba Veículos → abrir veículo → Documentos).
        </p>
      )}
      {tab === "costs" && <FleetFinancialTab initialSubTab="costs" />}
      {tab === "incidents" && <FleetFinancialTab initialSubTab="incidents" />}

      {tab === "settings" && (
        <div className="space-y-6 max-w-3xl">
          <FleetReservationsCleanupPanel />
          {canManage && <FleetImportSettings />}
          <FleetPublicReservationQrPanel canManage={canSettings} />
          <div className="space-y-3 max-w-xl">
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
            <p className="text-sm text-amber-700">Somente leitura — permissão fleet.settings.manage necessária.</p>
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
            <p className="text-sm text-green-700">Parâmetros salvos e auditados.</p>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

