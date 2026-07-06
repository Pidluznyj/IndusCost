import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ChevronLeft, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { formatCpfMask } from "@/src/lib/fleetCpfUtils";

type TemplateItem = { code: string; label: string };
type ItemStatus = "OK" | "ATENCAO" | "AVARIA" | "NAO_SE_APLICA";

type Config = {
  vehicle: { label: string; plate: string | null };
  template: TemplateItem[];
  itemStatuses: ItemStatus[];
  responsibilityText: string;
  fuelLevelHint: string;
};

type ResolvedReservation = {
  reservationId: string;
  mode: "CHECK_IN" | "CHECK_OUT";
  startDateTime: string;
  endDateTime: string;
  destination: string | null;
  driverName: string;
};

type Step = "cpf" | "select" | "form" | "success";

const STATUS_LABELS: Record<ItemStatus, string> = {
  OK: "OK",
  ATENCAO: "Atenção",
  AVARIA: "Avaria",
  NAO_SE_APLICA: "N/A",
};

const FUEL_OPTIONS = ["Cheio", "3/4", "1/2", "1/4", "Reserva"];

function formatDt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

export function FleetPublicVehicleChecklistPage() {
  const { vehicleToken } = useParams<{ vehicleToken: string }>();
  const [step, setStep] = useState<Step>("cpf");
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const [cpf, setCpf] = useState("");
  const [driverName, setDriverName] = useState("");
  const [reservations, setReservations] = useState<ResolvedReservation[]>([]);
  const [selectedReservation, setSelectedReservation] = useState<ResolvedReservation | null>(
    null
  );

  const [odometer, setOdometer] = useState("");
  const [fuelLevel, setFuelLevel] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [responsibilityAccepted, setResponsibilityAccepted] = useState(false);
  const [itemStates, setItemStates] = useState<
    Record<string, { status: ItemStatus; notes: string }>
  >({});

  useEffect(() => {
    if (!vehicleToken) {
      setError("Link inválido.");
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJsonOk<Config>(
          `/api/public/fleet/vehicle-checklist/${encodeURIComponent(vehicleToken)}`
        );
        setConfig(data);
        const init: Record<string, { status: ItemStatus; notes: string }> = {};
        for (const t of data.template) {
          init[t.code] = { status: "OK", notes: "" };
        }
        setItemStates(init);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "QR Code indisponível.");
      } finally {
        setLoading(false);
      }
    })();
  }, [vehicleToken]);

  const modeLabel = useMemo(() => {
    if (!selectedReservation) return "";
    return selectedReservation.mode === "CHECK_IN" ? "Check-in (retirada)" : "Check-out (devolução)";
  }, [selectedReservation]);

  const submitIdentify = async () => {
    if (!vehicleToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJsonOk<{
        found: boolean;
        driver?: { name: string };
        reservations: ResolvedReservation[];
        requiresSelection: boolean;
        message?: string | null;
      }>(
        `/api/public/fleet/vehicle-checklist/${encodeURIComponent(vehicleToken)}/identify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cpf }),
        }
      );
      if (!result.found) {
        setError(result.message ?? "CPF não encontrado.");
        return;
      }
      setDriverName(result.driver?.name ?? "");
      setReservations(result.reservations);
      if (result.reservations.length === 0) {
        setError(result.message ?? "Nenhuma reserva compatível no momento.");
        return;
      }
      if (result.reservations.length === 1) {
        setSelectedReservation(result.reservations[0]!);
        setStep("form");
      } else {
        setStep("select");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao identificar CPF.");
    } finally {
      setBusy(false);
    }
  };

  const submitChecklist = async () => {
    if (!vehicleToken || !selectedReservation) return;
    setBusy(true);
    setError(null);
    try {
      const items = (config?.template ?? []).map((t) => ({
        code: t.code,
        status: itemStates[t.code]?.status ?? "OK",
        notes: itemStates[t.code]?.notes?.trim() || null,
      }));
      const res = await fetchJsonOk<{ successMessage: string; mode: string }>(
        `/api/public/fleet/vehicle-checklist/${encodeURIComponent(vehicleToken)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cpf,
            reservationId: selectedReservation.reservationId,
            odometer: Number(odometer.replace(",", ".")),
            fuelLevel,
            generalNotes: generalNotes.trim() || null,
            responsibilityAccepted,
            items,
          }),
        }
      );
      setSuccessMessage(res.successMessage);
      setStep("success");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao enviar checklist.");
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (code: string, patch: Partial<{ status: ItemStatus; notes: string }>) => {
    setItemStates((prev) => ({
      ...prev,
      [code]: { ...prev[code]!, ...patch },
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!config && error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white pb-24">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Checklist do veículo</h1>
        {config && (
          <p className="text-sm text-slate-600 mt-0.5">
            {config.vehicle.label}
            {config.vehicle.plate ? ` · ${config.vehicle.plate}` : ""}
          </p>
        )}
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 space-y-4">
        {error && step !== "success" && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === "cpf" && (
          <section className="space-y-4">
            <p className="text-sm text-slate-600">
              Informe seu CPF para localizar sua reserva neste veículo.
            </p>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">CPF *</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-4 text-lg tracking-wide"
                value={cpf}
                onChange={(e) => setCpf(formatCpfMask(e.target.value))}
              />
            </label>
            <button
              type="button"
              disabled={busy || cpf.replace(/\D/g, "").length < 11}
              onClick={() => void submitIdentify()}
              className="w-full rounded-2xl bg-slate-900 py-4 text-base font-semibold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Continuar"}
            </button>
          </section>
        )}

        {step === "select" && (
          <section className="space-y-3">
            <p className="text-sm text-slate-600">
              Encontramos mais de uma reserva. Selecione a correta:
            </p>
            {reservations.map((r) => (
              <button
                key={r.reservationId}
                type="button"
                onClick={() => {
                  setSelectedReservation(r);
                  setStep("form");
                  setError(null);
                }}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400"
              >
                <p className="font-semibold text-slate-900">
                  {r.mode === "CHECK_IN" ? "Check-in" : "Check-out"}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  {formatDt(r.startDateTime)} — {formatDt(r.endDateTime)}
                </p>
                {r.destination && (
                  <p className="text-xs text-slate-500 mt-1">Destino: {r.destination}</p>
                )}
              </button>
            ))}
          </section>
        )}

        {step === "form" && selectedReservation && config && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm space-y-1">
              <p className="font-semibold text-emerald-900">{modeLabel}</p>
              <p className="text-emerald-800">{driverName}</p>
              <p className="text-emerald-800">
                {formatDt(selectedReservation.startDateTime)} —{" "}
                {formatDt(selectedReservation.endDateTime)}
              </p>
            </div>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                Odômetro ({selectedReservation.mode === "CHECK_IN" ? "inicial" : "final"}) *
              </span>
              <input
                type="number"
                inputMode="decimal"
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                Combustível ({selectedReservation.mode === "CHECK_IN" ? "inicial" : "final"}) *
              </span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
                value={fuelLevel}
                onChange={(e) => setFuelLevel(e.target.value)}
              >
                <option value="">Selecione…</option>
                {FUEL_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">{config.fuelLevelHint}</span>
            </label>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Itens do veículo *</p>
              {config.template.map((item) => {
                const st = itemStates[item.code];
                return (
                  <div key={item.code} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {config.itemStatuses.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateItem(item.code, { status: s })}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-xs",
                            st?.status === s
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200"
                          )}
                        >
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                    {(st?.status === "ATENCAO" || st?.status === "AVARIA") && (
                      <textarea
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-[60px]"
                        placeholder="Descreva a observação *"
                        value={st.notes}
                        onChange={(e) => updateItem(item.code, { notes: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Observação geral</span>
              <textarea
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base min-h-[72px]"
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
              />
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={responsibilityAccepted}
                onChange={(e) => setResponsibilityAccepted(e.target.checked)}
              />
              <span className="text-slate-700">{config.responsibilityText}</span>
            </label>
          </section>
        )}

        {step === "success" && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold text-emerald-900">Checklist enviado</h2>
            <p className="text-emerald-800">{successMessage}</p>
          </section>
        )}
      </main>

      {step === "select" && (
        <footer className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setStep("cpf");
              setError(null);
            }}
            className="mx-auto flex max-w-lg w-full items-center justify-center gap-1 rounded-xl border border-slate-300 py-3 text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </button>
        </footer>
      )}

      {step === "form" && (
        <footer className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-lg gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep(reservations.length > 1 ? "select" : "cpf");
              }}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 py-3 text-sm"
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </button>
            <button
              type="button"
              disabled={busy || !responsibilityAccepted || !odometer || !fuelLevel}
              onClick={() => void submitChecklist()}
              className="inline-flex flex-[2] items-center justify-center rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar checklist"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
