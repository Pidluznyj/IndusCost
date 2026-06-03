import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Loader2, Pencil, Plus, Search, ShieldCheck } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import type { CnhComputedStatus, FleetDriverRow, FleetDriverStatus } from "@/src/types/fleet";
import {
  CNH_CATEGORY_OPTIONS,
  DRIVER_STATUS_OPTIONS,
} from "@/src/types/fleet";

const CNH_LABEL: Record<CnhComputedStatus, string> = {
  VALID: "Válida",
  EXPIRING: "Vencendo",
  EXPIRED: "Vencida",
  MISSING: "Sem data",
};

const STATUS_LABEL: Record<FleetDriverStatus, string> = {
  AUTHORIZED: "Autorizado",
  PENDING: "Pendente",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
};

const EMPTY_FORM = {
  name: "",
  cpf: "",
  cnhNumber: "",
  cnhCategory: "",
  cnhExpirationDate: "",
  phone: "",
  email: "",
  unit: "",
  costCenter: "",
  status: "PENDING" as FleetDriverStatus,
  notes: "",
};

export function FleetDriversTab() {
  const auth = useAuth();
  const canManage = auth.hasPermission("fleet.manage");

  const [drivers, setDrivers] = useState<FleetDriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUnit, setFilterUnit] = useState("");
  const [filterCostCenter, setFilterCostCenter] = useState("");
  const [filterCnh, setFilterCnh] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [blockModal, setBlockModal] = useState<{ id: string; action: "block" | "unblock" } | null>(
    null
  );
  const [blockReason, setBlockReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (filterStatus) q.set("status", filterStatus);
      if (filterUnit) q.set("unit", filterUnit);
      if (filterCostCenter) q.set("costCenter", filterCostCenter);
      if (filterCnh) q.set("cnhFilter", filterCnh);
      if (search) q.set("search", search);
      const data = await fetchJsonOk<{ drivers: FleetDriverRow[] }>(
        `/api/fleet/drivers?${q}`
      );
      setDrivers(data.drivers);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar motoristas.");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterUnit, filterCostCenter, filterCnh, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (d: FleetDriverRow) => {
    setEditId(d.id);
    setForm({
      name: d.name,
      cpf: d.cpf,
      cnhNumber: d.cnhNumber ?? "",
      cnhCategory: d.cnhCategory ?? "",
      cnhExpirationDate: d.cnhExpirationDate
        ? new Date(d.cnhExpirationDate).toISOString().slice(0, 10)
        : "",
      phone: d.phone ?? "",
      email: d.email ?? "",
      unit: d.unit ?? "",
      costCenter: d.costCenter ?? "",
      status: d.status,
      notes: d.notes ?? "",
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        cnhExpirationDate: form.cnhExpirationDate || null,
      };
      if (editId) {
        await fetchJsonOk(`/api/fleet/drivers/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJsonOk("/api/fleet/drivers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar motorista.");
    } finally {
      setSaving(false);
    }
  };

  const submitBlock = async () => {
    if (!blockModal || !canManage) return;
    setSaving(true);
    setError(null);
    try {
      const path =
        blockModal.action === "block"
          ? `/api/fleet/drivers/${blockModal.id}/block`
          : `/api/fleet/drivers/${blockModal.id}/unblock`;
      await fetchJsonOk(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: blockReason }),
      });
      setBlockModal(null);
      setBlockReason("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao alterar status.");
    } finally {
      setSaving(false);
    }
  };

  const cnhClass = (s?: CnhComputedStatus) =>
    s === "EXPIRED"
      ? "text-red-700 font-medium"
      : s === "EXPIRING"
        ? "text-amber-700 font-medium"
        : "";

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm"
            placeholder="Buscar nome, CPF, CNH..."
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
          {DRIVER_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm w-28"
          placeholder="Unidade"
          value={filterUnit}
          onChange={(e) => setFilterUnit(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm w-32"
          placeholder="Centro custo"
          value={filterCostCenter}
          onChange={(e) => setFilterCostCenter(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={filterCnh}
          onChange={(e) => setFilterCnh(e.target.value)}
        >
          <option value="">CNH</option>
          <option value="expired">Vencida</option>
          <option value="expiring">Vencendo</option>
        </select>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
          >
            <Plus className="h-4 w-4" />
            Novo motorista
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">CPF</th>
                <th className="px-3 py-2 text-left">CNH</th>
                <th className="px-3 py-2 text-left">Validade</th>
                <th className="px-3 py-2 text-left">Unidade</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Nenhum motorista encontrado.
                  </td>
                </tr>
              ) : (
                drivers.map((d) => {
                  const critical = (d.alerts ?? []).some((a) => a.level === "critical");
                  return (
                    <tr
                      key={d.id}
                      className={cn(
                        "border-t border-slate-100",
                        critical && "bg-red-50/50"
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{d.name}</div>
                        {(d.alerts ?? []).length > 0 && (
                          <div className="mt-0.5 text-xs text-amber-700">
                            {(d.alerts ?? []).map((a) => a.message).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{d.cpf}</td>
                      <td className="px-3 py-2">
                        {d.cnhCategory ?? "—"}
                        {d.cnhNumber ? ` · ${d.cnhNumber}` : ""}
                      </td>
                      <td className={cn("px-3 py-2", cnhClass(d.cnhStatus))}>
                        {d.cnhExpirationDate
                          ? new Date(d.cnhExpirationDate).toLocaleDateString("pt-BR")
                          : "—"}
                        {d.cnhStatus && (
                          <span className="ml-1 text-xs">({CNH_LABEL[d.cnhStatus]})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{d.unit ?? "—"}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[d.status]}</td>
                      <td className="px-3 py-2 text-right">
                        {canManage && (
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              title="Editar"
                              className="rounded border p-1"
                              onClick={() => openEdit(d)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {d.status === "BLOCKED" ? (
                              <button
                                type="button"
                                title="Desbloquear"
                                className="rounded border p-1 text-green-700"
                                onClick={() =>
                                  setBlockModal({ id: d.id, action: "unblock" })
                                }
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Bloquear"
                                className="rounded border p-1 text-red-700"
                                onClick={() => setBlockModal({ id: d.id, action: "block" })}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold">{editId ? "Editar motorista" : "Novo motorista"}</h3>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <input
                placeholder="Nome *"
                className="rounded border px-2 py-1.5 sm:col-span-2"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                placeholder="CPF *"
                className="rounded border px-2 py-1.5"
                value={form.cpf}
                onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
              />
              <input
                placeholder="Telefone"
                className="rounded border px-2 py-1.5"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <input
                placeholder="E-mail"
                className="rounded border px-2 py-1.5 sm:col-span-2"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              <input
                placeholder="Nº CNH"
                className="rounded border px-2 py-1.5"
                value={form.cnhNumber}
                onChange={(e) => setForm((f) => ({ ...f, cnhNumber: e.target.value }))}
              />
              <select
                className="rounded border px-2 py-1.5"
                value={form.cnhCategory}
                onChange={(e) => setForm((f) => ({ ...f, cnhCategory: e.target.value }))}
              >
                <option value="">Categoria CNH</option>
                {CNH_CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="rounded border px-2 py-1.5"
                value={form.cnhExpirationDate}
                onChange={(e) => setForm((f) => ({ ...f, cnhExpirationDate: e.target.value }))}
              />
              <select
                className="rounded border px-2 py-1.5"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as FleetDriverStatus }))
                }
              >
                {DRIVER_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                placeholder="Unidade"
                className="rounded border px-2 py-1.5"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              />
              <input
                placeholder="Centro de custo"
                className="rounded border px-2 py-1.5"
                value={form.costCenter}
                onChange={(e) => setForm((f) => ({ ...f, costCenter: e.target.value }))}
              />
              <textarea
                placeholder="Observações"
                className="rounded border px-2 py-1.5 sm:col-span-2"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {blockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold">
              {blockModal.action === "block" ? "Bloquear motorista" : "Desbloquear motorista"}
            </h3>
            <textarea
              className="mt-3 w-full rounded border px-2 py-1.5 text-sm"
              rows={3}
              placeholder="Motivo *"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBlockModal(null);
                  setBlockReason("");
                }}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !blockReason.trim()}
                onClick={() => void submitBlock()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
