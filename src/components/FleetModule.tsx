import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Car,
  ClipboardList,
  Loader2,
  QrCode,
  RefreshCw,
  Settings,
  Users,
  X,
} from "lucide-react";
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
import type { FleetDashboardResponse } from "@/src/types/fleet";

const BOOL_SETTING_KEYS = [
  "bloquearReservaDocumentoVencido",
  "bloquearRetiradaCnhVencida",
  "checklistRetiradaObrigatorio",
  "checklistDevolucaoObrigatorio",
  "publicReservationEnabled",
];

function Card({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: "ok" | "warn" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-3 shadow-sm",
        highlight === "danger"
          ? "border-red-200"
          : highlight === "warn"
            ? "border-amber-200"
            : "border-slate-200"
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-semibold",
          highlight === "danger"
            ? "text-red-700"
            : highlight === "warn"
              ? "text-amber-700"
              : "text-slate-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ShortcutButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
    >
      <Icon className="h-4 w-4 text-slate-500" />
      {label}
    </button>
  );
}

export function FleetModule() {
  const fleet = useFleetPermissions();
  const [tab, setTab] = useState<FleetTabId>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);

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

  const loadDashboard = useCallback(async () => {
    const [data, alertsRes] = await Promise.all([
      fetchJsonOk<FleetDashboardResponse>("/api/fleet/dashboard"),
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
      if (tab === "overview") await loadDashboard();
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
    if (tab !== "overview") return;
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

      {tab === "overview" && dashboard && c && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Card label="Veículos ativos" value={c.totalOperational} />
            <Card label="Disponíveis agora" value={c.available} highlight="ok" />
            <Card label="Reservas hoje" value={c.reservationsToday} />
            <Card
              label="Reservas em atraso"
              value={c.reservationsOverdue}
              highlight={c.reservationsOverdue > 0 ? "warn" : undefined}
            />
            <Card
              label="Em manutenção"
              value={c.maintenance}
              highlight={c.maintenance > 0 ? "warn" : undefined}
            />
            <Card label="Em uso" value={c.inUse} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Atalhos</h3>
            <div className="flex flex-wrap gap-2">
              <ShortcutButton
                label="Nova reserva"
                icon={CalendarPlus}
                onClick={() => setTab("reservations")}
              />
              <ShortcutButton
                label="Solicitações QR"
                icon={QrCode}
                onClick={() => setTab("publicRequests")}
              />
              <ShortcutButton label="Veículos" icon={Car} onClick={() => setTab("vehicles")} />
              <ShortcutButton label="Motoristas" icon={Users} onClick={() => setTab("drivers")} />
              <ShortcutButton
                label="Checklists"
                icon={ClipboardList}
                onClick={() => setTab("checklists")}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <button
              type="button"
              onClick={() => setShowCompliance((v) => !v)}
              className="text-sm font-semibold text-slate-700 hover:text-slate-900"
            >
              {showCompliance ? "▾" : "▸"} Conformidade e alertas detalhados
            </button>
            {showCompliance && (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <Card
                    label="CNHs vencidas"
                    value={c.cnhsExpired}
                    highlight={c.cnhsExpired > 0 ? "danger" : undefined}
                  />
                  <Card
                    label="CNHs vencendo"
                    value={c.cnhsExpiring}
                    highlight={c.cnhsExpiring > 0 ? "warn" : undefined}
                  />
                  <Card
                    label="Docs vencidos"
                    value={c.documentsExpired}
                    highlight={c.documentsExpired > 0 ? "danger" : undefined}
                  />
                  <Card label="Manutenções abertas" value={c.openMaintenances} />
                </div>
              </div>
            )}
          </div>

          {dashboard.financial && canFinancial && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">Financeiro do mês</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-500">
                    Custo total ({dashboard.financial.competence})
                  </p>
                  <p className="text-xl font-semibold">
                    {dashboard.financial.totalMonth != null
                      ? dashboard.financial.totalMonth.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Custo por km</p>
                  <p className="text-xl font-semibold">
                    {dashboard.financial.costPerKm != null
                      ? dashboard.financial.costPerKm.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : dashboard.financial.kmMonth > 0
                        ? "—"
                        : "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Alertas</h3>
            {dashboard.alerts.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nenhum alerta no momento. Tudo em ordem.</p>
            ) : (
              <ul className="mt-2 max-h-80 overflow-y-auto space-y-2">
                {dashboard.alerts.slice(0, 30).map((a, i) => (
                  <li
                    key={`${a.code ?? "alert"}-${i}`}
                    className={cn(
                      "text-sm rounded-lg px-2 py-1.5",
                      a.level === "critical"
                        ? "bg-red-50 text-red-800"
                        : a.level === "warning"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-slate-50 text-slate-700"
                    )}
                  >
                    {a.message}
                  </li>
                ))}
              </ul>
            )}
            {dashboard.alerts.length > 30 && (
              <p className="mt-2 text-xs text-slate-500">
                Exibindo 30 de {dashboard.alerts.length} alertas.
              </p>
            )}
          </div>
        </div>
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
