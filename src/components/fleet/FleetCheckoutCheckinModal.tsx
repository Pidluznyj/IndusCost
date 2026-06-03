import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type {
  FleetChecklistItemRow,
  FleetChecklistRow,
  FleetReservationRow,
} from "@/src/types/fleet";
import { CHECKLIST_RESULT_OPTIONS } from "@/src/types/fleet";

type Mode = "checkout" | "checkin";

type Props = {
  mode: Mode;
  reservation: FleetReservationRow;
  onClose: () => void;
  onDone: () => void;
};

function dtLocalValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FleetCheckoutCheckinModal({ mode, reservation, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<FleetChecklistRow | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [usageCheckoutKm, setUsageCheckoutKm] = useState<number | null>(null);

  const [at, setAt] = useState(dtLocalValue(new Date().toISOString()));
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState("");
  const [notes, setNotes] = useState("");
  const [hasPending, setHasPending] = useState(false);
  const [resultInfo, setResultInfo] = useState<string | null>(null);

  const checklistRequired = useMemo(() => {
    if (mode === "checkout") return settings.checklistRetiradaObrigatorio === "true";
    return settings.checklistDevolucaoObrigatorio === "true";
  }, [mode, settings]);

  const vehicleKm = reservation.vehicle?.currentKm ?? 0;

  const kmDrivenPreview = useMemo(() => {
    if (mode !== "checkin" || usageCheckoutKm == null) return null;
    const checkin = Number(km);
    if (!Number.isFinite(checkin) || checkin < usageCheckoutKm) return null;
    return checkin - usageCheckoutKm;
  }, [mode, km, usageCheckoutKm]);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes] = await Promise.all([
        fetchJsonOk<{ settings: { key: string; value: string }[] }>("/api/fleet/settings"),
      ]);
      const map: Record<string, string> = {};
      for (const s of settingsRes.settings) map[s.key] = s.value;
      setSettings(map);

      if (mode === "checkin") {
        try {
          const usageRes = await fetchJsonOk<{ usage: { checkoutKm: number | null } }>(
            `/api/fleet/reservations/${reservation.id}/usage`
          );
          setUsageCheckoutKm(usageRes.usage.checkoutKm);
          if (usageRes.usage.checkoutKm != null) {
            setKm(String(usageRes.usage.checkoutKm));
          }
        } catch {
          setUsageCheckoutKm(null);
        }
      } else if (vehicleKm) {
        setKm(String(vehicleKm));
      }

      const type = mode === "checkout" ? "CHECKOUT" : "CHECKIN";
      const list = await fetchJsonOk<{ checklists: FleetChecklistRow[] }>(
        `/api/fleet/checklists?reservationId=${reservation.id}&checklistType=${type}`
      );
      const draft = list.checklists.find((c) => c.status === "DRAFT");
      if (draft) {
        setChecklist(draft);
      } else if (checklistRequired || list.checklists.length === 0) {
        const created = await fetchJsonOk<{ checklist: FleetChecklistRow }>("/api/fleet/checklists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: reservation.vehicleId,
            reservationId: reservation.id,
            checklistType: type,
            useDefaultTemplate: true,
          }),
        });
        setChecklist(created.checklist);
      } else {
        setChecklist(list.checklists[0] ?? null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [mode, reservation.id, reservation.vehicleId, checklistRequired, vehicleKm]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const updateItem = async (item: FleetChecklistItemRow, result: string) => {
    if (!checklist) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/checklist-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      setChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.id === item.id ? { ...i, result: result as FleetChecklistItemRow["result"] } : i
              ),
            }
          : prev
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar item.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    setResultInfo(null);
    try {
      let checklistId: string | undefined;
      if (checklist) {
        if (checklist.status !== "COMPLETED") {
          const completed = await fetchJsonOk<{ checklist: FleetChecklistRow }>(
            `/api/fleet/checklists/${checklist.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ complete: true }),
            }
          );
          if (completed.checklist.status !== "COMPLETED") {
            throw new Error("Conclua o checklist antes de continuar.");
          }
          checklistId = completed.checklist.id;
        } else {
          checklistId = checklist.id;
        }
      }
      const path =
        mode === "checkout"
          ? `/api/fleet/reservations/${reservation.id}/checkout`
          : `/api/fleet/reservations/${reservation.id}/checkin`;

      const body =
        mode === "checkout"
          ? {
              checkoutAt: at ? new Date(at).toISOString() : undefined,
              checkoutKm: Number(km),
              checkoutFuelLevel: fuel || null,
              checkoutNotes: notes || null,
              checklistId,
            }
          : {
              checkinAt: at ? new Date(at).toISOString() : undefined,
              checkinKm: Number(km),
              checkinFuelLevel: fuel || null,
              checkinNotes: notes || null,
              hasPending,
              checklistId,
            };

      const res = await fetchJsonOk<{
        kmDriven?: number;
        hasPending?: boolean;
        criticalBlocked?: boolean;
        maintenanceId?: string | null;
      }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (mode === "checkin" && res.criticalBlocked) {
        setResultInfo("Devolução registrada. Veículo bloqueado por item crítico não conforme.");
      } else if (mode === "checkin" && res.kmDriven != null) {
        setResultInfo(`Devolução registrada. Km rodados: ${res.kmDriven.toLocaleString("pt-BR")}`);
      }

      onDone();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao registrar operação.");
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "checkout" ? "Registrar retirada" : "Registrar devolução";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {reservation.vehicle?.plate ?? "—"} · {reservation.vehicle?.brand}{" "}
              {reservation.vehicle?.model}
              {reservation.driver?.name ? ` · ${reservation.driver.name}` : ""}
            </p>
            <p className="text-xs text-slate-500">
              Km atual do veículo: {vehicleKm.toLocaleString("pt-BR")}
              {usageCheckoutKm != null && mode === "checkin"
                ? ` · Km retirada: ${usageCheckoutKm.toLocaleString("pt-BR")}`
                : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <label className="block">
                <span className="text-slate-600">Data/hora real</span>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-slate-600">
                  {mode === "checkout" ? "Km inicial *" : "Km final *"}
                </span>
                <input
                  type="number"
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-slate-600">Combustível</span>
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  placeholder="Ex.: 3/4, Cheio"
                  value={fuel}
                  onChange={(e) => setFuel(e.target.value)}
                />
              </label>
              {mode === "checkin" && (
                <label className="flex items-end gap-2 pb-1">
                  <input
                    type="checkbox"
                    checked={hasPending}
                    onChange={(e) => setHasPending(e.target.checked)}
                  />
                  <span className="text-slate-600">Pendência manual na devolução</span>
                </label>
              )}
              <label className="block sm:col-span-2">
                <span className="text-slate-600">Observações</span>
                <textarea
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>

            {mode === "checkin" && kmDrivenPreview != null && (
              <p className="text-sm font-medium text-emerald-800">
                Km calculado: {kmDrivenPreview.toLocaleString("pt-BR")} km
              </p>
            )}

            {checklist && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">
                    Checklist de {mode === "checkout" ? "retirada" : "devolução"}
                    {checklistRequired && (
                      <span className="ml-1 text-xs font-normal text-amber-700">(obrigatório)</span>
                    )}
                  </h4>
                  <span
                    className={cn(
                      "text-xs rounded px-1.5 py-0.5",
                      checklist.status === "COMPLETED"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    )}
                  >
                    {checklist.status === "COMPLETED" ? "Concluído" : "Rascunho"}
                  </span>
                </div>
                <ul className="mt-2 space-y-2">
                  {checklist.items.map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        "flex flex-wrap items-center gap-2 text-sm border-b border-slate-100 pb-2",
                        item.isCritical && item.result === "NOT_OK" && "text-red-700"
                      )}
                    >
                      <span className="flex-1 min-w-[140px]">
                        {item.itemName}
                        {item.isCritical && (
                          <span className="ml-1 text-xs text-red-600">(crítico)</span>
                        )}
                      </span>
                      <select
                        className="rounded border px-2 py-1 text-xs"
                        value={item.result ?? ""}
                        disabled={saving}
                        onChange={(e) => void updateItem(item, e.target.value)}
                      >
                        <option value="">—</option>
                        {CHECKLIST_RESULT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loading || !km}
            onClick={() => void submit()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : mode === "checkout" ? "Confirmar retirada" : "Confirmar devolução"}
          </button>
        </div>
      </div>
    </div>
  );
}
