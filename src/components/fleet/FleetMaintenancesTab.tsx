import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Wrench } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useFleetPermissions } from "@/src/components/fleet/fleetPermissions";
import type { FleetMaintenanceRow, FleetMaintenanceStatus } from "@/src/types/fleet";
import {
  MAINTENANCE_PRIORITY_OPTIONS,
  MAINTENANCE_STATUS_LABEL,
  MAINTENANCE_TYPE_OPTIONS,
} from "@/src/types/fleet";
import { formatMaintenanceBlockLabel, canShowMaintenanceCancelAction, formatMaintenanceCancelOutcome } from "@/src/lib/fleetValidation";
import {
  confirmFleetCriticalAction,
  FleetListPagination,
  FleetStatusBadge,
  pickFleetListItems,
  pickFleetPagination,
  type FleetPaginatedMeta, formatFleetApiError } from "@/src/components/fleet/fleetUi";

const EMPTY_CANCEL_FORM = {
  reason: "",
  closedAt: "",
  notes: "",
};

function defaultCancelForm() {
  return {
    ...EMPTY_CANCEL_FORM,
    closedAt: new Date().toISOString().slice(0, 16),
  };
}

const EMPTY_FORM = {
  vehicleId: "",
  maintenanceType: "CORRETIVA",
  priority: "MEDIA",
  description: "",
  scheduledAt: "",
  supplierName: "",
  estimatedValue: "",
  currentKm: "",
  blocksVehicle: true,
  notes: "",
  nextScheduledAt: "",
  nextMaintenanceKm: "",
};

function formatDt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

type VehicleStatusRecalc = {
  previousStatus: string;
  nextStatus: string;
  changed: boolean;
  blockers: { label: string }[];
};

function formatVehicleStatusOutcome(result: VehicleStatusRecalc | null | undefined): string | null {
  if (!result) return null;
  if (result.nextStatus === "AVAILABLE" && result.changed) {
    return "Manutenção registrada e veículo liberado para Disponível.";
  }
  if (result.changed) {
    return `Status do veículo atualizado: ${result.previousStatus} → ${result.nextStatus}.`;
  }
  if (result.blockers.length > 0) {
    return `Veículo permanece bloqueado por: ${result.blockers.map((b) => b.label).join("; ")}.`;
  }
  return "Status do veículo mantido — nenhum bloqueio ativo detectado.";
}

export function FleetMaintenancesTab() {
  const { canManageMaintenance: canManage, canManage: canManageFleet } = useFleetPermissions();

  const [rows, setRows] = useState<FleetMaintenanceRow[]>([]);
  const [vehicles, setVehicles] = useState<
    { id: string; plate: string | null; brand: string; model: string; currentKm?: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterVehicle, setFilterVehicle] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [completeForm, setCompleteForm] = useState({
    finalValue: "",
    currentKm: "",
    servicePerformed: "",
    notes: "",
    completedAt: "",
    generateCost: true,
  });
  const [cancelForm, setCancelForm] = useState(defaultCancelForm);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
      if (filterVehicle) q.set("vehicleId", filterVehicle);
      if (filterPriority) q.set("priority", filterPriority);
      if (filterType) q.set("maintenanceType", filterType);
      if (filterStart) q.set("startDate", filterStart);
      if (filterEnd) q.set("endDate", filterEnd);
      const data = await fetchJsonOk<Record<string, unknown>>(`/api/fleet/maintenances?${q}`);
      setRows(pickFleetListItems<FleetMaintenanceRow>(data, "maintenances"));
      setPagination(pickFleetPagination(data));
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar manutenções."));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterVehicle, filterPriority, filterType, filterStart, filterEnd, page]);

  const loadVehicles = useCallback(async () => {
    const data = await fetchJsonOk<Record<string, unknown>>(
      "/api/fleet/vehicles?limit=200&page=1&includeAlerts=false"
    );
    setVehicles(pickFleetListItems(data, "vehicles"));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterVehicle, filterPriority, filterType, filterStart, filterEnd]);

  useEffect(() => {
    void load();
    void loadVehicles();
  }, [load, loadVehicles]);

  const selected = rows.find((r) => r.id === detailId) ?? null;

  const openCreate = (preset?: Partial<typeof EMPTY_FORM>) => {
    setDetailId(null);
    setForm({ ...EMPTY_FORM, ...preset });
    setModalOpen(true);
  };

  const openEdit = (m: FleetMaintenanceRow) => {
    setDetailId(m.id);
    setForm({
      vehicleId: m.vehicleId,
      maintenanceType: m.maintenanceType,
      priority: m.priority,
      description: m.description,
      scheduledAt: m.scheduledAt ? m.scheduledAt.slice(0, 16) : "",
      supplierName: m.supplierName ?? "",
      estimatedValue: m.estimatedValue != null ? String(m.estimatedValue) : "",
      currentKm: m.currentKm != null ? String(m.currentKm) : "",
      blocksVehicle: m.blocksVehicle,
      notes: m.notes ?? "",
      nextScheduledAt: m.preventiveMeta?.nextScheduledAt?.slice(0, 10) ?? "",
      nextMaintenanceKm:
        m.preventiveMeta?.nextMaintenanceKm != null
          ? String(m.preventiveMeta.nextMaintenanceKm)
          : "",
    });
    setCompleteForm({
      finalValue: m.finalValue != null ? String(m.finalValue) : "",
      currentKm: m.currentKm != null ? String(m.currentKm) : "",
      servicePerformed: m.description,
      notes: m.notes ?? "",
      completedAt: "",
      generateCost: true,
    });
    setCancelForm(defaultCancelForm());
    setModalOpen(true);
  };

  const save = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
        currentKm: form.currentKm ? Number(form.currentKm) : null,
        nextMaintenanceKm: form.nextMaintenanceKm ? Number(form.nextMaintenanceKm) : null,
        scheduledAt: form.scheduledAt || null,
        nextScheduledAt: form.nextScheduledAt || null,
      };
      if (detailId) {
        await fetchJsonOk(`/api/fleet/maintenances/${detailId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJsonOk("/api/fleet/maintenances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao salvar."));
    } finally {
      setSaving(false);
    }
  };

  const action = async (
    id: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<VehicleStatusRecalc | null> => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetchJsonOk<{
        vehicleStatus?: VehicleStatusRecalc;
        maintenance?: FleetMaintenanceRow;
      }>(`/api/fleet/maintenances/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
      await loadVehicles();
      const outcome =
        path === "cancel"
          ? formatMaintenanceCancelOutcome(res.vehicleStatus)
          : formatVehicleStatusOutcome(res.vehicleStatus);
      if (outcome) setSuccessMessage(outcome);
      if (detailId === id) {
        const refreshed = await fetchJsonOk<{ maintenance: FleetMaintenanceRow }>(
          `/api/fleet/maintenances/${id}`
        );
        openEdit(refreshed.maintenance);
      }
      return res.vehicleStatus ?? null;
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro na operação."));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const recalculateVehicleStatus = async (vehicleId: string) => {
    if (!canManageFleet) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await fetchJsonOk<VehicleStatusRecalc>(
        `/api/fleet/vehicles/${vehicleId}/recalculate-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Recálculo manual pela aba Manutenções" }),
        }
      );
      await loadVehicles();
      const outcome = formatVehicleStatusOutcome(result);
      setSuccessMessage(
        outcome ??
          (result.nextStatus === "AVAILABLE"
            ? "Veículo liberado para Disponível."
            : `Veículo ainda bloqueado por: ${result.blockers.map((b) => b.label).join("; ")}`)
      );
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao recalcular status."));
    } finally {
      setSaving(false);
    }
  };

  const submitCancel = async (id: string) => {
    const reason = cancelForm.reason.trim();
    if (reason.length < 5) {
      setError("Informe o motivo do cancelamento (mínimo 5 caracteres).");
      return;
    }
    if (!cancelForm.closedAt) {
      setError("Informe a data de fechamento/cancelamento.");
      return;
    }
    await action(id, "cancel", {
      reason,
      closedAt: cancelForm.closedAt,
      notes: cancelForm.notes.trim() || undefined,
    });
    setCancelTargetId(null);
    setCancelForm(defaultCancelForm());
  };

  const openCancelModal = (id: string) => {
    setCancelTargetId(id);
    setCancelForm(defaultCancelForm());
    setError(null);
  };

  const submitComplete = async () => {
    if (!detailId) return;
    const { confirmed } = confirmFleetCriticalAction("maintenance.complete");
    if (!confirmed) return;
    await action(detailId, "complete", {
      finalValue: completeForm.finalValue ? Number(completeForm.finalValue) : null,
      currentKm: completeForm.currentKm ? Number(completeForm.currentKm) : null,
      servicePerformed: completeForm.servicePerformed,
      notes: completeForm.notes,
      completedAt: completeForm.completedAt || undefined,
      generateCost: completeForm.generateCost,
    });
    setModalOpen(false);
  };

  return (
    <div className="space-y-3">
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select
          className="rounded-lg border px-2 py-2 text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Status</option>
          {(Object.keys(MAINTENANCE_STATUS_LABEL) as FleetMaintenanceStatus[]).map((s) => (
            <option key={s} value={s}>
              {MAINTENANCE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border px-2 py-2 text-sm min-w-[140px]"
          value={filterVehicle}
          onChange={(e) => setFilterVehicle(e.target.value)}
        >
          <option value="">Veículo</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate ?? "—"} · {v.brand} {v.model}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border px-2 py-2 text-sm"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
        >
          <option value="">Prioridade</option>
          {MAINTENANCE_PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border px-2 py-2 text-sm"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">Tipo</option>
          {MAINTENANCE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input type="date" className="rounded-lg border px-2 py-2 text-sm" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} />
        <input type="date" className="rounded-lg border px-2 py-2 text-sm" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} />
        {canManageFleet && filterVehicle && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void recalculateVehicleStatus(filterVehicle)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            Recalcular status do veículo
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
          >
            <Plus className="h-4 w-4" />
            Nova manutenção
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Veículo</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Prioridade</th>
                <th className="px-3 py-2 text-left">Bloqueia</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Nenhuma manutenção encontrada.
                  </td>
                </tr>
              ) : (
                rows.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      {m.vehicle?.plate ?? "—"} · {m.vehicle?.brand} {m.vehicle?.model}
                    </td>
                    <td className="px-3 py-2">{m.maintenanceType}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{m.description}</td>
                    <td className="px-3 py-2">{MAINTENANCE_STATUS_LABEL[m.status]}</td>
                    <td className="px-3 py-2">{m.priority}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          m.blocksVehicle &&
                            !["COMPLETED", "CANCELED"].includes(m.status) &&
                            "text-amber-700 font-medium"
                        )}
                      >
                        {formatMaintenanceBlockLabel(m.blocksVehicle, m.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {canManage && canShowMaintenanceCancelAction(m.status) && (
                          <button
                            type="button"
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-700"
                            disabled={saving}
                            title="Cancelar manutenção"
                            aria-label="Cancelar manutenção"
                            onClick={() => openCancelModal(m.id)}
                          >
                            ✕
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            className="rounded border p-1"
                            onClick={() => openEdit(m)}
                            title="Detalhar / editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-4 pb-3">
            <FleetListPagination meta={pagination} loading={loading} onPageChange={setPage} />
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              {detailId ? "Manutenção" : "Nova manutenção"}
              {selected && (
                <span className="text-sm font-normal text-slate-500">
                  — {MAINTENANCE_STATUS_LABEL[selected.status]}
                </span>
              )}
            </h3>

            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {!detailId && (
                <select
                  className="rounded border px-2 py-1.5 sm:col-span-2"
                  value={form.vehicleId}
                  onChange={(e) => {
                    const v = vehicles.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      vehicleId: e.target.value,
                      currentKm: v?.currentKm != null ? String(v.currentKm) : f.currentKm,
                    }));
                  }}
                >
                  <option value="">Veículo *</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate ?? "—"} · {v.brand} {v.model}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="rounded border px-2 py-1.5"
                value={form.maintenanceType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maintenanceType: e.target.value,
                    blocksVehicle: e.target.value === "PREVENTIVA" ? false : f.blocksVehicle,
                  }))
                }
              >
                {MAINTENANCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="rounded border px-2 py-1.5"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                {MAINTENANCE_PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <textarea
                className="rounded border px-2 py-1.5 sm:col-span-2"
                rows={2}
                placeholder="Descrição *"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
              <input
                type="datetime-local"
                className="rounded border px-2 py-1.5"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1.5"
                placeholder="Fornecedor"
                value={form.supplierName}
                onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
              />
              <input
                type="number"
                className="rounded border px-2 py-1.5"
                placeholder="Valor estimado"
                value={form.estimatedValue}
                onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
              />
              <input
                type="number"
                className="rounded border px-2 py-1.5"
                placeholder="Km"
                value={form.currentKm}
                onChange={(e) => setForm((f) => ({ ...f, currentKm: e.target.value }))}
              />
              {form.maintenanceType === "PREVENTIVA" && (
                <>
                  <input
                    type="date"
                    className="rounded border px-2 py-1.5"
                    placeholder="Próxima data"
                    value={form.nextScheduledAt}
                    onChange={(e) => setForm((f) => ({ ...f, nextScheduledAt: e.target.value }))}
                  />
                  <input
                    type="number"
                    className="rounded border px-2 py-1.5"
                    placeholder="Próximo km"
                    value={form.nextMaintenanceKm}
                    onChange={(e) => setForm((f) => ({ ...f, nextMaintenanceKm: e.target.value }))}
                  />
                </>
              )}
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.blocksVehicle}
                  onChange={(e) => setForm((f) => ({ ...f, blocksVehicle: e.target.checked }))}
                />
                Bloqueia veículo (manutenção / bloqueio conforme prioridade)
              </label>
            </div>

            {detailId && selected && canManage && (
              <div className="mt-4 space-y-3 border-t pt-3">
                <p className="text-xs text-slate-500">
                  Aberta: {formatDt(selected.openedAt)}
                  {selected.scheduledAt ? ` · Agendada: ${formatDt(selected.scheduledAt)}` : ""}
                </p>
                <div className="flex flex-wrap gap-1">
                  {selected.status === "PENDING_APPROVAL" && (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      disabled={saving}
                      onClick={() => void action(detailId, "approve")}
                    >
                      Aprovar
                    </button>
                  )}
                  {["APPROVED", "SCHEDULED", "OPEN"].includes(selected.status) && (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      disabled={saving}
                      onClick={() => void action(detailId, "start")}
                    >
                      Iniciar
                    </button>
                  )}
                  {["IN_PROGRESS", "APPROVED"].includes(selected.status) && (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      disabled={saving}
                      onClick={() => void submitComplete()}
                    >
                      Concluir
                    </button>
                  )}
                  {selected.status === "COMPLETED" && !(selected.costs?.length) && (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      disabled={saving}
                      onClick={() => void action(detailId, "generate-cost")}
                    >
                      Gerar custo
                    </button>
                  )}
                </div>

                {["IN_PROGRESS", "APPROVED"].includes(selected.status) && (
                  <div className="grid gap-2 sm:grid-cols-2 rounded-lg border p-2 bg-slate-50">
                    <input
                      type="number"
                      placeholder="Valor final"
                      className="rounded border px-2 py-1.5"
                      value={completeForm.finalValue}
                      onChange={(e) =>
                        setCompleteForm((f) => ({ ...f, finalValue: e.target.value }))
                      }
                    />
                    <input
                      type="number"
                      placeholder="Km conclusão"
                      className="rounded border px-2 py-1.5"
                      value={completeForm.currentKm}
                      onChange={(e) =>
                        setCompleteForm((f) => ({ ...f, currentKm: e.target.value }))
                      }
                    />
                    <textarea
                      className="rounded border px-2 py-1.5 sm:col-span-2"
                      rows={2}
                      placeholder="Serviço realizado"
                      value={completeForm.servicePerformed}
                      onChange={(e) =>
                        setCompleteForm((f) => ({ ...f, servicePerformed: e.target.value }))
                      }
                    />
                    <label className="flex items-center gap-2 sm:col-span-2 text-xs">
                      <input
                        type="checkbox"
                        checked={completeForm.generateCost}
                        onChange={(e) =>
                          setCompleteForm((f) => ({ ...f, generateCost: e.target.checked }))
                        }
                      />
                      Gerar custo automaticamente se valor final &gt; 0
                    </label>
                  </div>
                )}

                {canShowMaintenanceCancelAction(selected.status) && (
                  <div className="rounded-lg border border-red-100 bg-red-50/50 p-3 space-y-2">
                    <p className="text-xs text-red-800">
                      Informe o motivo do cancelamento. Se não houver outros bloqueios ativos, o
                      veículo será liberado automaticamente.
                    </p>
                    <textarea
                      className="w-full rounded border px-2 py-1.5 text-sm"
                      rows={2}
                      placeholder="Motivo do cancelamento *"
                      value={cancelForm.reason}
                      onChange={(e) => setCancelForm((f) => ({ ...f, reason: e.target.value }))}
                    />
                    <input
                      type="datetime-local"
                      className="w-full rounded border px-2 py-1.5 text-sm"
                      value={cancelForm.closedAt}
                      onChange={(e) => setCancelForm((f) => ({ ...f, closedAt: e.target.value }))}
                    />
                    <textarea
                      className="w-full rounded border px-2 py-1.5 text-sm"
                      rows={2}
                      placeholder="Observação complementar (opcional)"
                      value={cancelForm.notes}
                      onChange={(e) => setCancelForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                      disabled={saving || cancelForm.reason.trim().length < 5 || !cancelForm.closedAt}
                      onClick={() => void submitCancel(detailId)}
                    >
                      Cancelar manutenção
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setModalOpen(false)}>
                Fechar
              </button>
              {canManage && !detailId && (
                <button
                  type="button"
                  disabled={saving || !form.vehicleId || !form.description}
                  onClick={() => void save()}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {saving ? "Salvando…" : "Criar"}
                </button>
              )}
              {canManage && detailId && !["COMPLETED", "CANCELED"].includes(selected?.status ?? "") && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Salvar alterações
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {cancelTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold text-slate-900">Cancelar manutenção</h3>
            <p className="mt-2 text-sm text-slate-600">
              Informe o motivo do cancelamento. Se não houver outros bloqueios ativos, o veículo
              será liberado automaticamente.
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Motivo do cancelamento *
            </label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={3}
              placeholder="Descreva o motivo (mínimo 5 caracteres)"
              value={cancelForm.reason}
              onChange={(e) => setCancelForm((f) => ({ ...f, reason: e.target.value }))}
            />
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Data de fechamento/cancelamento *
            </label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={cancelForm.closedAt}
              onChange={(e) => setCancelForm((f) => ({ ...f, closedAt: e.target.value }))}
            />
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Observação complementar
            </label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={2}
              placeholder="Opcional"
              value={cancelForm.notes}
              onChange={(e) => setCancelForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => {
                  setCancelTargetId(null);
                  setCancelForm(defaultCancelForm());
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={
                  saving || cancelForm.reason.trim().length < 5 || !cancelForm.closedAt
                }
                onClick={() => void submitCancel(cancelTargetId)}
              >
                Confirmar cancelamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
