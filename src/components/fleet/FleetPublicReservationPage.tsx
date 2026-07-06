import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { formatCpfMask } from "@/src/lib/fleetCpfUtils";
import { FLEET_PUBLIC_RESERVATION_INITIAL_STEP } from "@/src/lib/fleetPublicReservationLink";
import {
  consolidateSelectedSlots,
  FLEET_PUBLIC_SLOT_SELECTION_GAP_MESSAGE,
  formatConsolidatedPeriodLabel,
  formatSelectedSlotsSummary,
  selectSlotsByKeys,
} from "@/src/lib/fleetPublicSlotSelection";

type PublicConfig = {
  title: string;
  instructions: string;
};

type IdentifyFound = {
  found: true;
  driverId: string;
  name: string;
  phone: string | null;
  email: string | null;
  department: string | null;
  hasDriverLicense: boolean;
  needsDriverLicense: boolean;
  cnhStatus: "cadastrada" | "pendente" | "vencida";
};

type IdentifyResult = IdentifyFound | { found: false; needsRegistration: true };

type PublicVehicle = {
  id: string;
  label: string;
  brand: string;
  model: string;
  vehicleType: string | null;
  category: string | null;
};

type PublicSlot = {
  start: string;
  end: string;
  label: string;
  key: string;
  available: boolean;
  status: "available" | "unavailable";
};

type DayAvailability = {
  date: string;
  weekdayLabel: string;
  slots: PublicSlot[];
};

type Step = "cpf" | "profile" | "vehicle" | "schedule" | "confirm" | "success";

const STEPS: Step[] = ["cpf", "profile", "vehicle", "schedule", "confirm"];

const STEP_LABELS: Record<Step, string> = {
  cpf: "CPF",
  profile: "Cadastro",
  vehicle: "Veículo",
  schedule: "Horário",
  confirm: "Confirmação",
  success: "Enviado",
};

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysIso(base: string, days: number) {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function FleetPublicReservationPage() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>(FLEET_PUBLIC_RESERVATION_INITIAL_STEP);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState(
    "Sua solicitação foi enviada e será analisada pela equipe responsável."
  );

  const [cpf, setCpf] = useState("");
  const [driverId, setDriverId] = useState("");
  const [identify, setIdentify] = useState<IdentifyResult | null>(null);
  const [isNewRegistration, setIsNewRegistration] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [cnhNumber, setCnhNumber] = useState("");
  const [cnhCategory, setCnhCategory] = useState("");
  const [cnhExpirationDate, setCnhExpirationDate] = useState("");

  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");

  const [weekStart, setWeekStart] = useState(todayIso());
  const [daysAvailability, setDaysAvailability] = useState<DayAvailability[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<string[]>([]);

  const [reason, setReason] = useState("");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [passengersCount, setPassengersCount] = useState("");
  const [responsibilityAccepted, setResponsibilityAccepted] = useState(false);

  const stepIndex = STEPS.indexOf(step as (typeof STEPS)[number]);

  useEffect(() => {
    if (!token) {
      setError("Link inválido.");
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJsonOk<PublicConfig>(
          `/api/public/fleet/reservation/${encodeURIComponent(token)}/config`
        );
        setConfig(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Link indisponível.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const vehicleLabel = useMemo(
    () => vehicles.find((v) => v.id === vehicleId)?.label ?? "—",
    [vehicles, vehicleId]
  );

  const consolidatedSelection = useMemo(() => {
    const day = daysAvailability.find((d) => d.date === selectedDate);
    if (!day || selectedSlotKeys.length === 0) return null;
    const slots = selectSlotsByKeys(
      day.slots.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
        key: s.key,
      })),
      selectedSlotKeys
    );
    return consolidateSelectedSlots(slots);
  }, [daysAvailability, selectedDate, selectedSlotKeys]);

  const selectedPeriodsSummary = useMemo(() => {
    if (!consolidatedSelection) return "—";
    return formatSelectedSlotsSummary(consolidatedSelection);
  }, [consolidatedSelection]);

  const selectedConsolidatedLabel = useMemo(() => {
    if (!consolidatedSelection) return "—";
    const day = daysAvailability.find((d) => d.date === selectedDate);
    const allDaySlots = day?.slots.map((s) => ({
      start: s.start,
      end: s.end,
      label: s.label,
      key: s.key,
    }));
    return formatConsolidatedPeriodLabel(consolidatedSelection, allDaySlots);
  }, [consolidatedSelection, daysAvailability, selectedDate]);

  const selectedDayLabel = useMemo(
    () => daysAvailability.find((d) => d.date === selectedDate)?.weekdayLabel ?? selectedDate,
    [daysAvailability, selectedDate]
  );

  const loadVehicles = useCallback(async () => {
    if (!token) return;
    const data = await fetchJsonOk<{ vehicles: PublicVehicle[] }>(
      `/api/public/fleet/reservation/${encodeURIComponent(token)}/vehicles`
    );
    setVehicles(data.vehicles);
  }, [token]);

  const loadAvailability = useCallback(async () => {
    if (!token || !vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        vehicleId,
        from: weekStart,
        days: "7",
      });
      const data = await fetchJsonOk<{ dates: DayAvailability[] }>(
        `/api/public/fleet/reservation/${encodeURIComponent(token)}/availability?${q}`
      );
      setDaysAvailability(data.dates);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar horários.");
      setDaysAvailability([]);
    } finally {
      setBusy(false);
    }
  }, [token, vehicleId, weekStart]);

  useEffect(() => {
    if (step === "schedule" && vehicleId) void loadAvailability();
  }, [step, vehicleId, weekStart, loadAvailability]);

  const submitIdentify = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJsonOk<IdentifyResult>(
        `/api/public/fleet/reservation/${encodeURIComponent(token)}/identify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cpf }),
        }
      );
      setIdentify(result);
      if (result.found) {
        setDriverId(result.driverId);
        setName(result.name);
        setPhone(result.phone ?? "");
        setEmail(result.email ?? "");
        setDepartment(result.department ?? "");
        setIsNewRegistration(false);
      } else {
        setIsNewRegistration(true);
        setDriverId("");
      }
      setStep("profile");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao consultar CPF.");
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJsonOk<{
        driverId: string;
        hasDriverLicense: boolean;
        needsDriverLicense: boolean;
      }>(`/api/public/fleet/reservation/${encodeURIComponent(token)}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpf,
          driverId: driverId || undefined,
          name,
          phone,
          email: email || null,
          department: department || null,
          cnhNumber,
          cnhCategory: cnhCategory || null,
          cnhExpirationDate: cnhExpirationDate || null,
        }),
      });
      setDriverId(result.driverId);
      if (result.needsDriverLicense) {
        setError("Informe os dados da CNH para continuar.");
        return;
      }
      await loadVehicles();
      setStep("vehicle");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar cadastro.");
    } finally {
      setBusy(false);
    }
  };

  const continueFromProfile = async () => {
    const needsCnh = isNewRegistration || (identify?.found === true && identify.needsDriverLicense);

    if (needsCnh) {
      await submitRegister();
      return;
    }
    try {
      await loadVehicles();
      setStep("vehicle");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar veículos.");
    }
  };

  const submitRequest = async () => {
    if (!token || !consolidatedSelection) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJsonOk<{ publicCode: string; message?: string }>(
        `/api/public/fleet/reservation/${encodeURIComponent(token)}/request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cpf,
            driverId,
            requesterName: name,
            requesterEmail: email || null,
            requesterPhone: phone || null,
            requesterDepartment: department || null,
            responsibilityAccepted,
            requestedDate: selectedDate,
            startTime: consolidatedSelection!.startTime,
            endTime: consolidatedSelection!.endTime,
            reason: reason.trim(),
            destination: destination.trim(),
            notes: notes.trim() || null,
            passengersCount: passengersCount ? Number(passengersCount) : null,
            vehicleId,
          }),
        }
      );
      setPublicCode(res.publicCode);
      if (res.message?.trim()) {
        setSuccessMessage(res.message.trim());
      }
      setStep("success");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao enviar solicitação.");
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setError(null);
    const idx = STEPS.indexOf(step as (typeof STEPS)[number]);
    if (idx > 0) setStep(STEPS[idx - 1]!);
  };

  const goNextFromVehicle = () => {
    if (!vehicleId) {
      setError("Selecione um veículo.");
      return;
    }
    setError(null);
    setSelectedDate("");
    setSelectedSlotKeys([]);
    setStep("schedule");
  };

  const toggleSlotSelection = (dayDate: string, slot: PublicSlot) => {
    if (!slot.available) return;
    if (selectedDate !== dayDate) {
      setSelectedDate(dayDate);
      setSelectedSlotKeys([slot.key]);
      setError(null);
      return;
    }
    setSelectedSlotKeys((prev) => {
      if (prev.includes(slot.key)) return prev.filter((k) => k !== slot.key);
      return [...prev, slot.key];
    });
    setError(null);
  };

  const goNextFromSchedule = () => {
    if (!selectedDate || selectedSlotKeys.length === 0) {
      setError("Selecione um dia e período disponível.");
      return;
    }
    const day = daysAvailability.find((d) => d.date === selectedDate);
    const slots = selectSlotsByKeys(
      (day?.slots ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
        key: s.key,
      })),
      selectedSlotKeys
    );
    const consolidated = consolidateSelectedSlots(slots);
    if (!consolidated) {
      setError(FLEET_PUBLIC_SLOT_SELECTION_GAP_MESSAGE);
      return;
    }
    const unavailable = slots.some((s) => {
      const live = day?.slots.find((d) => d.key === s.key);
      return live && !live.available;
    });
    if (unavailable) {
      setError("Um ou mais períodos selecionados não estão mais disponíveis. Escolha novamente.");
      return;
    }
    setError(null);
    setStep("confirm");
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
        <h1 className="text-lg font-semibold text-slate-900">{config?.title}</h1>
        {step !== "success" && step !== "cpf" && (
          <>
            <div className="mt-2 flex gap-1">
              {STEPS.slice(1).map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    "h-1 flex-1 rounded-full",
                    i < stepIndex - 1
                      ? "bg-emerald-500"
                      : i === stepIndex - 1
                        ? "bg-slate-800"
                        : "bg-slate-200"
                  )}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{STEP_LABELS[step]}</p>
          </>
        )}
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === "cpf" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-slate-700 leading-relaxed">{config?.instructions}</p>
            </div>
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

        {step === "profile" && (
          <section className="space-y-4">
            {identify?.found && !isNewRegistration && !identify.needsDriverLicense ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-2">
                <h2 className="font-semibold text-emerald-900">Encontramos seu cadastro</h2>
                <p className="text-emerald-800">{identify.name}</p>
                {identify.phone && <p className="text-sm text-emerald-800">Tel: {identify.phone}</p>}
                {identify.email && <p className="text-sm text-emerald-800">E-mail: {identify.email}</p>}
                <p className="text-sm font-medium text-emerald-900">
                  CNH: {identify.cnhStatus === "cadastrada" ? "CNH cadastrada" : identify.cnhStatus}
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="font-semibold text-slate-900">
                    {identify?.found ? "Complete seus dados" : "Vamos fazer seu cadastro rápido"}
                  </h2>
                </div>
                <Field label="CPF" value={cpf} onChange={() => {}} disabled />
                <Field label="Nome completo *" value={name} onChange={setName} />
                <Field label="Telefone / WhatsApp *" value={phone} onChange={setPhone} />
                <Field label="E-mail" value={email} onChange={setEmail} type="email" />
                <Field label="Setor / departamento" value={department} onChange={setDepartment} />
                <Field label="Número da CNH *" value={cnhNumber} onChange={setCnhNumber} />
                <Field label="Categoria da CNH" value={cnhCategory} onChange={setCnhCategory} />
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Validade da CNH</span>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
                    value={cnhExpirationDate}
                    onChange={(e) => setCnhExpirationDate(e.target.value)}
                  />
                </label>
              </>
            )}
          </section>
        )}

        {step === "vehicle" && (
          <section className="space-y-3">
            <p className="text-sm text-slate-600">Selecione o veículo desejado.</p>
            {vehicles.length === 0 ? (
              <p className="text-amber-700 text-sm">
                Nenhum veículo disponível para solicitação no momento.
              </p>
            ) : (
              vehicles.map((v) => {
                const selected = vehicleId === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVehicleId(v.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-4 text-left transition",
                      selected
                        ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                        : "border-slate-200 bg-white hover:border-slate-400"
                    )}
                  >
                    <p className="text-lg font-semibold text-slate-900">{v.label}</p>
                    {v.category && <p className="text-xs text-slate-500 mt-1">{v.category}</p>}
                  </button>
                );
              })
            )}
          </section>
        )}

        {step === "schedule" && (
          <section className="space-y-4">
            <p className="text-sm text-slate-600">
              Toque nos períodos desejados. Você pode selecionar mais de um horário em sequência no
              mesmo dia.
            </p>
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setWeekStart((w) => addDaysIso(w, -7))}
              >
                ← Semana anterior
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setWeekStart((w) => addDaysIso(w, 7))}
              >
                Próxima semana →
              </button>
            </div>
            {busy ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
              </div>
            ) : (
              daysAvailability.map((day) => (
                <div key={day.date} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-semibold text-slate-900 mb-3">{day.weekdayLabel}</h3>
                  <div className="grid gap-2">
                    {day.slots.map((slot) => {
                      const selected =
                        selectedDate === day.date && selectedSlotKeys.includes(slot.key);
                      return (
                        <button
                          key={`${day.date}-${slot.key}`}
                          type="button"
                          disabled={!slot.available}
                          onClick={() => toggleSlotSelection(day.date, slot)}
                          className={cn(
                            "rounded-xl border px-3 py-3 text-left text-sm transition",
                            !slot.available && "opacity-40 cursor-not-allowed bg-slate-50",
                            slot.available && !selected && "border-slate-200 hover:border-slate-400",
                            selected && "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                          )}
                        >
                          <span className="font-medium">{slot.label}</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            {slot.available ? "Disponível" : "Indisponível"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {consolidatedSelection && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm space-y-2">
                <p className="font-semibold text-emerald-900">Resumo da seleção</p>
                <p className="text-emerald-800">
                  <span className="font-medium">Períodos:</span> {selectedPeriodsSummary}
                </p>
                <p className="text-emerald-800">
                  <span className="font-medium">Intervalo:</span> {selectedConsolidatedLabel}
                </p>
              </div>
            )}
          </section>
        )}

        {step === "confirm" && (
          <section className="space-y-4">
            <Field label="Motivo da reserva *" value={reason} onChange={setReason} multiline />
            <Field label="Destino / local *" value={destination} onChange={setDestination} />
            <Field label="Observações" value={notes} onChange={setNotes} multiline />
            <Field
              label="Passageiros (opcional)"
              value={passengersCount}
              onChange={setPassengersCount}
              type="number"
            />
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={responsibilityAccepted}
                onChange={(e) => setResponsibilityAccepted(e.target.checked)}
              />
              <span className="text-slate-700">
                Declaro que utilizarei o veículo de forma responsável e seguirei as normas internas de frota.
              </span>
            </label>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 text-sm">
              <Row label="CPF" value={cpf} />
              <Row label="Nome" value={name} />
              <Row label="Veículo" value={vehicleLabel} />
              <Row label="Dia" value={selectedDayLabel} />
              <Row label="Períodos" value={selectedPeriodsSummary} />
              <Row label="Intervalo" value={selectedConsolidatedLabel} />
              <Row label="Motivo" value={reason} />
              <Row label="Destino" value={destination} />
            </div>
          </section>
        )}

        {step === "success" && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold text-emerald-900">Solicitação enviada</h2>
            <p className="text-emerald-800">{successMessage}</p>
            {publicCode && (
              <p className="text-sm font-mono font-semibold text-emerald-900">Código: {publicCode}</p>
            )}
          </section>
        )}
      </main>

      {step !== "cpf" && step !== "success" && (
        <footer className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-lg gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 py-3 text-sm font-medium"
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </button>
            {step === "profile" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void continueFromProfile()}
                className="inline-flex flex-[2] items-center justify-center rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continuar"}
              </button>
            )}
            {step === "vehicle" && (
              <button
                type="button"
                onClick={goNextFromVehicle}
                className="inline-flex flex-[2] items-center justify-center gap-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white"
              >
                Continuar
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "schedule" && (
              <button
                type="button"
                onClick={goNextFromSchedule}
                className="inline-flex flex-[2] items-center justify-center gap-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white"
              >
                Continuar
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "confirm" && (
              <button
                type="button"
                disabled={busy || !responsibilityAccepted || !reason.trim() || !destination.trim()}
                onClick={() => void submitRequest()}
                className="inline-flex flex-[2] items-center justify-center rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar solicitação"}
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  multiline,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {multiline ? (
        <textarea
          disabled={disabled}
          className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base min-h-[80px] disabled:bg-slate-100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={type}
          disabled={disabled}
          className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base disabled:bg-slate-100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-medium text-slate-900">{value}</p>
    </div>
  );
}
