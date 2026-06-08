import React, { useCallback, useEffect, useState } from "react";
import { Check, Eye, Loader2, RefreshCw, UserCheck, UserX, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useFleetPermissions } from "@/src/components/fleet/fleetPermissions";
import {
  FleetListPagination,
  formatFleetApiError,
  type FleetPaginatedMeta,
} from "@/src/components/fleet/fleetUi";
import type { FleetDriverRow } from "@/src/types/fleet";
import { formatCpfMask } from "@/src/lib/fleetCpfUtils";

type PublicRequestRow = {
  id: string;
  publicCode: string;
  requesterCpf: string | null;
  driverId: string | null;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  requesterDepartment: string | null;
  requestedDate: string;
  startTime: string;
  endTime: string;
  reason: string;
  destination: string;
  notes: string | null;
  status: string;
  createdAt: string;
  driver: {
    id: string;
    name: string;
    cpf: string;
    phone?: string | null;
    email?: string | null;
    cnhNumber: string | null;
    cnhCategory: string | null;
    cnhExpirationDate: string | null;
    status: string;
    approvalStatus?: string;
    needsPublicApproval?: boolean;
    createdFromPublicReservation?: boolean;
  } | null;
  vehicle: { id: string; brand: string; model: string; plate: string | null } | null;
  fleetReservation: { id: string; status: string } | null;
};

type VehicleOption = { id: string; brand: string; model: string; plate: string | null };

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Aguardando aprovação da reserva",
  PENDING_DRIVER_APPROVAL: "Aguardando aprovação do motorista",
  PENDING_RESERVATION_APPROVAL: "Aguardando aprovação da reserva",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  CANCELLED: "Cancelada",
};

function formatDate(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("pt-BR");
}

function formatDt(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("pt-BR");
}

function cnhStatusLabel(row: PublicRequestRow): string {
  const d = row.driver;
  if (!d?.cnhNumber) return "CNH pendente";
  if (!d.cnhExpirationDate) return "CNH cadastrada";
  const exp = new Date(d.cnhExpirationDate);
  if (Number.isNaN(exp.getTime())) return "CNH cadastrada";
  if (exp.getTime() < Date.now()) return "CNH vencida";
  return "CNH válida";
}

function isAwaitingDriverApproval(status: string): boolean {
  return status === "PENDING_DRIVER_APPROVAL";
}

function isAwaitingReservationApproval(status: string): boolean {
  return status === "PENDING_RESERVATION_APPROVAL" || status === "PENDING";
}

export function FleetPublicReservationRequestsTab() {
  const { canApproveReservations, canView } = useFleetPermissions();
  const [items, setItems] = useState<PublicRequestRow[]>([]);
  const [meta, setMeta] = useState<FleetPaginatedMeta>({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [filterStatus, setFilterStatus] = useState("PENDING_DRIVER_APPROVAL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicRequestRow | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<FleetDriverRow[]>([]);
  const [approveVehicleId, setApproveVehicleId] = useState("");
  const [approveDriverId, setApproveDriverId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [driverRejectReason, setDriverRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(page), limit: "25" });
      if (filterStatus) q.set("status", filterStatus);
      const data = await fetchJsonOk<{
        items: PublicRequestRow[];
        total: number;
        page: number;
        limit: number;
      }>(`/api/fleet/public-reservation-requests?${q}`);
      setItems(data.items);
      setMeta({
        page: data.page,
        limit: data.limit,
        total: data.total,
        totalPages: Math.max(1, Math.ceil(data.total / data.limit)),
      });
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar solicitações."));
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    if (!canView) return;
    void load(1);
  }, [canView, load]);

  const openDetail = async (row: PublicRequestRow) => {
    setDetail(row);
    setApproveVehicleId(row.vehicle?.id ?? "");
    setApproveDriverId(row.driverId ?? row.driver?.id ?? "");
    setRejectReason("");
    setDriverRejectReason("");
    try {
      const [vRes, dRes] = await Promise.all([
        fetchJsonOk<{ items: VehicleOption[] }>("/api/fleet/vehicles?limit=200"),
        fetchJsonOk<{ items: FleetDriverRow[] }>("/api/fleet/drivers?limit=200&status=AUTHORIZED"),
      ]);
      setVehicles(vRes.items ?? []);
      setDrivers(dRes.items ?? []);
    } catch {
      setVehicles([]);
      setDrivers([]);
    }
  };

  const approveDriver = async () => {
    if (!detail || !canApproveReservations) return;
    setActionLoading(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/public-reservation-requests/${detail.id}/approve-driver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setDetail(null);
      setFilterStatus("PENDING_RESERVATION_APPROVAL");
      await load(meta.page);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao aprovar motorista."));
    } finally {
      setActionLoading(false);
    }
  };

  const rejectDriver = async () => {
    if (!detail || !canApproveReservations) return;
    setActionLoading(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/public-reservation-requests/${detail.id}/reject-driver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: driverRejectReason }),
      });
      setDetail(null);
      await load(meta.page);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao rejeitar motorista."));
    } finally {
      setActionLoading(false);
    }
  };

  const approve = async () => {
    if (!detail || !canApproveReservations) return;
    setActionLoading(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/public-reservation-requests/${detail.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: approveVehicleId, driverId: approveDriverId }),
      });
      setDetail(null);
      await load(meta.page);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao aprovar."));
    } finally {
      setActionLoading(false);
    }
  };

  const reject = async () => {
    if (!detail || !canApproveReservations) return;
    setActionLoading(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/public-reservation-requests/${detail.id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      setDetail(null);
      await load(meta.page);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao rejeitar."));
    } finally {
      setActionLoading(false);
    }
  };

  if (!canView) {
    return <p className="text-sm text-slate-600">Sem permissão para visualizar solicitações.</p>;
  }

  const detailAwaitingDriver = detail ? isAwaitingDriverApproval(detail.status) : false;
  const detailAwaitingReservation = detail ? isAwaitingReservationApproval(detail.status) : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="PENDING_DRIVER_APPROVAL">Aguardando motorista</option>
          <option value="PENDING_RESERVATION_APPROVAL">Aguardando reserva</option>
          <option value="PENDING">Pendentes (legado)</option>
          <option value="APPROVED">Aprovadas</option>
          <option value="REJECTED">Rejeitadas</option>
        </select>
        <button
          type="button"
          onClick={() => void load(meta.page)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-600">Nenhuma solicitação encontrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Solicitante</th>
                <th className="px-3 py-2">CPF</th>
                <th className="px-3 py-2">CNH</th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Período</th>
                <th className="px-3 py-2">Veículo</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Criado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{row.publicCode}</td>
                  <td className="px-3 py-2">{row.requesterName}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.requesterCpf ? formatCpfMask(row.requesterCpf) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{cnhStatusLabel(row)}</td>
                  <td className="px-3 py-2">{formatDate(row.requestedDate)}</td>
                  <td className="px-3 py-2">
                    {row.startTime}–{row.endTime}
                  </td>
                  <td className="px-3 py-2">
                    {row.vehicle ? `${row.vehicle.brand} ${row.vehicle.model}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        isAwaitingDriverApproval(row.status)
                          ? "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                          : undefined
                      }
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatDt(row.createdAt)}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void openDetail(row)}
                      className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900"
                    >
                      <Eye className="h-4 w-4" />
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FleetListPagination meta={meta} onPageChange={(p) => void load(p)} />

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Solicitação {detail.publicCode}</h3>
            {isAwaitingDriverApproval(detail.status) && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                Aguardando aprovação do motorista
              </p>
            )}
            {isAwaitingReservationApproval(detail.status) && (
              <p className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900">
                Aguardando aprovação da reserva
              </p>
            )}
            <div className="text-sm space-y-2 text-slate-700">
              <p>
                <strong>Solicitante:</strong> {detail.requesterName}
              </p>
              {detail.requesterCpf && (
                <p>
                  <strong>CPF:</strong> {formatCpfMask(detail.requesterCpf)}
                </p>
              )}
              <p>
                <strong>CNH:</strong> {cnhStatusLabel(detail)}
                {detail.driver?.cnhCategory ? ` (${detail.driver.cnhCategory})` : ""}
                {detail.driver?.cnhNumber ? ` — nº ${detail.driver.cnhNumber}` : ""}
              </p>
              {detail.driver?.phone && <p>Telefone (cadastro): {detail.driver.phone}</p>}
              {detail.driver?.email && <p>E-mail (cadastro): {detail.driver.email}</p>}
              {detail.requesterEmail && <p>E-mail (solicitação): {detail.requesterEmail}</p>}
              {detail.requesterPhone && <p>Telefone (solicitação): {detail.requesterPhone}</p>}
              {detail.requesterDepartment && <p>Setor: {detail.requesterDepartment}</p>}
              <p>
                <strong>Data:</strong> {formatDate(detail.requestedDate)} — {detail.startTime}–
                {detail.endTime}
              </p>
              <p>
                <strong>Motivo:</strong> {detail.reason}
              </p>
              <p>
                <strong>Destino:</strong> {detail.destination}
              </p>
              {detail.notes && <p>Obs.: {detail.notes}</p>}
            </div>

            {detailAwaitingDriver && canApproveReservations && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <p className="text-sm font-medium text-slate-800">Etapa 1 — Cadastro do motorista</p>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => void approveDriver()}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-700 py-2.5 text-sm text-white disabled:opacity-50"
                >
                  <UserCheck className="h-4 w-4" />
                  Aprovar motorista
                </button>
                <label className="block text-sm">
                  <span className="font-medium">Motivo da rejeição do motorista *</span>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 min-h-[72px]"
                    value={driverRejectReason}
                    onChange={(e) => setDriverRejectReason(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={actionLoading || !driverRejectReason.trim()}
                  onClick={() => void rejectDriver()}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-red-300 py-2.5 text-sm text-red-800 disabled:opacity-50"
                >
                  <UserX className="h-4 w-4" />
                  Rejeitar motorista
                </button>
              </div>
            )}

            {detailAwaitingReservation && canApproveReservations && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <p className="text-sm font-medium text-slate-800">Etapa 2 — Reserva do veículo</p>
                <label className="block text-sm">
                  <span className="font-medium">Veículo *</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={approveVehicleId}
                    onChange={(e) => setApproveVehicleId(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.brand} {v.model}
                        {v.plate ? ` (${v.plate})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Motorista *</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={approveDriverId}
                    onChange={(e) => setApproveDriverId(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                    {detail.driver &&
                      !drivers.some((d) => d.id === detail.driver!.id) &&
                      detail.driverId && (
                        <option value={detail.driver.id}>{detail.driver.name} (solicitante)</option>
                      )}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={actionLoading || !approveVehicleId || !approveDriverId}
                  onClick={() => void approve()}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-700 py-2.5 text-sm text-white disabled:opacity-50"
                  title={
                    detailAwaitingDriver
                      ? "Aprove o cadastro do motorista antes de aprovar a reserva."
                      : undefined
                  }
                >
                  <Check className="h-4 w-4" />
                  Aprovar reserva
                </button>
                <label className="block text-sm">
                  <span className="font-medium">Motivo da rejeição da reserva *</span>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 min-h-[72px]"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={actionLoading || !rejectReason.trim()}
                  onClick={() => void reject()}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-red-300 py-2.5 text-sm text-red-800 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Rejeitar reserva
                </button>
              </div>
            )}

            {detailAwaitingDriver && canApproveReservations && (
              <p className="text-xs text-slate-500">
                A aprovação da reserva ficará disponível após validar o cadastro do motorista.
              </p>
            )}

            {!canApproveReservations &&
              (detailAwaitingDriver || detailAwaitingReservation) && (
                <p className="text-sm text-amber-700">Sem permissão para aprovar/rejeitar.</p>
              )}

            <button
              type="button"
              onClick={() => setDetail(null)}
              className="w-full rounded-lg border border-slate-300 py-2 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
