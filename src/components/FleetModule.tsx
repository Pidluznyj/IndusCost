import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Settings, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { FleetVehiclesTab } from "@/src/components/fleet/FleetVehiclesTab";
import { FleetDriversTab } from "@/src/components/fleet/FleetDriversTab";
import { FleetReservationsTab } from "@/src/components/fleet/FleetReservationsTab";
import { FleetMaintenancesTab } from "@/src/components/fleet/FleetMaintenancesTab";
import { FleetFinancialTab } from "@/src/components/fleet/FleetFinancialTab";
import type { FleetDashboardResponse } from "@/src/types/fleet";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "vehicles", label: "Veículos" },
  { id: "reservations", label: "Agenda / Reservas" },
  { id: "drivers", label: "Motoristas" },
  { id: "maintenances", label: "Manutenções" },
  { id: "contracts", label: "Contratos" },
  { id: "documents", label: "Documentos" },
  { id: "costs", label: "Custos" },
  { id: "incidents", label: "Ocorrências" },
  { id: "settings", label: "Configurações" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function FleetModule() {
  const auth = useAuth();
  const [tab, setTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSettings = auth.hasPermission("fleet.settings.manage");
  const canFinancial =
    auth.hasPermission("fleet.financial.view") || auth.hasPermission("fleet.manage");

  const [dashboard, setDashboard] = useState<FleetDashboardResponse | null>(null);
  const [settings, setSettings] = useState<{ key: string; value: string; description: string | null }[]>([]);

  const loadDashboard = useCallback(async () => {
    const data = await fetchJsonOk<FleetDashboardResponse>("/api/fleet/dashboard");
    setDashboard(data);
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await fetchJsonOk<{ settings: typeof settings }>("/api/fleet/settings");
    setSettings(data.settings);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "dashboard") await loadDashboard();
      else if (tab === "settings") await loadSettings();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [tab, loadDashboard, loadSettings]);

  useEffect(() => {
    void refresh();
  }, [tab, refresh]);

  const saveSettings = async () => {
    if (!canSettings) return;
    setLoading(true);
    try {
      await fetchJsonOk("/api/fleet/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar configurações.");
    } finally {
      setLoading(false);
    }
  };

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

      {tab === "dashboard" && dashboard && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[
              ["Total veículos", dashboard.cards.totalVehicles],
              ["Disponíveis", dashboard.cards.available],
              ["Em uso", dashboard.cards.inUse],
              ["Manutenção", dashboard.cards.maintenance],
              ["Bloqueados", dashboard.cards.blocked],
              ["Docs vencendo", dashboard.cards.documentsExpiring],
              ["CNHs vencendo", dashboard.cards.cnhsExpiring],
              ["Reservas hoje", dashboard.cards.reservationsToday],
              ["Manutenções abertas", dashboard.cards.openMaintenances],
              ["Preventivas vencidas", dashboard.cards.preventiveOverdue ?? 0],
              ["Preventivas próximas", dashboard.cards.preventiveUpcoming ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          {dashboard.financial && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">Financeiro do mês</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <p className="text-xs text-slate-500">Multas pendentes</p>
                  <p className="text-xl font-semibold">{dashboard.financial.pendingFines}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Sinistros / avarias abertas</p>
                  <p className="text-xl font-semibold">{dashboard.financial.openIncidents}</p>
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
              {canFinancial && Object.keys(dashboard.financial.byType).length > 0 && (
                <ul className="text-sm text-slate-600 flex flex-wrap gap-3">
                  {Object.entries(dashboard.financial.byType).map(([t, v]) => (
                    <li key={t}>
                      {t}:{" "}
                      {typeof v === "number"
                        ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                        : "—"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Alertas críticos</h3>
            {dashboard.alerts.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nenhum alerta no momento.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {dashboard.alerts.map((a, i) => (
                  <li
                    key={i}
                    className={cn(
                      "text-sm",
                      a.level === "critical" ? "text-red-700" : "text-amber-700"
                    )}
                  >
                    {a.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "vehicles" && <FleetVehiclesTab />}

      {tab === "drivers" && <FleetDriversTab />}

      {tab === "reservations" && <FleetReservationsTab />}

      {tab === "maintenances" && <FleetMaintenancesTab />}

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
      {tab === "incidents" && <FleetFinancialTab initialSubTab="fines" />}

      {tab === "settings" && (
        <div className="space-y-3 max-w-xl">
          {settings.map((s, idx) => (
            <label key={s.key} className="block text-sm">
              <span className="font-medium text-slate-700">{s.description ?? s.key}</span>
              {["checklistRetiradaObrigatorio", "checklistDevolucaoObrigatorio"].includes(s.key) ? (
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
                  <option value="false">Não obrigatório</option>
                  <option value="true">Obrigatório</option>
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
          ))}
          {canSettings && (
            <button
              type="button"
              onClick={() => void saveSettings()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <Settings className="h-4 w-4" />
              Salvar parâmetros
            </button>
          )}
        </div>
      )}

    </div>
  );
}
