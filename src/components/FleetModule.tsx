import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  User,
  Wrench,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { FleetVehiclesTab } from "@/src/components/fleet/FleetVehiclesTab";
import type {
  FleetDashboardResponse,
  FleetDriverStatus,
  FleetReservationStatus,
} from "@/src/types/fleet";

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

const RES_STATUS_LABEL: Record<FleetReservationStatus, string> = {
  REQUESTED: "Solicitada",
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  CANCELED: "Cancelada",
  IN_USE: "Em uso",
  FINISHED: "Finalizada",
  FINISHED_WITH_PENDING: "Finalizada c/ pendência",
  NO_SHOW: "Não compareceu",
};

const DRIVER_STATUS_LABEL: Record<FleetDriverStatus, string> = {
  AUTHORIZED: "Autorizado",
  PENDING: "Pendente",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
};

function formatDt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function FleetModule() {
  const auth = useAuth();
  const [tab, setTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = auth.hasPermission("fleet.manage");
  const canReservations =
    auth.hasPermission("fleet.reservations.create") || auth.hasPermission("fleet.manage");
  const canApprove =
    auth.hasPermission("fleet.reservations.approve") || auth.hasPermission("fleet.manage");
  const canMaint =
    auth.hasPermission("fleet.maintenance.manage") || auth.hasPermission("fleet.manage");
  const canSettings = auth.hasPermission("fleet.settings.manage");

  const [dashboard, setDashboard] = useState<FleetDashboardResponse | null>(null);
  const [vehicles, setVehicles] = useState<{ id: string; plate: string | null; brand: string; model: string }[]>([]);
  const [drivers, setDrivers] = useState<
    {
      id: string;
      name: string;
      cpf: string;
      status: FleetDriverStatus;
      cnhExpirationDate: string | null;
    }[]
  >([]);
  const [reservations, setReservations] = useState<
    {
      id: string;
      status: FleetReservationStatus;
      startDateTime: string;
      endDateTime: string;
      vehicle?: { plate: string | null; brand: string; model: string };
      driver?: { name: string } | null;
    }[]
  >([]);
  const [maintenances, setMaintenances] = useState<
    { id: string; description: string; status: string; vehicle?: { plate: string | null; brand: string; model: string } }[]
  >([]);
  const [settings, setSettings] = useState<{ key: string; value: string; description: string | null }[]>([]);

  const [driverModal, setDriverModal] = useState(false);
  const [driverForm, setDriverForm] = useState({
    name: "",
    cpf: "",
    cnhNumber: "",
    cnhExpirationDate: "",
    status: "PENDING" as FleetDriverStatus,
  });

  const [resModal, setResModal] = useState(false);
  const [resForm, setResForm] = useState({
    vehicleId: "",
    driverId: "",
    startDateTime: "",
    endDateTime: "",
    destination: "",
    reason: "",
  });

  const [maintModal, setMaintModal] = useState(false);
  const [maintForm, setMaintForm] = useState({
    vehicleId: "",
    description: "",
    maintenanceType: "CORRETIVA",
    blocksVehicle: true,
  });

  const loadDashboard = useCallback(async () => {
    const data = await fetchJsonOk<FleetDashboardResponse>("/api/fleet/dashboard");
    setDashboard(data);
  }, []);

  const loadVehicles = useCallback(async () => {
    const data = await fetchJsonOk<{ vehicles: { id: string; plate: string | null; brand: string; model: string }[] }>(
      "/api/fleet/vehicles"
    );
    setVehicles(data.vehicles);
  }, []);

  const loadDrivers = useCallback(async () => {
    const data = await fetchJsonOk<{ drivers: typeof drivers }>("/api/fleet/drivers");
    setDrivers(data.drivers);
  }, []);

  const loadReservations = useCallback(async () => {
    const data = await fetchJsonOk<{ reservations: typeof reservations }>("/api/fleet/reservations");
    setReservations(data.reservations);
  }, []);

  const loadMaintenances = useCallback(async () => {
    const data = await fetchJsonOk<{ maintenances: typeof maintenances }>("/api/fleet/maintenances");
    setMaintenances(data.maintenances);
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
      else if (tab === "drivers") await loadDrivers();
      else if (tab === "reservations") {
        await loadReservations();
        if (!vehicles.length) await loadVehicles();
        if (!drivers.length) await loadDrivers();
      } else if (tab === "maintenances") {
        await loadMaintenances();
        if (!vehicles.length) await loadVehicles();
      } else if (tab === "settings") await loadSettings();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [tab, loadDashboard, loadDrivers, loadReservations, loadMaintenances, loadSettings, vehicles.length, drivers.length]);

  useEffect(() => {
    void refresh();
  }, [tab, refresh]);

  const saveDriver = async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      await fetchJsonOk("/api/fleet/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(driverForm),
      });
      setDriverModal(false);
      await loadDrivers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar motorista.");
    } finally {
      setLoading(false);
    }
  };

  const saveReservation = async () => {
    if (!canReservations) return;
    setLoading(true);
    try {
      await fetchJsonOk("/api/fleet/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...resForm,
          driverId: resForm.driverId || null,
        }),
      });
      setResModal(false);
      await loadReservations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao criar reserva.");
    } finally {
      setLoading(false);
    }
  };

  const reservationAction = async (
    id: string,
    action: "approve" | "reject" | "cancel" | "checkout" | "checkin",
    body?: Record<string, unknown>
  ) => {
    setLoading(true);
    try {
      const path =
        action === "checkout" || action === "checkin"
          ? `/api/fleet/reservations/${id}/${action}`
          : `/api/fleet/reservations/${id}/${action}`;
      await fetchJsonOk(path, {
        method: action === "checkout" || action === "checkin" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await loadReservations();
      await loadVehicles();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro na operação.");
    } finally {
      setLoading(false);
    }
  };

  const saveMaintenance = async () => {
    if (!canMaint) return;
    setLoading(true);
    try {
      await fetchJsonOk("/api/fleet/maintenances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(maintForm),
      });
      setMaintModal(false);
      await loadMaintenances();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao abrir manutenção.");
    } finally {
      setLoading(false);
    }
  };

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

  const vehicleOptions = useMemo(
    () => vehicles.map((v) => ({ id: v.id, label: `${v.plate ?? "—"} · ${v.brand} ${v.model}` })),
    [vehicles]
  );

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
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
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

      {tab === "drivers" && (
        <div className="space-y-3">
          {canManage && (
            <button
              type="button"
              onClick={() => setDriverModal(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <Plus className="h-4 w-4" />
              Novo motorista
            </button>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Nome</th>
                  <th className="px-3 py-2 text-left">CPF</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">CNH venc.</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => {
                  const exp = d.cnhExpirationDate ? new Date(d.cnhExpirationDate) : null;
                  const expired = exp && exp < new Date();
                  return (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{d.name}</td>
                      <td className="px-3 py-2">{d.cpf}</td>
                      <td className="px-3 py-2">{DRIVER_STATUS_LABEL[d.status]}</td>
                      <td className={cn("px-3 py-2", expired && "text-red-600 font-medium")}>
                        {d.cnhExpirationDate
                          ? new Date(d.cnhExpirationDate).toLocaleDateString("pt-BR")
                          : "—"}
                        {expired && " ⚠"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "reservations" && (
        <div className="space-y-3">
          {canReservations && (
            <button
              type="button"
              onClick={() => setResModal(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <Calendar className="h-4 w-4" />
              Nova reserva
            </button>
          )}
          <div className="space-y-2">
            {reservations.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">
                      {r.vehicle?.plate ?? "—"} — {r.vehicle?.brand} {r.vehicle?.model}
                    </span>
                    <span className="ml-2 text-slate-500">{RES_STATUS_LABEL[r.status]}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {canApprove && r.status === "PENDING_APPROVAL" && (
                      <>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() => void reservationAction(r.id, "approve")}
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() => void reservationAction(r.id, "reject")}
                        >
                          Rejeitar
                        </button>
                      </>
                    )}
                    {canReservations && r.status === "APPROVED" && (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => {
                          const km = prompt("Km na retirada:");
                          if (km) void reservationAction(r.id, "checkout", { checkoutKm: Number(km) });
                        }}
                      >
                        Retirada
                      </button>
                    )}
                    {canReservations && r.status === "IN_USE" && (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => {
                          const km = prompt("Km na devolução:");
                          if (km)
                            void reservationAction(r.id, "checkin", {
                              checkinKm: Number(km),
                              hasPending: false,
                            });
                        }}
                      >
                        Devolução
                      </button>
                    )}
                    {canReservations &&
                      ["REQUESTED", "PENDING_APPROVAL", "APPROVED"].includes(r.status) && (
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs text-red-700"
                          onClick={() => void reservationAction(r.id, "cancel")}
                        >
                          Cancelar
                        </button>
                      )}
                  </div>
                </div>
                <p className="mt-1 text-slate-600">
                  {formatDt(r.startDateTime)} → {formatDt(r.endDateTime)}
                  {r.driver?.name ? ` · ${r.driver.name}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "maintenances" && (
        <div className="space-y-3">
          {canMaint && (
            <button
              type="button"
              onClick={() => setMaintModal(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <Wrench className="h-4 w-4" />
              Abrir manutenção
            </button>
          )}
          <ul className="space-y-2">
            {maintenances.map((m) => (
              <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <span className="font-medium">
                  {m.vehicle?.plate} — {m.description}
                </span>
                <span className="ml-2 text-slate-500">{m.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
      {["costs", "incidents"].includes(tab) && (
        <p className="text-sm text-slate-600">
          Em breve na próxima fase. Custos e ocorrências serão detalhados em telas dedicadas.
          {tab === "costs" && !auth.hasPermission("fleet.financial.view") && (
            <span className="block mt-1 text-amber-700">
              Permissão fleet.financial.view necessária para relatórios financeiros.
            </span>
          )}
        </p>
      )}

      {tab === "settings" && (
        <div className="space-y-3 max-w-xl">
          {settings.map((s, idx) => (
            <label key={s.key} className="block text-sm">
              <span className="font-medium text-slate-700">{s.description ?? s.key}</span>
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

      {driverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold flex items-center gap-2">
              <User className="h-5 w-5" />
              Novo motorista
            </h3>
            <div className="mt-3 grid gap-2 text-sm">
              <input
                placeholder="Nome *"
                className="rounded border px-2 py-1.5 w-full"
                value={driverForm.name}
                onChange={(e) => setDriverForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                placeholder="CPF *"
                className="rounded border px-2 py-1.5 w-full"
                value={driverForm.cpf}
                onChange={(e) => setDriverForm((f) => ({ ...f, cpf: e.target.value }))}
              />
              <input
                type="date"
                className="rounded border px-2 py-1.5 w-full"
                value={driverForm.cnhExpirationDate}
                onChange={(e) => setDriverForm((f) => ({ ...f, cnhExpirationDate: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDriverModal(false)} className="rounded border px-3 py-1.5 text-sm">
                Cancelar
              </button>
              <button type="button" onClick={() => void saveDriver()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {resModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold">Nova reserva</h3>
            <div className="mt-3 grid gap-2 text-sm">
              <select
                className="rounded border px-2 py-1.5 w-full"
                value={resForm.vehicleId}
                onChange={(e) => setResForm((f) => ({ ...f, vehicleId: e.target.value }))}
              >
                <option value="">Veículo *</option>
                {vehicleOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="rounded border px-2 py-1.5 w-full"
                value={resForm.driverId}
                onChange={(e) => setResForm((f) => ({ ...f, driverId: e.target.value }))}
              >
                <option value="">Motorista</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                className="rounded border px-2 py-1.5 w-full"
                value={resForm.startDateTime}
                onChange={(e) => setResForm((f) => ({ ...f, startDateTime: e.target.value }))}
              />
              <input
                type="datetime-local"
                className="rounded border px-2 py-1.5 w-full"
                value={resForm.endDateTime}
                onChange={(e) => setResForm((f) => ({ ...f, endDateTime: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setResModal(false)} className="rounded border px-3 py-1.5 text-sm">
                Cancelar
              </button>
              <button type="button" onClick={() => void saveReservation()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {maintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold">Abrir manutenção</h3>
            <div className="mt-3 grid gap-2 text-sm">
              <select
                className="rounded border px-2 py-1.5 w-full"
                value={maintForm.vehicleId}
                onChange={(e) => setMaintForm((f) => ({ ...f, vehicleId: e.target.value }))}
              >
                <option value="">Veículo *</option>
                {vehicleOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <textarea
                className="rounded border px-2 py-1.5 w-full"
                placeholder="Descrição *"
                value={maintForm.description}
                onChange={(e) => setMaintForm((f) => ({ ...f, description: e.target.value }))}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={maintForm.blocksVehicle}
                  onChange={(e) => setMaintForm((f) => ({ ...f, blocksVehicle: e.target.checked }))}
                />
                Bloqueia veículo
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setMaintModal(false)} className="rounded border px-3 py-1.5 text-sm">
                Cancelar
              </button>
              <button type="button" onClick={() => void saveMaintenance()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
