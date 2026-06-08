import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";

type PublicConfig = {
  title: string;
  instructions: string;
  vehicles: { id: string; label: string }[];
};

type PublicSlot = {
  start: string;
  end: string;
  label: string;
  available: boolean;
  vehiclesAvailable: number;
};

type Step = "welcome" | "identity" | "details" | "slots" | "review" | "success";

const STEPS: Step[] = ["welcome", "identity", "details", "slots", "review"];

const STEP_LABELS: Record<Step, string> = {
  welcome: "Início",
  identity: "Identificação",
  details: "Reserva",
  slots: "Horário",
  review: "Revisão",
  success: "Enviado",
};

type FormState = {
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  requesterDepartment: string;
  requesterEmployeeId: string;
  responsibilityAccepted: boolean;
  requestedDate: string;
  reason: string;
  destination: string;
  notes: string;
  passengersCount: string;
  hasCargo: string;
  cargoDescription: string;
  vehicleId: string;
  startTime: string;
  endTime: string;
};

const EMPTY_FORM: FormState = {
  requesterName: "",
  requesterEmail: "",
  requesterPhone: "",
  requesterDepartment: "",
  requesterEmployeeId: "",
  responsibilityAccepted: false,
  requestedDate: "",
  reason: "",
  destination: "",
  notes: "",
  passengersCount: "",
  hasCargo: "",
  cargoDescription: "",
  vehicleId: "",
  startTime: "",
  endTime: "",
};

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function FleetPublicReservationPage() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("welcome");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);

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

  const loadSlots = useCallback(async () => {
    if (!token || !form.requestedDate) return;
    setSlotsLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ date: form.requestedDate });
      if (form.vehicleId) q.set("vehicleId", form.vehicleId);
      const data = await fetchJsonOk<{ slots: PublicSlot[] }>(
        `/api/public/fleet/reservation/${encodeURIComponent(token)}/availability?${q}`
      );
      setSlots(data.slots);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar horários.");
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [token, form.requestedDate, form.vehicleId]);

  useEffect(() => {
    if (step === "slots" && form.requestedDate) void loadSlots();
  }, [step, form.requestedDate, form.vehicleId, loadSlots]);

  const selectedSlotLabel = useMemo(() => {
    const hit = slots.find((s) => s.start === form.startTime && s.end === form.endTime);
    return hit?.label ?? (form.startTime && form.endTime ? `${form.startTime}–${form.endTime}` : "—");
  }, [slots, form.startTime, form.endTime]);

  const vehicleLabel = useMemo(() => {
    if (!form.vehicleId) return "A definir pela frota";
    return config?.vehicles.find((v) => v.id === form.vehicleId)?.label ?? "Veículo selecionado";
  }, [config, form.vehicleId]);

  const patch = (partial: Partial<FormState>) => setForm((f) => ({ ...f, ...partial }));

  const canNext = (): boolean => {
    if (step === "identity") {
      return form.requesterName.trim().length >= 3 && form.responsibilityAccepted;
    }
    if (step === "details") {
      return Boolean(form.requestedDate && form.reason.trim() && form.destination.trim());
    }
    if (step === "slots") {
      return Boolean(form.startTime && form.endTime);
    }
    return true;
  };

  const goNext = () => {
    if (!canNext()) {
      setError("Preencha os campos obrigatórios.");
      return;
    }
    setError(null);
    const idx = STEPS.indexOf(step as (typeof STEPS)[number]);
    if (idx >= 0 && idx < STEPS.length - 1) setStep(STEPS[idx + 1]!);
  };

  const goBack = () => {
    setError(null);
    const idx = STEPS.indexOf(step as (typeof STEPS)[number]);
    if (idx > 0) setStep(STEPS[idx - 1]!);
  };

  const submit = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        requesterName: form.requesterName.trim(),
        requesterEmail: form.requesterEmail.trim() || null,
        requesterPhone: form.requesterPhone.trim() || null,
        requesterDepartment: form.requesterDepartment.trim() || null,
        requesterEmployeeId: form.requesterEmployeeId.trim() || null,
        responsibilityAccepted: form.responsibilityAccepted,
        requestedDate: form.requestedDate,
        startTime: form.startTime,
        endTime: form.endTime,
        reason: form.reason.trim(),
        destination: form.destination.trim(),
        notes: form.notes.trim() || null,
        vehicleId: form.vehicleId || null,
      };
      if (form.passengersCount) body.passengersCount = Number(form.passengersCount);
      if (form.hasCargo === "yes") {
        body.hasCargo = true;
        body.cargoDescription = form.cargoDescription.trim() || null;
      } else if (form.hasCargo === "no") body.hasCargo = false;

      const res = await fetchJsonOk<{ publicCode: string }>(
        `/api/public/fleet/reservation/${encodeURIComponent(token)}/request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setPublicCode(res.publicCode);
      setStep("success");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao enviar solicitação.");
    } finally {
      setSubmitting(false);
    }
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
        {step !== "success" && step !== "welcome" && (
          <div className="mt-2 flex gap-1">
            {STEPS.slice(1).map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i < stepIndex ? "bg-emerald-500" : i === stepIndex - 1 ? "bg-slate-800" : "bg-slate-200"
                )}
              />
            ))}
          </div>
        )}
        {step !== "success" && step !== "welcome" && (
          <p className="mt-1 text-xs text-slate-500">{STEP_LABELS[step]}</p>
        )}
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === "welcome" && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-slate-700 leading-relaxed">{config?.instructions}</p>
            </div>
            <button
              type="button"
              onClick={() => setStep("identity")}
              className="w-full rounded-2xl bg-slate-900 py-4 text-base font-semibold text-white"
            >
              Começar
            </button>
          </section>
        )}

        {step === "identity" && (
          <section className="space-y-4">
            <Field label="Nome completo *" value={form.requesterName} onChange={(v) => patch({ requesterName: v })} />
            <Field label="E-mail corporativo" value={form.requesterEmail} onChange={(v) => patch({ requesterEmail: v })} type="email" />
            <Field label="Telefone / WhatsApp" value={form.requesterPhone} onChange={(v) => patch({ requesterPhone: v })} />
            <Field label="Setor / departamento" value={form.requesterDepartment} onChange={(v) => patch({ requesterDepartment: v })} />
            <Field label="Matrícula / ID interno" value={form.requesterEmployeeId} onChange={(v) => patch({ requesterEmployeeId: v })} />
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={form.responsibilityAccepted}
                onChange={(e) => patch({ responsibilityAccepted: e.target.checked })}
              />
              <span className="text-slate-700">
                Declaro que utilizarei o veículo de forma responsável e seguirei as normas internas de frota.
              </span>
            </label>
          </section>
        )}

        {step === "details" && (
          <section className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Data desejada *</span>
              <input
                type="date"
                min={todayIso()}
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
                value={form.requestedDate}
                onChange={(e) => patch({ requestedDate: e.target.value, startTime: "", endTime: "" })}
              />
            </label>
            <Field label="Motivo da reserva *" value={form.reason} onChange={(v) => patch({ reason: v })} />
            <Field label="Destino / local *" value={form.destination} onChange={(v) => patch({ destination: v })} />
            <Field label="Observações" value={form.notes} onChange={(v) => patch({ notes: v })} multiline />
            <Field label="Passageiros (opcional)" value={form.passengersCount} onChange={(v) => patch({ passengersCount: v })} type="number" />
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Levar carga / material?</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
                value={form.hasCargo}
                onChange={(e) => patch({ hasCargo: e.target.value })}
              >
                <option value="">Não informado</option>
                <option value="no">Não</option>
                <option value="yes">Sim</option>
              </select>
            </label>
            {form.hasCargo === "yes" && (
              <Field label="Descrição da carga" value={form.cargoDescription} onChange={(v) => patch({ cargoDescription: v })} />
            )}
            {config && config.vehicles.length > 0 && (
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Veículo (opcional)</span>
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
                  value={form.vehicleId}
                  onChange={(e) => patch({ vehicleId: e.target.value, startTime: "", endTime: "" })}
                >
                  <option value="">Qualquer veículo disponível</option>
                  {config.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}

        {step === "slots" && (
          <section className="space-y-3">
            <p className="text-sm text-slate-600">
              Horários de 3 em 3 horas (06:00–20:00). Selecione um período livre.
            </p>
            {slotsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
              </div>
            ) : slots.length === 0 ? (
              <p className="text-sm text-amber-700">Nenhum horário disponível para esta data.</p>
            ) : (
              slots.map((slot) => {
                const selected = form.startTime === slot.start && form.endTime === slot.end;
                return (
                  <button
                    key={`${slot.start}-${slot.end}`}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => patch({ startTime: slot.start, endTime: slot.end })}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-4 text-left transition",
                      !slot.available && "opacity-40 cursor-not-allowed border-slate-200 bg-slate-50",
                      slot.available && !selected && "border-slate-200 bg-white hover:border-slate-400",
                      selected && "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-semibold text-slate-900">{slot.label}</span>
                      {selected && <Check className="h-5 w-5 text-emerald-600" />}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {slot.available
                        ? `${slot.vehiclesAvailable} veículo(s) livre(s)`
                        : "Indisponível"}
                    </p>
                  </button>
                );
              })
            )}
          </section>
        )}

        {step === "review" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 text-sm">
            <Row label="Nome" value={form.requesterName} />
            <Row label="Data" value={form.requestedDate} />
            <Row label="Período" value={selectedSlotLabel} />
            <Row label="Veículo" value={vehicleLabel} />
            <Row label="Motivo" value={form.reason} />
            <Row label="Destino" value={form.destination} />
            {form.notes && <Row label="Observações" value={form.notes} />}
          </section>
        )}

        {step === "success" && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold text-emerald-900">Solicitação enviada</h2>
            <p className="text-emerald-800">
              Sua solicitação foi enviada e será analisada pela equipe responsável.
            </p>
            {publicCode && (
              <p className="text-sm font-mono font-semibold text-emerald-900">Código: {publicCode}</p>
            )}
          </section>
        )}
      </main>

      {step !== "welcome" && step !== "success" && (
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
            {step === "review" ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="inline-flex flex-[2] items-center justify-center gap-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar solicitação"}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex flex-[2] items-center justify-center gap-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white"
              >
                Continuar
                <ChevronRight className="h-4 w-4" />
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {multiline ? (
        <textarea
          className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base min-h-[80px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={type}
          className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
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
