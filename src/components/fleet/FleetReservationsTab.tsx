import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useFleetPermissions } from "@/src/components/fleet/fleetPermissions";
import type {
  FleetAvailabilityVehicle,
  FleetDriverRow,
  FleetReservationRow,
  FleetReservationStatus,
} from "@/src/types/fleet";
import { RESERVATION_STATUS_OPTIONS } from "@/src/types/fleet";
import { FleetCheckoutCheckinModal } from "@/src/components/fleet/FleetCheckoutCheckinModal";
import { FleetMobileUsageFlow } from "@/src/components/fleet/FleetMobileUsageFlow";
import {
  FleetListPagination,
  pickFleetListItems,
  pickFleetPagination,
  type FleetPaginatedMeta,
} from "@/src/components/fleet/fleetUi";

const STATUS_LABEL: Record<FleetReservationStatus, string> = {
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

function formatDt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function toIsoLocal(dtLocal: string) {
  if (!dtLocal) return "";
  const d = new Date(dtLocal);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const EMPTY_RES = {
  vehicleId: "",
  driverId: "",
  startDateTime: "",
  endDateTime: "",
  destination: "",
  reason: "",
  costCenter: "",
  notes: "",
};

export function FleetReservationsTab() {
  const {
    canCreateReservations: canCreate,
    canApproveReservations: canApprove,
    canManageReservations: canManage,
  } = useFleetPermissions();

  const [reservations, setReservations] = useState<FleetReservationRow[]>([]);
  const [drivers, setDrivers] = useState<FleetDriverRow[]>([]);
  const [available, setAvailable] = useState<FleetAvailabilityVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "week">("list");
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));
  const [filterStatus, setFilterStatus] = useState("");
  const [filterVehicle, setFilterVehicle] = useState("");
  const [filterDriver, setFilterDriver] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_RES);
  const [reasonModal, setReasonModal] = useState<{
    id: string;
    action: "reject" | "cancel";
  } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [replaceModal, setReplaceModal] = useState<string | null>(null);
  const [replaceVehicleId, setReplaceVehicleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState<FleetReservationRow | null>(null);
  const [checkinModal, setCheckinModal] = useState<FleetReservationRow | null>(null);
  const [mobileFlowId, setMobileFlowId] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<FleetPaginatedMeta | null>(null);

  const loadDrivers = useCallback(async () => {
    const data = await fetchJsonOk<Record<string, unknown>>(
      "/api/fleet/drivers?status=AUTHORIZED&limit=200&page=1"
    );
    setDrivers(pickFleetListItems<FleetDriverRow>(data, "drivers"));
  }, []);

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("limit", "50");
      if (filterStatus) q.set("status", filterStatus);
      if (filterVehicle) q.set("vehicleId", filterVehicle);
      if (filterDriver) q.set("driverId", filterDriver);
      if (filterStart) q.set("startDate", filterStart);
      if (filterEnd) q.set("endDate", filterEnd);
      const data = await fetchJsonOk<Record<string, unknown>>(`/api/fleet/reservations?${q}`);
      setReservations(pickFleetListItems<FleetReservationRow>(data, "reservations"));
      setPagination(pickFleetPagination(data));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar reservas.");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterVehicle, filterDriver, filterStart, filterEnd, page]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterVehicle, filterDriver, filterStart, filterEnd]);

  useEffect(() => {
    void loadReservations();
    void loadDrivers();
  }, [loadReservations, loadDrivers]);

  const loadAvailability = useCallback(async () => {
    const start = toIsoLocal(form.startDateTime);
    const end = toIsoLocal(form.endDateTime);
    if (!start || !end) {
      setAvailable([]);
      return;
    }
    try {
      const q = new URLSearchParams({ start, end });
      const data = await fetchJsonOk<{ vehicles: FleetAvailabilityVehicle[] }>(
        `/api/fleet/availability?${q}`
      );
      setAvailable(data.vehicles);
      if (form.vehicleId && !data.vehicles.some((v) => v.id === form.vehicleId)) {
        setForm((f) => ({ ...f, vehicleId: "" }));
      }
    } catch {
      setAvailable([]);
    }
  }, [form.startDateTime, form.endDateTime, form.vehicleId]);

  useEffect(() => {
    if (createOpen) void loadAvailability();
  }, [createOpen, loadAvailability]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i));
  }, [weekAnchor]);

  const reservationsByDay = useMemo(() => {
    const map = new Map<string, FleetReservationRow[]>();
    for (const day of weekDays) {
      map.set(day.toDateString(), []);
    }
    for (const r of reservations) {
      const start = new Date(r.startDateTime);
      for (const day of weekDays) {
        const dayEnd = addDays(day, 1);
        if (start < dayEnd && new Date(r.endDateTime) > day) {
          const key = day.toDateString();
          map.get(key)?.push(r);
        }
      }
    }
    return map;
  }, [reservations, weekDays]);

  const vehicleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of reservations) {
      if (r.vehicle) {
        seen.set(
          r.vehicle.id,
          `${r.vehicle.plate ?? "—"} · ${r.vehicle.brand} ${r.vehicle.model}`
        );
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [reservations]);

  const createReservation = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk("/api/fleet/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startDateTime: toIsoLocal(form.startDateTime),
          endDateTime: toIsoLocal(form.endDateTime),
          driverId: form.driverId || null,
        }),
      });
      setCreateOpen(false);
      setForm(EMPTY_RES);
      await loadReservations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao criar reserva.");
    } finally {
      setSaving(false);
    }
  };

  const patchAction = async (
    id: string,
    action: "approve" | "reject" | "cancel" | "replace-vehicle",
    body?: Record<string, unknown>
  ) => {
    setSaving(true);
    setError(null);
    try {
      const method = action === "replace-vehicle" ? "PATCH" : "PATCH";
      await fetchJsonOk(`/api/fleet/reservations/${id}/${action}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await loadReservations();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro na operação.");
    } finally {
      setSaving(false);
    }
  };

  const cardClass = (status: FleetReservationStatus) =>
    cn(
      "rounded-xl border bg-white p-3 text-sm",
      status === "PENDING_APPROVAL" || status === "REQUESTED"
        ? "border-amber-300 bg-amber-50/40"
        : status === "APPROVED"
          ? "border-emerald-200"
          : status === "REJECTED" || status === "CANCELED"
            ? "border-slate-200 opacity-75"
            : "border-slate-200"
    );

  const ReservationCard = ({ r }: { r: FleetReservationRow }) => (
    <div className={cardClass(r.status)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">
            {r.vehicle?.plate ?? "—"} — {r.vehicle?.brand} {r.vehicle?.model}
          </span>
          <span
            className={cn(
              "ml-2 rounded px-1.5 py-0.5 text-xs",
              r.status === "PENDING_APPROVAL" ? "bg-amber-200 text-amber-900" : "text-slate-500"
            )}
          >
            {STATUS_LABEL[r.status]}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {canApprove && r.status === "PENDING_APPROVAL" && (
            <>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                disabled={saving}
                onClick={() => void patchAction(r.id, "approve")}
              >
                Aprovar
              </button>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={() => setReasonModal({ id: r.id, action: "reject" })}
              >
                Rejeitar
              </button>
            </>
          )}
          {canCreate && r.status === "APPROVED" && (
            <>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs inline-flex items-center gap-1"
                onClick={() => setMobileFlowId(r.id)}
                title="Fluxo em campo (celular)"
              >
                <Smartphone className="h-3 w-3" />
                Campo
              </button>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={() => setCheckoutModal(r)}
              >
                Retirada
              </button>
            </>
          )}
          {canCreate && r.status === "IN_USE" && (
            <>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs inline-flex items-center gap-1"
                onClick={() => setMobileFlowId(r.id)}
                title="Fluxo em campo (celular)"
              >
                <Smartphone className="h-3 w-3" />
                Campo
              </button>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={() => setCheckinModal(r)}
              >
                Devolução
              </button>
            </>
          )}
          {canManage && ["PENDING_APPROVAL", "APPROVED"].includes(r.status) && (
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => {
                setReplaceModal(r.id);
                setReplaceVehicleId("");
              }}
            >
              Substituir veículo
            </button>
          )}
          {canCreate &&
            ["REQUESTED", "PENDING_APPROVAL", "APPROVED"].includes(r.status) && (
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs text-red-700"
                onClick={() => setReasonModal({ id: r.id, action: "cancel" })}
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
      {r.rejectionReason && (
        <p className="mt-1 text-xs text-red-700">Rejeição: {r.rejectionReason}</p>
      )}
      {r.cancelReason && (
        <p className="mt-1 text-xs text-slate-500">Cancelamento: {r.cancelReason}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={filterStart}
          onChange={(e) => setFilterStart(e.target.value)}
          title="Início período"
        />
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={filterEnd}
          onChange={(e) => setFilterEnd(e.target.value)}
          title="Fim período"
        />
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Status</option>
          {RESERVATION_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm min-w-[140px]"
          value={filterVehicle}
          onChange={(e) => setFilterVehicle(e.target.value)}
        >
          <option value="">Veículo</option>
          {vehicleOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm min-w-[140px]"
          value={filterDriver}
          onChange={(e) => setFilterDriver(e.target.value)}
        >
          <option value="">Motorista</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-slate-200">
          <button
            type="button"
            className={cn("px-2 py-2", view === "list" && "bg-slate-100")}
            onClick={() => setView("list")}
            title="Lista"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={cn("px-2 py-2", view === "week" && "bg-slate-100")}
            onClick={() => setView("week")}
            title="Semana"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void loadReservations()}
          className="rounded-lg border px-2 py-2 text-slate-600"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_RES);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
          >
            <Plus className="h-4 w-4" />
            Nova reserva
          </button>
        )}
      </div>

      {view === "week" && (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded border px-2 py-1"
            onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}
          >
            ←
          </button>
          <span>
            Semana de {weekAnchor.toLocaleDateString("pt-BR")} a{" "}
            {addDays(weekAnchor, 6).toLocaleDateString("pt-BR")}
          </span>
          <button
            type="button"
            className="rounded border px-2 py-1"
            onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}
          >
            →
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={() => setWeekAnchor(startOfWeek(new Date()))}
          >
            Hoje
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : view === "list" ? (
        <div className="space-y-2">
          {reservations.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma reserva no período.</p>
          ) : (
            reservations.map((r) => (
              <div key={r.id}>
                <ReservationCard r={r} />
              </div>
            ))
          )}
          <FleetListPagination meta={pagination} loading={loading} onPageChange={setPage} />
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-7">
          {weekDays.map((day) => {
            const items = reservationsByDay.get(day.toDateString()) ?? [];
            return (
              <div
                key={day.toISOString()}
                className="min-h-[120px] rounded-xl border border-slate-200 bg-slate-50/50 p-2"
              >
                <p className="text-xs font-semibold text-slate-700">
                  {day.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" })}
                </p>
                <div className="mt-1 space-y-1">
                  {items.map((r) => (
                    <div
                      key={r.id}
                      className={cn(
                        "rounded border px-1 py-0.5 text-[10px] leading-tight",
                        r.status === "PENDING_APPROVAL"
                          ? "border-amber-400 bg-amber-100"
                          : "border-slate-200 bg-white"
                      )}
                      title={`${r.vehicle?.plate} ${STATUS_LABEL[r.status]}`}
                    >
                      {r.vehicle?.plate ?? "—"}
                      <br />
                      {new Date(r.startDateTime).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Nova reserva
            </h3>
            <div className="mt-3 grid gap-2 text-sm">
              <input
                type="datetime-local"
                className="rounded border px-2 py-1.5 w-full"
                value={form.startDateTime}
                onChange={(e) => setForm((f) => ({ ...f, startDateTime: e.target.value }))}
              />
              <input
                type="datetime-local"
                className="rounded border px-2 py-1.5 w-full"
                value={form.endDateTime}
                onChange={(e) => setForm((f) => ({ ...f, endDateTime: e.target.value }))}
              />
              <select
                className="rounded border px-2 py-1.5 w-full"
                value={form.vehicleId}
                onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}
              >
                <option value="">
                  {available.length === 0 && form.startDateTime && form.endDateTime
                    ? "Nenhum veículo disponível (conflito ou indisponível)"
                    : "Veículo disponível *"}
                </option>
                {available.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate ?? "—"} · {v.brand} {v.model}
                  </option>
                ))}
              </select>
              <select
                className="rounded border px-2 py-1.5 w-full"
                value={form.driverId}
                onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
              >
                <option value="">Motorista autorizado *</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.cnhStatus === "EXPIRED" ? " (CNH vencida)" : ""}
                  </option>
                ))}
              </select>
              <input
                placeholder="Destino"
                className="rounded border px-2 py-1.5 w-full"
                value={form.destination}
                onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              />
              <input
                placeholder="Motivo / finalidade"
                className="rounded border px-2 py-1.5 w-full"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !form.vehicleId || !form.driverId}
                onClick={() => void createReservation()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {saving ? "Criando…" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold">
              {reasonModal.action === "reject" ? "Rejeitar reserva" : "Cancelar reserva"}
            </h3>
            <textarea
              className="mt-3 w-full rounded border px-2 py-1.5 text-sm"
              rows={3}
              placeholder="Motivo *"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReasonModal(null);
                  setReasonText("");
                }}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={saving || !reasonText.trim()}
                onClick={() => {
                  void patchAction(reasonModal.id, reasonModal.action, {
                    reason: reasonText.trim(),
                  }).then(() => {
                    setReasonModal(null);
                    setReasonText("");
                  });
                }}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {mobileFlowId && (
        <div className="fixed inset-0 z-[60] bg-white">
          <FleetMobileUsageFlow
            initialReservationId={mobileFlowId}
            fullscreen
            onExit={() => {
              setMobileFlowId(null);
              void loadReservations();
            }}
          />
        </div>
      )}

      {checkoutModal && (
        <FleetCheckoutCheckinModal
          mode="checkout"
          reservation={checkoutModal}
          onClose={() => setCheckoutModal(null)}
          onDone={() => void loadReservations()}
        />
      )}

      {checkinModal && (
        <FleetCheckoutCheckinModal
          mode="checkin"
          reservation={checkinModal}
          onClose={() => setCheckinModal(null)}
          onDone={() => void loadReservations()}
        />
      )}

      {replaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h3 className="font-semibold">Substituir veículo</h3>
            <input
              className="mt-3 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="ID do novo veículo (UUID)"
              value={replaceVehicleId}
              onChange={(e) => setReplaceVehicleId(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Informe o UUID do veículo substituto (disponível no cadastro de veículos).
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReplaceModal(null)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !replaceVehicleId.trim()}
                onClick={() => {
                  void patchAction(replaceModal, "replace-vehicle", {
                    vehicleId: replaceVehicleId.trim(),
                  }).then(() => setReplaceModal(null));
                }}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Substituir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
