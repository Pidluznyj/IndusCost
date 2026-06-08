import React, { useCallback, useEffect, useState } from "react";
import { Check, Eye, Loader2, RefreshCw, X } from "lucide-react";
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
    cnhNumber: string | null;
    cnhCategory: string | null;
    cnhExpirationDate: string | null;
    status: string;
  } | null;
  vehicle: { id: string; brand: string; model: string; plate: string | null } | null;
  fleetReservation: { id: string; status: string } | null;
};

type VehicleOption = { id: string; brand: string; model: string; plate: string | null };

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
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
  if (exp.getTime() < Date.now()) return "CNH vencida";
  return "CNH válida";
}

export function FleetPublicReservationRequestsTab() {
  const { canApproveReservations, canView } = useFleetPermissions();
  const [items, setItems] = useState<PublicRequestRow[]>([]);
  const [meta, setMeta] = useState<FleetPaginatedMeta>({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [filterStatus, setFilterStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicRequestRow | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<FleetDriverRow[]>([]);
  const [approveVehicleId, setApproveVehicleId] = useState("");
  const [approveDriverId, setApproveDriverId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="PENDING">Pendentes</option>
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
                    {row.vehicle
                      ? `${row.vehicle.brand} ${row.vehicle.model}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABEL[row.status] ?? row.status}</td>
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
              </p>
              {detail.requesterEmail && <p>E-mail: {detail.requesterEmail}</p>}
              {detail.requesterPhone && <p>Telefone: {detail.requesterPhone}</p>}
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

            {detail.status === "PENDING" && canApproveReservations && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
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
                  </select>
                </label>
                <button
                  type="button"
                  disabled={actionLoading || !approveVehicleId || !approveDriverId}
                  onClick={() => void approve()}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-700 py-2.5 text-sm text-white disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  Aprovar e criar reserva
                </button>
                <label className="block text-sm">
                  <span className="font-medium">Motivo da rejeição *</span>
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
                  Rejeitar
                </button>
              </div>
            )}

            {!canApproveReservations && detail.status === "PENDING" && (
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
