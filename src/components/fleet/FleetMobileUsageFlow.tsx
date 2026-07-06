import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Smartphone,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useFleetPermissions } from "@/src/components/fleet/fleetPermissions";
import {
  formatMobileChecklistBlockMessage,
  getMobileChecklistStepStatus,
  isChecklistItemAnswered,
  isFleetChecklistRequiredForMode,
  isMobileChecklistStepComplete,
  MOBILE_USAGE_STEP_LABELS,
  MOBILE_USAGE_STEPS,
  mobileCheckoutBlockedByCritical,
  resolveCheckinPendingOutcome,
  resolveMobileUsageMode,
  validateMobileKmInput,
  type MobileUsageMode,
  type MobileUsageStep,
} from "@/src/lib/fleetMobileUsage";
import type {
  FleetChecklistItemRow,
  FleetChecklistRow,
  FleetReservationRow,
} from "@/src/types/fleet";
import { CHECKLIST_RESULT_OPTIONS } from "@/src/types/fleet";
import { FleetLoading, formatFleetApiError } from "@/src/components/fleet/fleetUi";

type PhotoDraft = { fileName: string; fileUrl: string; notes: string };

type Props = {
  initialReservationId?: string | null;
  fullscreen?: boolean;
  onExit?: () => void;
};

function dtLocalValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

const STATUS_PICK: Record<string, string> = {
  APPROVED: "Aprovada — retirada",
  IN_USE: "Em uso — devolução",
};

export function FleetMobileUsageFlow({
  initialReservationId = null,
  fullscreen = false,
  onExit,
}: Props) {
  const { canCreateReservations: canOperate } = useFleetPermissions();

  const [pickList, setPickList] = useState<FleetReservationRow[]>([]);
  const [reservation, setReservation] = useState<FleetReservationRow | null>(null);
  const [mode, setMode] = useState<MobileUsageMode | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [usageCheckoutKm, setUsageCheckoutKm] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<FleetChecklistRow | null>(null);
  const [step, setStep] = useState<MobileUsageStep>("reservation");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const [at, setAt] = useState(dtLocalValue(new Date().toISOString()));
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState("");
  const [notes, setNotes] = useState("");
  const [hasDamage, setHasDamage] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [photoName, setPhotoName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const checklistRequired = useMemo(
    () => (mode ? isFleetChecklistRequiredForMode(settings, mode) : false),
    [mode, settings]
  );

  const checklistStatus = useMemo(() => {
    if (!checklist || !mode) return null;
    return getMobileChecklistStepStatus(checklist.items, {
      required: checklistRequired,
      mode,
    });
  }, [checklist, checklistRequired, mode]);

  const checklistBlockMessage = useMemo(
    () => (checklistStatus ? formatMobileChecklistBlockMessage(checklistStatus) : null),
    [checklistStatus]
  );

  const vehicleKm = reservation?.vehicle?.currentKm ?? 0;

  const kmValidation = useMemo(() => {
    if (!mode || !km.trim()) return null;
    return validateMobileKmInput({
      mode,
      kmRaw: km,
      vehicleCurrentKm: vehicleKm,
      checkoutKm: usageCheckoutKm,
    });
  }, [mode, km, vehicleKm, usageCheckoutKm]);

  const stepIndex = MOBILE_USAGE_STEPS.indexOf(step);

  const loadPickList = useCallback(async () => {
    const q = new URLSearchParams();
    const data = await fetchJsonOk<{ reservations: FleetReservationRow[] }>(
      `/api/fleet/reservations?${q}`
    );
    const eligible = data.reservations.filter((r) =>
      ["APPROVED", "IN_USE"].includes(r.status)
    );
    setPickList(eligible);
  }, []);

  const loadReservationContext = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setDoneMessage(null);
    try {
      const ctx = await fetchJsonOk<{
        reservation: FleetReservationRow;
        mode: MobileUsageMode | null;
        usage: { checkoutKm: number | null } | null;
        settings: Record<string, string>;
      }>(`/api/fleet/reservations/${id}/usage-context`);

      if (!ctx.mode) {
        throw new Error("Reserva não está apta para retirada ou devolução.");
      }

      setReservation(ctx.reservation);
      setMode(ctx.mode);
      setSettings(ctx.settings);
      setUsageCheckoutKm(ctx.usage?.checkoutKm ?? null);
      setStep("reservation");
      setAt(dtLocalValue(new Date().toISOString()));
      setFuel("");
      setNotes("");
      setHasDamage(false);
      setManualPending(false);
      setPhotos([]);

      if (ctx.mode === "checkin" && ctx.usage?.checkoutKm != null) {
        setKm("");
      } else {
        setKm(ctx.reservation.vehicle?.currentKm != null ? String(ctx.reservation.vehicle.currentKm) : "");
      }

      const type = ctx.mode === "checkout" ? "CHECKOUT" : "CHECKIN";
      const list = await fetchJsonOk<{ checklists: FleetChecklistRow[] }>(
        `/api/fleet/checklists?reservationId=${id}&checklistType=${type}`
      );
      const draft = list.checklists.find((c) => c.status === "DRAFT");
      if (draft) {
        setChecklist(draft);
      } else {
        const created = await fetchJsonOk<{ checklist: FleetChecklistRow }>("/api/fleet/checklists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: ctx.reservation.vehicleId,
            reservationId: id,
            checklistType: type,
            useDefaultTemplate: true,
          }),
        });
        setChecklist(created.checklist);
      }
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar reserva."));
      setReservation(null);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        if (initialReservationId) {
          await loadReservationContext(initialReservationId);
        } else {
          await loadPickList();
        }
      } finally {
        if (!initialReservationId) setLoading(false);
      }
    })();
  }, [initialReservationId, loadPickList, loadReservationContext]);

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
                i.id === item.id
                  ? { ...i, result: result as FleetChecklistItemRow["result"] }
                  : i
              ),
            }
          : prev
      );
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao atualizar checklist."));
    } finally {
      setSaving(false);
    }
  };

  const addPhoto = () => {
    const fileName = photoName.trim();
    const fileUrl = photoUrl.trim();
    if (!fileName || !fileUrl) {
      setError("Informe nome e URL do anexo.");
      return;
    }
    if (fileUrl.startsWith("data:")) {
      setError("Não use base64; informe URL do arquivo.");
      return;
    }
    setPhotos((p) => [...p, { fileName, fileUrl, notes: "" }]);
    setPhotoName("");
    setPhotoUrl("");
    setError(null);
  };

  const canGoNext = (): boolean => {
    if (!reservation || !mode) return false;
    if (step === "reservation") return true;
    if (step === "km") {
      return kmValidation?.valid === true;
    }
    if (step === "checklist") {
      if (!checklist) return !checklistRequired;
      return checklistStatus?.canAdvance ?? isMobileChecklistStepComplete(checklist.items, checklistRequired);
    }
    if (step === "photos") return true;
    return true;
  };

  const goNext = () => {
    if (step === "km" && kmValidation && !kmValidation.valid) {
      setError(kmValidation.error);
      return;
    }
    if (step === "checklist") {
      if (checklist && checklistBlockMessage) {
        setError(checklistBlockMessage);
        return;
      }
      if (checklist && !isMobileChecklistStepComplete(checklist.items, checklistRequired)) {
        setError("Preencha todos os itens do checklist.");
        return;
      }
    }
    setError(null);
    const idx = stepIndex + 1;
    if (idx < MOBILE_USAGE_STEPS.length) {
      setStep(MOBILE_USAGE_STEPS[idx]!);
    }
  };

  const goBack = () => {
    setError(null);
    const idx = stepIndex - 1;
    if (idx >= 0) setStep(MOBILE_USAGE_STEPS[idx]!);
  };

  const resetToPicker = () => {
    setReservation(null);
    setMode(null);
    setChecklist(null);
    setStep("reservation");
    void loadPickList();
    onExit?.();
  };

  const submit = async () => {
    if (!reservation || !mode || !kmValidation?.valid) return;
    setSaving(true);
    setError(null);
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
          checklistId = completed.checklist.id;
          setChecklist(completed.checklist);
        } else {
          checklistId = checklist.id;
        }
      }

      for (const photo of photos) {
        await fetchJsonOk("/api/fleet/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reservationId: reservation.id,
            vehicleId: reservation.vehicleId,
            attachmentType: mode === "checkout" ? "CHECKOUT_FOTO" : "CHECKIN_FOTO",
            fileName: photo.fileName,
            fileUrl: photo.fileUrl,
            notes: photo.notes || notes || null,
          }),
        });
      }

      const path =
        mode === "checkout"
          ? `/api/fleet/reservations/${reservation.id}/checkout`
          : `/api/fleet/reservations/${reservation.id}/checkin`;

      const pendingOutcome =
        mode === "checkin" && checklist
          ? resolveCheckinPendingOutcome({
              hasDamage,
              manualPending,
              checklistItems: checklist.items,
            })
          : null;

      const body =
        mode === "checkout"
          ? {
              checkoutAt: at ? new Date(at).toISOString() : undefined,
              checkoutKm: kmValidation.km,
              checkoutFuelLevel: fuel || null,
              checkoutNotes: notes || null,
              checklistId,
            }
          : {
              checkinAt: at ? new Date(at).toISOString() : undefined,
              checkinKm: kmValidation.km,
              checkinFuelLevel: fuel || null,
              checkinNotes: notes || null,
              hasPending: pendingOutcome?.hasPending ?? manualPending,
              checklistId,
            };

      const res = await fetchJsonOk<{
        kmDriven?: number;
        hasPending?: boolean;
        criticalBlocked?: boolean;
      }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (mode === "checkin") {
        const msg =
          pendingOutcome?.summary ??
          (res.kmDriven != null
            ? `Devolução registrada. Km rodados: ${res.kmDriven.toLocaleString("pt-BR")}.`
            : "Devolução registrada.");
        setDoneMessage(res.criticalBlocked ? `${msg} Veículo bloqueado por item crítico.` : msg);
      } else {
        setDoneMessage("Retirada registrada com sucesso.");
      }
      setStep("confirm");
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao finalizar operação."));
    } finally {
      setSaving(false);
    }
  };

  const pendingPreview =
    mode === "checkin" && checklist
      ? resolveCheckinPendingOutcome({
          hasDamage,
          manualPending,
          checklistItems: checklist.items,
        })
      : null;

  const shellClass = cn(
    "flex flex-col",
    fullscreen ? "min-h-[calc(100dvh-8rem)]" : "min-h-[70vh] rounded-xl border border-slate-200 bg-slate-50"
  );

  if (!canOperate) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Permissão <code className="text-xs">fleet.reservations.create</code> ou{" "}
        <code className="text-xs">fleet.manage</code> necessária para retirada/devolução em campo.
      </p>
    );
  }

  if (loading) {
    return <FleetLoading label="Preparando fluxo em campo…" />;
  }

  if (!reservation) {
    return (
      <div className={shellClass}>
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <Smartphone className="h-5 w-5 text-slate-700" />
          <div>
            <h3 className="font-semibold text-slate-900">Uso em campo</h3>
            <p className="text-xs text-slate-500">Retirada e devolução — otimizado para celular</p>
          </div>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {pickList.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">
              Nenhuma reserva aprovada ou em uso no momento.
            </p>
          ) : (
            pickList.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-slate-50 touch-manipulation"
                onClick={() => void loadReservationContext(r.id)}
              >
                <p className="font-semibold text-slate-900">
                  {r.vehicle?.plate ?? "—"} · {r.vehicle?.brand} {r.vehicle?.model}
                </p>
                <p className="mt-1 text-sm text-slate-600">{STATUS_PICK[r.status] ?? r.status}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDt(r.startDateTime)} → {formatDt(r.endDateTime)}
                </p>
                {r.driver?.name && (
                  <p className="mt-1 text-xs text-slate-500">Motorista: {r.driver.name}</p>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-3 safe-area-inset">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 p-2 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={resetToPicker}
            aria-label="Voltar à lista"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {mode === "checkout" ? "Retirada" : "Devolução"} · passo {stepIndex + 1}/5
            </p>
            <p className="text-sm font-semibold text-slate-900">{MOBILE_USAGE_STEP_LABELS[step]}</p>
          </div>
          <div className="w-11" />
        </div>
        <div className="mt-2 flex gap-1">
          {MOBILE_USAGE_STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= stepIndex ? "bg-slate-900" : "bg-slate-200"
              )}
            />
          ))}
        </div>
      </header>

      {error && (
        <div className="px-3 pt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      <main
        className={cn(
          "flex-1 overflow-y-auto px-3 py-4",
          step === "checklist" && "pb-36"
        )}
      >
        {step === "reservation" && (
          <section className="space-y-3">
            <div className="rounded-xl bg-white p-4 shadow-sm border border-slate-200">
              <p className="text-lg font-semibold text-slate-900">
                {reservation.vehicle?.plate ?? "—"}
              </p>
              <p className="text-slate-700">
                {reservation.vehicle?.brand} {reservation.vehicle?.model}
              </p>
              {reservation.driver?.name && (
                <p className="mt-2 text-sm text-slate-600">Motorista: {reservation.driver.name}</p>
              )}
              <p className="mt-2 text-sm text-slate-500">
                {formatDt(reservation.startDateTime)} — {formatDt(reservation.endDateTime)}
              </p>
              {reservation.destination && (
                <p className="mt-1 text-sm text-slate-600">Destino: {reservation.destination}</p>
              )}
              <p className="mt-2 text-sm">
                Km atual:{" "}
                <strong>{vehicleKm.toLocaleString("pt-BR")} km</strong>
              </p>
            </div>
            <p className="text-sm text-slate-600">
              Confira os dados e avance para registrar km, checklist e fotos.
            </p>
          </section>
        )}

        {step === "km" && (
          <section className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Data/hora real</span>
              <input
                type="datetime-local"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base touch-manipulation"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {mode === "checkout" ? "Km inicial *" : "Km final *"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg touch-manipulation"
                value={km}
                onChange={(e) => setKm(e.target.value)}
              />
              {kmValidation && !kmValidation.valid && km.trim() && (
                <p className="mt-1 text-sm text-red-700">{kmValidation.error}</p>
              )}
              {kmValidation?.valid && kmValidation.kmDrivenPreview != null && (
                <p className="mt-1 text-sm text-emerald-800 font-medium">
                  Km rodados: {kmValidation.kmDrivenPreview.toLocaleString("pt-BR")} km
                </p>
              )}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Combustível</span>
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base touch-manipulation"
                placeholder="Ex.: 3/4, Cheio"
                value={fuel}
                onChange={(e) => setFuel(e.target.value)}
              />
            </label>
          </section>
        )}

        {step === "checklist" && checklist && (
          <section className="space-y-3">
            {checklistRequired && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Checklist obrigatório (configuração da frota).
              </p>
            )}
            {checklistStatus && checklistStatus.totalCount > 0 && (
              <p
                className={cn(
                  "text-sm font-medium rounded-lg px-3 py-2 border",
                  checklistStatus.canAdvance
                    ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                    : "text-amber-900 bg-amber-50 border-amber-200"
                )}
              >
                {checklistStatus.answeredCount}/{checklistStatus.totalCount} itens respondidos
              </p>
            )}
            <ul className="space-y-3">
              {checklist.items.map((item) => {
                const answered = isChecklistItemAnswered(item.result);
                return (
                <li
                  key={item.id}
                  className={cn(
                    "rounded-xl border bg-white p-3",
                    !answered && "border-amber-400 ring-1 ring-amber-200",
                    answered && item.isCritical && item.result === "NOT_OK"
                      ? "border-red-300"
                      : answered
                        ? "border-slate-200"
                        : undefined
                  )}
                >
                  <p className="text-sm font-medium text-slate-900">
                    {item.itemName}
                    {item.isCritical && (
                      <span className="ml-1 text-xs text-red-600">(crítico)</span>
                    )}
                    {!answered && (
                      <span className="ml-1 text-xs text-amber-700">(pendente)</span>
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {CHECKLIST_RESULT_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        disabled={saving}
                        onClick={() => void updateItem(item, o.value)}
                        className={cn(
                          "min-h-[44px] flex-1 rounded-lg border px-2 py-2 text-sm font-medium touch-manipulation",
                          item.result === o.value
                            ? o.value === "NOT_OK"
                              ? "border-red-600 bg-red-600 text-white"
                              : o.value === "OK"
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-slate-700 bg-slate-700 text-white"
                            : "border-slate-200 bg-white text-slate-700"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
              })}
            </ul>
            {checklistBlockMessage && (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {checklistBlockMessage}
              </p>
            )}
            {mode === "checkout" && mobileCheckoutBlockedByCritical(checklist.items) && (
              <p className="text-sm text-red-700">
                Item crítico não conforme bloqueia a retirada até correção ou manutenção.
              </p>
            )}
          </section>
        )}

        {step === "checklist" && !checklist && (
          <p className="text-sm text-slate-500">Checklist não exigido — avance para fotos.</p>
        )}

        {step === "photos" && (
          <section className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Observações gerais</span>
              <textarea
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base min-h-[88px] touch-manipulation"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Avarias, pendências, observações…"
              />
            </label>
            {mode === "checkin" && (
              <>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 touch-manipulation min-h-[52px]">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={hasDamage}
                    onChange={(e) => setHasDamage(e.target.checked)}
                  />
                  <span className="text-sm font-medium text-slate-800">Há avarias visíveis</span>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 touch-manipulation min-h-[52px]">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={manualPending}
                    onChange={(e) => setManualPending(e.target.checked)}
                  />
                  <span className="text-sm font-medium text-slate-800">Pendência manual na devolução</span>
                </label>
              </>
            )}
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <Camera className="h-5 w-5" />
                <span className="text-sm font-medium">Fotos / anexos (URL)</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Envie o arquivo ao storage e cole a URL. Base64 não é aceito.
              </p>
              <input
                className="mt-3 w-full rounded-lg border px-3 py-3 text-sm touch-manipulation"
                placeholder="Nome do arquivo"
                value={photoName}
                onChange={(e) => setPhotoName(e.target.value)}
              />
              <input
                className="mt-2 w-full rounded-lg border px-3 py-3 text-sm touch-manipulation"
                placeholder="https://…"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
              />
              <button
                type="button"
                onClick={addPhoto}
                className="mt-3 w-full min-h-[44px] rounded-lg border border-slate-300 bg-slate-50 text-sm font-medium touch-manipulation"
              >
                Adicionar anexo
              </button>
            </div>
            {photos.length > 0 && (
              <ul className="space-y-2">
                {photos.map((p, i) => (
                  <li
                    key={`${p.fileUrl}-${i}`}
                    className="rounded-lg bg-white border px-3 py-2 text-sm flex justify-between gap-2"
                  >
                    <span className="truncate">{p.fileName}</span>
                    <button
                      type="button"
                      className="text-red-600 text-xs shrink-0"
                      onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {step === "confirm" && (
          <section className="space-y-4">
            {doneMessage ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex gap-2">
                <Check className="h-6 w-6 text-emerald-700 shrink-0" />
                <p className="text-sm text-emerald-900">{doneMessage}</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-white border p-4 space-y-2 text-sm">
                  <p>
                    <span className="text-slate-500">Veículo:</span>{" "}
                    {reservation.vehicle?.plate} — {reservation.vehicle?.brand}{" "}
                    {reservation.vehicle?.model}
                  </p>
                  <p>
                    <span className="text-slate-500">Km:</span> {kmValidation?.valid ? kmValidation.km.toLocaleString("pt-BR") : km}
                  </p>
                  <p>
                    <span className="text-slate-500">Combustível:</span> {fuel || "—"}
                  </p>
                  <p>
                    <span className="text-slate-500">Anexos:</span> {photos.length}
                  </p>
                  {pendingPreview && (
                    <p
                      className={cn(
                        "font-medium",
                        pendingPreview.hasPending ? "text-amber-800" : "text-emerald-800"
                      )}
                    >
                      {pendingPreview.summary}
                    </p>
                  )}
                </div>
                {mode === "checkout" && checklist && mobileCheckoutBlockedByCritical(checklist.items) && (
                  <p className="text-sm text-red-700">
                    Não é possível confirmar: item crítico não conforme no checklist.
                  </p>
                )}
              </>
            )}
          </section>
        )}
      </main>

      <footer className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2 shrink-0">
        {step === "checklist" && checklistStatus && checklistStatus.totalCount > 0 && (
          <div className="text-xs text-slate-600">
            <p className="font-medium">
              {checklistStatus.answeredCount}/{checklistStatus.totalCount} itens respondidos
            </p>
            {checklistBlockMessage && (
              <p className="mt-0.5 text-amber-800">{checklistBlockMessage}</p>
            )}
          </div>
        )}
        <div className="flex gap-2">
        {step !== "reservation" && !doneMessage && (
          <button
            type="button"
            onClick={goBack}
            disabled={saving}
            className="min-h-[48px] flex-1 rounded-xl border border-slate-300 text-sm font-semibold touch-manipulation"
          >
            Voltar
          </button>
        )}
        {step !== "confirm" && (
          <button
            type="button"
            onClick={goNext}
            disabled={saving || !canGoNext()}
            className="min-h-[48px] flex-[2] inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-50 touch-manipulation"
          >
            Próximo
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {step === "confirm" && !doneMessage && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              saving ||
              !kmValidation?.valid ||
              (mode === "checkout" &&
                checklist != null &&
                mobileCheckoutBlockedByCritical(checklist.items))
            }
            className="min-h-[48px] flex-[2] rounded-xl bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 touch-manipulation"
          >
            {saving ? "Salvando…" : mode === "checkout" ? "Confirmar retirada" : "Confirmar devolução"}
          </button>
        )}
        {doneMessage && (
          <button
            type="button"
            onClick={resetToPicker}
            className="min-h-[48px] flex-1 rounded-xl bg-slate-900 text-white text-sm font-semibold touch-manipulation"
          >
            Nova operação
          </button>
        )}
        </div>
      </footer>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}
