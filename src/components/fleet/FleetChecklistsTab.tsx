import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  FleetListPagination,
  formatFleetApiError,
  type FleetPaginatedMeta,
} from "@/src/components/fleet/fleetUi";

type PendingRow = {
  reservationId: string;
  status: string;
  startDateTime: string;
  endDateTime: string;
  destination: string | null;
  checklistLabel: string;
  vehicle: { id: string; plate: string | null; brand: string; model: string } | null;
  driver: { id: string; name: string } | null;
};

type ChecklistRow = {
  id: string;
  type: string;
  source: string;
  completedAt: string;
  odometer: number;
  fuelLevel: string | null;
  generalNotes: string | null;
  vehicle: { id: string; plate: string | null; brand: string; model: string } | null;
  driver: { id: string; name: string; cpf: string } | null;
  reservation: {
    id: string;
    status: string;
    destination: string | null;
    startDateTime: string;
    endDateTime: string;
  } | null;
  items: { code: string; label: string; status: string; notes: string | null }[];
};

const SUB_VIEWS = [
  { id: "pending", label: "Pendentes" },
  { id: "completed", label: "Realizados" },
  { id: "attention", label: "Atenções / avarias" },
] as const;

type SubView = (typeof SUB_VIEWS)[number]["id"];

const TYPE_LABEL: Record<string, string> = {
  CHECK_IN: "Check-in (retirada)",
  CHECK_OUT: "Check-out (devolução)",
  AUTO_CHECK_OUT: "Check-out automático",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  OK: "OK",
  ATENCAO: "Atenção",
  AVARIA: "Avaria",
  NAO_SE_APLICA: "Não se aplica",
};

function formatDt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function vehicleLabel(v: PendingRow["vehicle"]) {
  if (!v) return "Veículo não definido";
  const plate = v.plate?.trim() || "Sem placa";
  return `${plate} — ${v.brand} ${v.model}`;
}

export function FleetChecklistsTab() {
  const [subView, setSubView] = useState<SubView>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [checklists, setChecklists] = useState<ChecklistRow[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<FleetPaginatedMeta | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChecklistRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (subView === "pending") {
        const data = await fetchJsonOk<{ reservations: PendingRow[] }>(
          "/api/fleet/checklist-pending-reservations?limit=50"
        );
        setPending(data.reservations ?? []);
        setChecklists([]);
        setPagination(null);
      } else {
        const attentionOnly = subView === "attention";
        const data = await fetchJsonOk<{
          checklists: ChecklistRow[];
          pagination: FleetPaginatedMeta;
        }>(
          `/api/fleet/reservation-checklists?page=${page}&limit=30&attentionOnly=${attentionOnly}`
        );
        setChecklists(data.checklists ?? []);
        setPagination(data.pagination ?? null);
        setPending([]);
      }
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar checklists."));
    } finally {
      setLoading(false);
    }
  }, [subView, page]);

  useEffect(() => {
    setPage(1);
  }, [subView]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    try {
      const data = await fetchJsonOk<{ checklist: ChecklistRow }>(
        `/api/fleet/reservation-checklists/${encodeURIComponent(id)}`
      );
      setDetail(data.checklist);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar detalhe."));
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <p className="font-medium">Checklist por QR do veículo</p>
        <p className="mt-1 text-indigo-800/90">
          O motorista escaneia o QR fixo do veículo, informa o CPF e preenche o checklist na retirada
          e na devolução. Acompanhe aqui o que está pendente e o histórico de cada reserva.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SUB_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setSubView(v.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              subView === v.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            )}
          >
            {v.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
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
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : subView === "pending" ? (
        pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <p className="mt-3 font-medium text-slate-800">Nenhum checklist pendente</p>
            <p className="mt-1 text-sm text-slate-500">
              Reservas aprovadas ou em uso já têm check-in e check-out em dia.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <li
                key={r.reservationId}
                className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{vehicleLabel(r.vehicle)}</p>
                    <p className="text-sm text-slate-600">
                      {r.driver?.name ?? "Motorista não definido"} · {formatDt(r.startDateTime)} —{" "}
                      {formatDt(r.endDateTime)}
                    </p>
                    {r.destination && (
                      <p className="text-xs text-slate-500 mt-0.5">Destino: {r.destination}</p>
                    )}
                  </div>
                  <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                    {r.checklistLabel}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : checklists.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-medium text-slate-800">
            {subView === "attention" ? "Nenhuma atenção ou avaria registrada" : "Nenhum checklist realizado"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Os checklists preenchidos pelo QR do veículo aparecerão aqui.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {checklists.map((c) => {
              const attentionCount = c.items.filter((i) =>
                ["ATENCAO", "AVARIA"].includes(i.status)
              ).length;
              return (
                <li
                  key={c.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {TYPE_LABEL[c.type] ?? c.type} · {vehicleLabel(c.vehicle)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {c.driver?.name ?? "—"} · {formatDt(c.completedAt)}
                    </p>
                    {attentionCount > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        {attentionCount} item(ns) com atenção ou avaria
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void openDetail(c.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-4 w-4" />
                    Ver detalhes
                  </button>
                </li>
              );
            })}
          </ul>
          {pagination && (
            <FleetListPagination meta={pagination} loading={loading} onPageChange={setPage} />
          )}
        </>
      )}

      {detailId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-white">
              <h3 className="font-semibold text-slate-900">Detalhe do checklist</h3>
              <button
                type="button"
                onClick={() => {
                  setDetailId(null);
                  setDetail(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-800"
              >
                Fechar
              </button>
            </div>
            {detailLoading || !detail ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="px-4 py-4 space-y-3 text-sm">
                <p>
                  <span className="text-slate-500">Tipo:</span>{" "}
                  {TYPE_LABEL[detail.type] ?? detail.type}
                </p>
                <p>
                  <span className="text-slate-500">Veículo:</span> {vehicleLabel(detail.vehicle)}
                </p>
                <p>
                  <span className="text-slate-500">Motorista:</span> {detail.driver?.name ?? "—"}
                </p>
                <p>
                  <span className="text-slate-500">Odômetro:</span>{" "}
                  {Number.isFinite(detail.odometer) ? `${detail.odometer} km` : "—"}
                </p>
                <p>
                  <span className="text-slate-500">Combustível:</span> {detail.fuelLevel ?? "—"}
                </p>
                {detail.generalNotes && (
                  <p>
                    <span className="text-slate-500">Observações:</span> {detail.generalNotes}
                  </p>
                )}
                <div>
                  <p className="font-medium text-slate-700 mb-2">Itens</p>
                  <ul className="space-y-1">
                    {detail.items.map((i) => (
                      <li
                        key={i.code}
                        className={cn(
                          "rounded-lg px-2 py-1",
                          i.status === "AVARIA"
                            ? "bg-red-50 text-red-800"
                            : i.status === "ATENCAO"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-slate-50 text-slate-700"
                        )}
                      >
                        {i.label}: {ITEM_STATUS_LABEL[i.status] ?? i.status}
                        {i.notes ? ` — ${i.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
