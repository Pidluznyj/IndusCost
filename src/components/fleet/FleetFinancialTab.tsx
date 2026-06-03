import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import type {
  FleetCostRow,
  FleetFineRow,
  FleetFuelingRow,
  FleetIncidentRow,
} from "@/src/types/fleet";
import {
  FINE_STATUS_OPTIONS,
  FLEET_COST_TYPE_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
} from "@/src/types/fleet";
import {
  confirmFleetCriticalAction,
  FleetLoading,
  formatFleetMoney,
  normalizeFleetList,
} from "@/src/components/fleet/fleetUi";

const SUB_TABS = [
  { id: "costs", label: "Custos" },
  { id: "fuelings", label: "Abastecimentos" },
  { id: "fines", label: "Multas" },
  { id: "incidents", label: "Sinistros / Avarias" },
] as const;

type SubTab = (typeof SUB_TABS)[number]["id"];


function formatDt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

const currentCompetence = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

export function FleetFinancialTab({ initialSubTab = "costs" as SubTab }) {
  const auth = useAuth();
  const canFinancial =
    auth.hasPermission("fleet.financial.view") || auth.hasPermission("fleet.manage");
  const canWrite = canFinancial;

  const [subTab, setSubTab] = useState<SubTab>(initialSubTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<
    { id: string; plate: string | null; brand: string; model: string; currentKm?: number }[]
  >([]);
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);

  const [costs, setCosts] = useState<FleetCostRow[]>([]);
  const [fuelings, setFuelings] = useState<FleetFuelingRow[]>([]);
  const [fines, setFines] = useState<FleetFineRow[]>([]);
  const [incidents, setIncidents] = useState<FleetIncidentRow[]>([]);

  const [costForm, setCostForm] = useState({
    vehicleId: "",
    costType: "OUTRO",
    competence: currentCompetence(),
    costDate: new Date().toISOString().slice(0, 10),
    amount: "",
    supplierName: "",
    notes: "",
  });
  const [fuelForm, setFuelForm] = useState({
    vehicleId: "",
    driverId: "",
    fuelingDate: new Date().toISOString().slice(0, 16),
    km: "",
    fuelType: "",
    liters: "",
    unitPrice: "",
    totalValue: "",
    stationName: "",
    receiptUrl: "",
    createCost: true,
  });
  const [fineForm, setFineForm] = useState({
    vehicleId: "",
    driverId: "",
    infractionDate: new Date().toISOString().slice(0, 16),
    location: "",
    noticeNumber: "",
    agency: "",
    amount: "",
    points: "",
    notes: "",
  });
  const [incidentForm, setIncidentForm] = useState({
    vehicleId: "",
    incidentType: "AVARIA",
    incidentDate: new Date().toISOString().slice(0, 16),
    description: "",
    severity: "MEDIA",
    blocksVehicle: false,
    openMaintenance: false,
    insuranceClaimNumber: "",
    deductibleValue: "",
  });

  const loadRefs = useCallback(async () => {
    const [v, d] = await Promise.all([
      fetchJsonOk<{ vehicles: typeof vehicles }>("/api/fleet/vehicles"),
      fetchJsonOk<{ drivers: typeof drivers }>("/api/fleet/drivers"),
    ]);
    setVehicles(v.vehicles);
    setDrivers(d.drivers);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (subTab === "costs") {
        const data = await fetchJsonOk<{ costs: FleetCostRow[] }>("/api/fleet/costs?status=all");
        setCosts(normalizeFleetList(data.costs));
      } else if (subTab === "fuelings") {
        const data = await fetchJsonOk<{ fuelings: FleetFuelingRow[] }>("/api/fleet/fuelings");
        setFuelings(data.fuelings);
      } else if (subTab === "fines") {
        const data = await fetchJsonOk<{ fines: FleetFineRow[] }>("/api/fleet/fines");
        setFines(data.fines);
      } else {
        const data = await fetchJsonOk<{ incidents: FleetIncidentRow[] }>("/api/fleet/incidents");
        setIncidents(data.incidents);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [subTab]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancelCost = async (id: string) => {
    const { confirmed, reason } = confirmFleetCriticalAction("cost.cancel");
    if (!confirmed || !reason) return;
    await fetchJsonOk(`/api/fleet/costs/${id}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    void load();
  };

  const saveCost = async () => {
    await fetchJsonOk("/api/fleet/costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...costForm,
        amount: Number(costForm.amount),
      }),
    });
    setCostForm((f) => ({ ...f, amount: "", notes: "" }));
    void load();
  };

  const saveFueling = async () => {
    await fetchJsonOk("/api/fleet/fuelings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...fuelForm,
        km: Number(fuelForm.km),
        liters: Number(fuelForm.liters),
        unitPrice: fuelForm.unitPrice ? Number(fuelForm.unitPrice) : null,
        totalValue: fuelForm.totalValue ? Number(fuelForm.totalValue) : null,
        driverId: fuelForm.driverId || null,
        createCost: fuelForm.createCost,
      }),
    });
    void load();
  };

  const saveFine = async () => {
    const res = await fetchJsonOk<{ duplicateWarning?: string }>("/api/fleet/fines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...fineForm,
        amount: Number(fineForm.amount || 0),
        points: fineForm.points ? Number(fineForm.points) : null,
        driverId: fineForm.driverId || null,
      }),
    });
    if (res.duplicateWarning) setError(res.duplicateWarning);
    void load();
  };

  const saveIncident = async () => {
    await fetchJsonOk("/api/fleet/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...incidentForm,
        deductibleValue: incidentForm.deductibleValue
          ? Number(incidentForm.deductibleValue)
          : null,
      }),
    });
    void load();
  };

  const patchFineStatus = async (id: string, status: string) => {
    await fetchJsonOk(`/api/fleet/fines/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, createCost: status === "PAID" }),
    });
    void load();
  };

  const patchIncidentStatus = async (id: string, status: string) => {
    await fetchJsonOk(`/api/fleet/incidents/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              subTab === t.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!canFinancial && (
        <p className="text-sm text-amber-700">
          Valores ocultos — permissão fleet.financial.view necessária.
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          {error}
          <button type="button" className="ml-auto text-xs underline" onClick={() => setError(null)}>
            Fechar
          </button>
        </div>
      )}

      {loading ? (
        <FleetLoading />
      ) : (
        <>
          {subTab === "costs" && (
            <div className="space-y-4">
              {canWrite && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={costForm.vehicleId}
                    onChange={(e) => setCostForm({ ...costForm, vehicleId: e.target.value })}
                  >
                    <option value="">Veículo</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate ?? v.brand} — {v.model}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={costForm.costType}
                    onChange={(e) => setCostForm({ ...costForm, costType: e.target.value })}
                  >
                    {FLEET_COST_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="month"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={costForm.competence}
                    onChange={(e) => setCostForm({ ...costForm, competence: e.target.value })}
                  />
                  <input
                    type="date"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={costForm.costDate}
                    onChange={(e) => setCostForm({ ...costForm, costDate: e.target.value })}
                  />
                  <input
                    placeholder="Valor"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={costForm.amount}
                    onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })}
                  />
                  <input
                    placeholder="Fornecedor"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={costForm.supplierName}
                    onChange={(e) => setCostForm({ ...costForm, supplierName: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => void saveCost()}
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-sm text-white sm:col-span-2"
                  >
                    <Plus className="h-4 w-4" />
                    Lançar custo
                  </button>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Veículo</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Competência</th>
                      <th className="px-3 py-2">Valor</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{c.costDate}</td>
                        <td className="px-3 py-2">
                          {c.vehicle?.plate ?? "—"} {c.vehicle?.model}
                        </td>
                        <td className="px-3 py-2">{c.costType}</td>
                        <td className="px-3 py-2">{c.competence}</td>
                        <td className="px-3 py-2 font-mono">
                          {formatFleetMoney(c.amount, { canView: canFinancial, masked: c.amountMasked })}
                        </td>
                        <td className="px-3 py-2">{c.status}</td>
                        <td className="px-3 py-2">
                          {canWrite && c.status === "ACTIVE" && (
                            <button
                              type="button"
                              className="text-xs text-red-600 underline"
                              onClick={() => void cancelCost(c.id)}
                            >
                              Cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {subTab === "fuelings" && (
            <div className="space-y-4">
              {canWrite && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.vehicleId}
                    onChange={(e) => setFuelForm({ ...fuelForm, vehicleId: e.target.value })}
                  >
                    <option value="">Veículo</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate ?? v.brand}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.driverId}
                    onChange={(e) => setFuelForm({ ...fuelForm, driverId: e.target.value })}
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
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.fuelingDate}
                    onChange={(e) => setFuelForm({ ...fuelForm, fuelingDate: e.target.value })}
                  />
                  <input
                    placeholder="Km"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.km}
                    onChange={(e) => setFuelForm({ ...fuelForm, km: e.target.value })}
                  />
                  <input
                    placeholder="Litros"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.liters}
                    onChange={(e) => setFuelForm({ ...fuelForm, liters: e.target.value })}
                  />
                  <input
                    placeholder="R$/litro"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.unitPrice}
                    onChange={(e) => setFuelForm({ ...fuelForm, unitPrice: e.target.value })}
                  />
                  <input
                    placeholder="Total"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fuelForm.totalValue}
                    onChange={(e) => setFuelForm({ ...fuelForm, totalValue: e.target.value })}
                  />
                  <label className="flex items-center gap-2 text-sm col-span-2">
                    <input
                      type="checkbox"
                      checked={fuelForm.createCost}
                      onChange={(e) => setFuelForm({ ...fuelForm, createCost: e.target.checked })}
                    />
                    Lançar custo de combustível
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveFueling()}
                    className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                  >
                    Registrar abastecimento
                  </button>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-left">Veículo</th>
                      <th className="px-3 py-2 text-left">Litros</th>
                      <th className="px-3 py-2 text-left">Total</th>
                      <th className="px-3 py-2 text-left">Km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuelings.map((f) => (
                      <tr key={f.id} className="border-t">
                        <td className="px-3 py-2">{formatDt(f.fuelingDate)}</td>
                        <td className="px-3 py-2">{f.vehicle?.plate}</td>
                        <td className="px-3 py-2">{f.liters}</td>
                        <td className="px-3 py-2 font-mono">
                          {formatFleetMoney(f.totalValue, { canView: canFinancial, masked: f.totalValueMasked })}
                        </td>
                        <td className="px-3 py-2">{f.km}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {subTab === "fines" && (
            <div className="space-y-4">
              {canWrite && (
                <div className="rounded-xl border bg-slate-50 p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fineForm.vehicleId}
                    onChange={(e) => setFineForm({ ...fineForm, vehicleId: e.target.value })}
                  >
                    <option value="">Veículo</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate ?? v.brand}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Nº auto"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fineForm.noticeNumber}
                    onChange={(e) => setFineForm({ ...fineForm, noticeNumber: e.target.value })}
                  />
                  <input
                    type="datetime-local"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fineForm.infractionDate}
                    onChange={(e) => setFineForm({ ...fineForm, infractionDate: e.target.value })}
                  />
                  <input
                    placeholder="Valor"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={fineForm.amount}
                    onChange={(e) => setFineForm({ ...fineForm, amount: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => void saveFine()}
                    className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                  >
                    Registrar multa
                  </button>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-left">Veículo</th>
                      <th className="px-3 py-2 text-left">Auto</th>
                      <th className="px-3 py-2 text-left">Valor</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left" />
                    </tr>
                  </thead>
                  <tbody>
                    {fines.map((f) => (
                      <tr key={f.id} className="border-t">
                        <td className="px-3 py-2">{formatDt(f.infractionDate)}</td>
                        <td className="px-3 py-2">{f.vehicle?.plate}</td>
                        <td className="px-3 py-2">{f.noticeNumber ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">
                          {formatFleetMoney(f.amount, { canView: canFinancial, masked: f.amountMasked })}
                        </td>
                        <td className="px-3 py-2">{f.status}</td>
                        <td className="px-3 py-2">
                          {canWrite && f.status === "PENDING_PAYMENT" && (
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => void patchFineStatus(f.id, "PAID")}
                            >
                              Marcar paga
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {subTab === "incidents" && (
            <div className="space-y-4">
              {canWrite && (
                <div className="rounded-xl border bg-slate-50 p-4 grid gap-2 sm:grid-cols-2">
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={incidentForm.vehicleId}
                    onChange={(e) => setIncidentForm({ ...incidentForm, vehicleId: e.target.value })}
                  >
                    <option value="">Veículo</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate ?? v.brand}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={incidentForm.severity}
                    onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}
                  >
                    <option value="BAIXA">Baixa</option>
                    <option value="MEDIA">Média</option>
                    <option value="ALTA">Alta</option>
                    <option value="GRAVE">Grave</option>
                  </select>
                  <textarea
                    className="rounded border px-2 py-1.5 text-sm sm:col-span-2"
                    placeholder="Descrição"
                    rows={2}
                    value={incidentForm.description}
                    onChange={(e) =>
                      setIncidentForm({ ...incidentForm, description: e.target.value })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={incidentForm.openMaintenance}
                      onChange={(e) =>
                        setIncidentForm({ ...incidentForm, openMaintenance: e.target.checked })
                      }
                    />
                    Abrir manutenção vinculada
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveIncident()}
                    className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                  >
                    Registrar ocorrência
                  </button>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-left">Veículo</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left">Severidade</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left" />
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((i) => (
                      <tr key={i.id} className="border-t">
                        <td className="px-3 py-2">{formatDt(i.incidentDate)}</td>
                        <td className="px-3 py-2">{i.vehicle?.plate}</td>
                        <td className="px-3 py-2">{i.incidentType}</td>
                        <td className="px-3 py-2">{i.severity}</td>
                        <td className="px-3 py-2">{i.status}</td>
                        <td className="px-3 py-2">
                          {canWrite && ["OPEN", "IN_PROGRESS"].includes(i.status) && (
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => void patchIncidentStatus(i.id, "RESOLVED")}
                            >
                              Resolver
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
