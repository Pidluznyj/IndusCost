import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Eye, Loader2, Plus, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useFleetPermissions } from "@/src/components/fleet/fleetPermissions";
import type { FleetVehicleOrigin, FleetVehicleRow, FleetVehicleStatus } from "@/src/types/fleet";
import { FleetVehicleDetailSheet } from "@/src/components/fleet/FleetVehicleDetailSheet";
import {
  FleetListPagination,
  FleetStatusBadge,
  formatFleetKm,
  pickFleetListItems,
  pickFleetPagination,
  type FleetPaginatedMeta, formatFleetApiError } from "@/src/components/fleet/fleetUi";

const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservado",
  IN_USE: "Em uso",
  MAINTENANCE: "Manutenção",
  BLOCKED: "Bloqueado",
  CLAIMED: "Sinistrado",
  INACTIVE: "Inativo",
  RETURNED: "Devolvido",
  SOLD: "Vendido",
};

const ORIGIN_LABEL: Record<FleetVehicleOrigin, string> = {
  OWNED: "Próprio",
  RENTED: "Alugado",
  LEASING: "Leasing",
  COMODATO: "Comodato",
  THIRD_PARTY: "Terceiro",
};

const EMPTY_FORM = {
  plate: "",
  brand: "",
  model: "",
  origin: "OWNED" as FleetVehicleOrigin,
  renavam: "",
  chassis: "",
  color: "",
  vehicleType: "",
  fuelType: "",
  currentKm: "0",
  initialKm: "0",
  unit: "",
  costCenter: "",
  notes: "",
};

export function FleetVehiclesTab() {
  const { canEditVehicles: canEdit, canManage, canFinancial } = useFleetPermissions();

  const [vehicles, setVehicles] = useState<FleetVehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOrigin, setFilterOrigin] = useState("");
  const [filterUnit, setFilterUnit] = useState("");
  const [filterCostCenter, setFilterCostCenter] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<FleetPaginatedMeta | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("limit", "50");
      if (filterStatus) q.set("status", filterStatus);
      if (filterOrigin) q.set("origin", filterOrigin);
      if (filterUnit) q.set("unit", filterUnit);
      if (filterCostCenter) q.set("costCenter", filterCostCenter);
      if (search) q.set("search", search);
      const data = await fetchJsonOk<Record<string, unknown>>(`/api/fleet/vehicles?${q}`);
      setVehicles(pickFleetListItems<FleetVehicleRow>(data, "vehicles"));
      setPagination(pickFleetPagination(data));
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar veículos."));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterOrigin, filterUnit, filterCostCenter, search, page]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterOrigin, filterUnit, filterCostCenter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNew = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk("/api/fleet/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          currentKm: Number(form.currentKm) || 0,
          initialKm: Number(form.initialKm) || 0,
        }),
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao criar veículo."));
    } finally {
      setSaving(false);
    }
  };

  const criticalCount = (v: FleetVehicleRow) =>
    (v.alerts ?? []).filter((a) => a.level === "critical").length;

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm"
            placeholder="Placa, marca, modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={filterOrigin}
          onChange={(e) => setFilterOrigin(e.target.value)}
        >
          <option value="">Origem</option>
          {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Unidade"
          value={filterUnit}
          onChange={(e) => setFilterUnit(e.target.value)}
        />
        <input
          className="w-32 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Centro custo"
          value={filterCostCenter}
          onChange={(e) => setFilterCostCenter(e.target.value)}
        />
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
          >
            <Plus className="h-4 w-4" />
            Novo veículo
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Placa</th>
                <th className="px-3 py-2.5">Marca / Modelo</th>
                <th className="px-3 py-2.5">Origem</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Km</th>
                <th className="px-3 py-2.5">Unidade</th>
                <th className="px-3 py-2.5">CC</th>
                <th className="px-3 py-2.5">Alertas</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => {
                const crit = criticalCount(v);
                return (
                  <tr
                    key={v.id}
                    className="border-t border-slate-100 hover:bg-slate-50/80"
                  >
                    <td className="px-3 py-2 font-medium">{v.plate ?? "—"}</td>
                    <td className="px-3 py-2">
                      {v.brand} {v.model}
                    </td>
                    <td className="px-3 py-2">{ORIGIN_LABEL[v.origin]}</td>
                    <td className="px-3 py-2">
                      <FleetStatusBadge status={v.status} label={STATUS_LABEL[v.status]} />
                    </td>
                    <td className="px-3 py-2">{formatFleetKm(v.currentKm)}</td>
                    <td className="px-3 py-2">{v.unit ?? "—"}</td>
                    <td className="px-3 py-2">{v.costCenter ?? "—"}</td>
                    <td className="px-3 py-2">
                      {crit > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {crit}
                        </span>
                      ) : (v.alerts?.length ?? 0) > 0 ? (
                        <span className="text-amber-600">{v.alerts!.length}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        title="Abrir ficha"
                        className="rounded p-1 hover:bg-slate-200"
                        onClick={() => setDetailId(v.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {vehicles.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum veículo encontrado.</p>
          )}
          <div className="px-4 pb-3">
            <FleetListPagination
              meta={pagination}
              loading={loading}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold">Novo veículo</h3>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["plate", "Placa"],
                  ["brand", "Marca *"],
                  ["model", "Modelo *"],
                  ["renavam", "RENAVAM"],
                  ["chassis", "Chassi"],
                  ["currentKm", "Km atual"],
                  ["unit", "Unidade"],
                  ["costCenter", "Centro de custo"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="block">
                  {label}
                  <input
                    className="mt-1 w-full rounded border px-2 py-1.5"
                    value={form[k]}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="block">
                Origem
                <select
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={form.origin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, origin: e.target.value as FleetVehicleOrigin }))
                  }
                >
                  {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                onClick={() => void saveNew()}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {detailId && (
        <FleetVehicleDetailSheet
          vehicleId={detailId}
          onClose={() => setDetailId(null)}
          onUpdated={() => void load()}
          canEdit={canEdit}
          canManage={canManage}
          canFinancial={canFinancial}
        />
      )}
    </div>
  );
}
