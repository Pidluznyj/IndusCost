import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  Zap,
  Cog,
  RefreshCcw,
  Eraser,
  Info,
  ShieldCheck,
  TrendingUp,
  Loader2,
  AlertCircle,
  Scale,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import {
  compareSimulatedInjectionHourlyToOfficial,
  type OfficialDefaultIndustrialCostsReference,
} from "@/src/lib/componentStandardProcessCost";
import {
  computeTransformationCostSimulator,
  DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
  EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES,
  TRANSFORMATION_COST_SIMULATOR_LABOR_ENERGY_UNAVAILABLE,
  TRANSFORMATION_COST_SIMULATOR_STORAGE_KEY,
  TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE,
  type TransformationCostSimulatorFormValues,
} from "@/src/lib/transformationCostSimulator";
import { CostCenterHhHmSimulationPanel } from "@/src/components/CostCenterHhHmSimulationPanel";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

function formatOfficialHourlyRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatCurrency(value)}/h`;
}

function formatHourlyRate(value: number | null): string {
  if (value == null) return TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  return `${formatCurrency(value)}/h`;
}

function formatInjectionHourlyRate(value: number | null): string {
  if (value != null) return `${formatCurrency(value)}/h`;
  return TRANSFORMATION_COST_SIMULATOR_LABOR_ENERGY_UNAVAILABLE;
}

function formatPiecesPerHour(value: number | null): string {
  if (value == null) return TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  return `${formatNumber(value, 0)} peças/h`;
}

function formatCostPerPiece(value: number | null): string {
  if (value == null) return TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  const decimals = value < 1 ? 4 : 2;
  return `${formatCurrency(value, decimals)} por peça`;
}

function formatHours(value: number | null): string {
  if (value == null) return TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  return `${formatNumber(value, 0)} h`;
}

function formatCyclesPerHour(value: number | null): string {
  if (value == null) return TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  return formatNumber(value, 2);
}

function loadStoredForm(): TransformationCostSimulatorFormValues {
  if (typeof window === "undefined") return DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES;
  try {
    const raw = window.localStorage.getItem(TRANSFORMATION_COST_SIMULATOR_STORAGE_KEY);
    if (!raw) return DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES;
    const parsed = JSON.parse(raw) as Partial<TransformationCostSimulatorFormValues>;
    return { ...DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES, ...parsed };
  } catch {
    return DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES;
  }
}

function MetricValue({ value, unavailableClass }: { value: string; unavailableClass?: string }) {
  const isUnavailable = value === TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  return (
    <p
      className={cn(
        "mt-1.5 text-base font-semibold tabular-nums leading-tight",
        isUnavailable
          ? cn("text-sm font-normal italic text-slate-500", unavailableClass)
          : "text-slate-900"
      )}
    >
      {value}
    </p>
  );
}

function ResultTile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "default" | "accent" | "highlight";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3.5 shadow-sm",
        emphasis === "highlight"
          ? "border-emerald-200 bg-emerald-50/30"
          : emphasis === "accent"
            ? "border-slate-300 bg-slate-50/80"
            : "border-slate-200"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <MetricValue
        value={value}
        unavailableClass={emphasis === "highlight" ? "text-slate-500" : undefined}
      />
    </div>
  );
}

function BlockCard({
  step,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  step: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {step}
            </span>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          </div>
          <p className="text-sm leading-relaxed text-slate-600">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
      {error ? <p className="text-xs font-medium text-amber-800">{error}</p> : null}
    </div>
  );
}

const SECONDARY_BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300";

const OFFICIAL_REFERENCE_UNAVAILABLE =
  "Não foi possível carregar os custos default do sistema. Verifique Configurações Gerais.";

export function TransformationCostSimulatorModule() {
  const [form, setForm] = useState<TransformationCostSimulatorFormValues>(loadStoredForm);
  const [officialReference, setOfficialReference] =
    useState<OfficialDefaultIndustrialCostsReference | null>(null);
  const [officialReferenceError, setOfficialReferenceError] = useState<string | null>(null);
  const [officialReferenceLoading, setOfficialReferenceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOfficialReferenceLoading(true);
      try {
        const data = (await fetchJsonOk(
          "/api/transformation-simulator/official-reference-costs"
        )) as OfficialDefaultIndustrialCostsReference & { error?: string };
        if (cancelled) return;
        if (data.available) {
          setOfficialReference(data);
          setOfficialReferenceError(null);
        } else {
          setOfficialReference(null);
          setOfficialReferenceError(data.error ?? OFFICIAL_REFERENCE_UNAVAILABLE);
        }
      } catch {
        if (!cancelled) {
          setOfficialReference(null);
          setOfficialReferenceError(OFFICIAL_REFERENCE_UNAVAILABLE);
        }
      } finally {
        if (!cancelled) setOfficialReferenceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TRANSFORMATION_COST_SIMULATOR_STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const result = useMemo(() => computeTransformationCostSimulator(form), [form]);

  const patch = (key: keyof TransformationCostSimulatorFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const heroCost = formatCostPerPiece(result.product.estimatedInjectionCostPerPiece);
  const heroReady = heroCost !== TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  const injectionHourlyReady = result.product.injectionHourlyCost != null;
  const showOperationHourly =
    result.product.operationHourlyCost != null &&
    result.product.injectionHourlyCost != null &&
    Math.abs(result.product.operationHourlyCost - result.product.injectionHourlyCost) > 0.000001;

  const hourlyComparison = useMemo(
    () =>
      compareSimulatedInjectionHourlyToOfficial({
        simulatedInjectionHourlyCost: result.product.injectionHourlyCost,
        officialReference,
      }),
    [result.product.injectionHourlyCost, officialReference]
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setForm(DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES)}
            className={SECONDARY_BUTTON_CLASS}
          >
            <RefreshCcw className="h-4 w-4 text-slate-600" />
            Restaurar exemplo padrão
          </button>
          <button
            type="button"
            onClick={() => setForm(EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES)}
            className={SECONDARY_BUTTON_CLASS}
          >
            <Eraser className="h-4 w-4 text-slate-600" />
            Limpar campos
          </button>
        </div>
      </div>

      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 shadow-sm"
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm ring-1 ring-slate-200">
          <ShieldCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">Simulador de estimativa</p>
          <p className="text-sm leading-relaxed text-slate-700">
            Simulador de estimativa. Os valores calculados aqui não alteram custos oficiais,
            produtos, pedidos, margens ou tabelas vigentes.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <div className="mb-5 space-y-1 border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Referência oficial do sistema</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Valores default cadastrados em Configurações Gerais e usados como base no cálculo oficial
            de produtos.
          </p>
        </div>

        {officialReferenceLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando referência oficial...
          </div>
        ) : officialReference?.available ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">HH default</p>
              <p className="mt-2 text-2xl font-black tabular-nums text-slate-900">
                {formatOfficialHourlyRate(officialReference.hhDefault)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Custo hora homem cadastrado em Configurações Gerais
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">HM default</p>
              <p className="mt-2 text-2xl font-black tabular-nums text-slate-900">
                {formatOfficialHourlyRate(officialReference.hmDefault)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Custo hora máquina cadastrado em Configurações Gerais
              </p>
            </div>
            <div className="rounded-lg border border-slate-400 bg-slate-50/90 p-4 shadow-md ring-1 ring-slate-200">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                Custo hora de injeção default
              </p>
              <p className="mt-2 text-3xl font-black tabular-nums text-slate-900">
                {formatOfficialHourlyRate(officialReference.injectionHourlyCostDefault)}
              </p>
              <p className="mt-2 text-xs font-medium text-slate-700">HH default + HM default</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Referência para comparar com a simulação manual abaixo.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{officialReferenceError ?? OFFICIAL_REFERENCE_UNAVAILABLE}</p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <BlockCard
          step="Bloco 1"
          icon={Users}
          title="Mão de Obra"
          subtitle="Folha produtiva mensal, pessoas, horas disponíveis e eficiência real da operação."
        >
          <div className="space-y-4">
            <Field
              label="Custo mensal da folha produtiva (R$)"
              value={form.monthlyPayroll}
              onChange={(v) => patch("monthlyPayroll", v)}
              type="number"
              step="0.01"
            />
            <Field
              label="Quantidade de pessoas produtivas"
              value={form.productivePeople}
              onChange={(v) => patch("productivePeople", v)}
              type="number"
              step="1"
            />
            <Field
              label="Horas mensais por pessoa"
              value={form.hoursPerPerson}
              onChange={(v) => patch("hoursPerPerson", v)}
              type="number"
              step="0.01"
            />
            <Field
              label="Eficiência produtiva da mão de obra (%)"
              value={form.laborEfficiencyPercent}
              onChange={(v) => patch("laborEfficiencyPercent", v)}
              type="number"
              step="0.01"
              error={result.fieldErrors.laborEfficiencyPercent}
            />
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <ResultTile
                label="Horas homem teóricas"
                value={formatHours(result.labor.theoreticalLaborHours)}
              />
              <ResultTile
                label="Horas homem produtivas ajustadas"
                value={formatHours(result.labor.adjustedLaborHours)}
              />
              <ResultTile label="HH teórico" value={formatHourlyRate(result.labor.theoreticalHH)} />
              <ResultTile
                label="HH ajustado"
                value={formatHourlyRate(result.labor.adjustedHH)}
                emphasis="accent"
              />
            </div>
          </div>
        </BlockCard>

        <BlockCard
          step="Bloco 2"
          icon={Zap}
          title="Energia / Máquinas"
          subtitle="Energia do parque produtivo, máquinas ativas, horas disponíveis e eficiência real."
        >
          <div className="space-y-4">
            <Field
              label="Gasto mensal de energia (R$)"
              value={form.monthlyEnergy}
              onChange={(v) => patch("monthlyEnergy", v)}
              type="number"
              step="0.01"
            />
            <Field
              label="Quantidade de máquinas produtivas"
              value={form.machines}
              onChange={(v) => patch("machines", v)}
              type="number"
              step="1"
            />
            <Field
              label="Horas mensais por máquina"
              value={form.hoursPerMachine}
              onChange={(v) => patch("hoursPerMachine", v)}
              type="number"
              step="0.01"
            />
            <Field
              label="Eficiência produtiva das máquinas (%)"
              value={form.machineEfficiencyPercent}
              onChange={(v) => patch("machineEfficiencyPercent", v)}
              type="number"
              step="0.01"
              error={result.fieldErrors.machineEfficiencyPercent}
            />
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <ResultTile
                label="Horas máquina teóricas"
                value={formatHours(result.energy.theoreticalMachineHours)}
              />
              <ResultTile
                label="Horas máquina produtivas ajustadas"
                value={formatHours(result.energy.adjustedMachineHours)}
              />
              <ResultTile
                label="HM energia teórico"
                value={formatHourlyRate(result.energy.theoreticalHM)}
              />
              <ResultTile
                label="HM energia ajustado"
                value={formatHourlyRate(result.energy.adjustedHM)}
                emphasis="accent"
              />
            </div>
          </div>
        </BlockCard>

        <BlockCard
          step="Bloco 3"
          icon={Cog}
          title="Produto / Operação"
          subtitle="Simulação livre da peça: ciclo, cavidades, operadores e refugo estimado."
        >
          <div className="space-y-4">
            <Field
              label="Nome da simulação ou descrição da peça"
              value={form.simulationName}
              onChange={(v) => patch("simulationName", v)}
              placeholder="Peça exemplo"
            />
            <Field
              label="Ciclo da máquina (segundos)"
              value={form.cycleSeconds}
              onChange={(v) => patch("cycleSeconds", v)}
              type="number"
              step="0.01"
              error={result.fieldErrors.cycleSeconds}
            />
            <Field
              label="Cavidades boas do molde"
              value={form.cavities}
              onChange={(v) => patch("cavities", v)}
              type="number"
              step="1"
              error={result.fieldErrors.cavities}
            />
            <Field
              label="Quantidade de operadores na operação"
              value={form.operators}
              onChange={(v) => patch("operators", v)}
              type="number"
              step="0.01"
              error={result.fieldErrors.operators}
            />
            <Field
              label="Refugo estimado (%)"
              value={form.scrapPercent}
              onChange={(v) => patch("scrapPercent", v)}
              type="number"
              step="0.01"
              error={result.fieldErrors.scrapPercent}
            />
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <ResultTile
                label="Custo hora da operação"
                value={formatHourlyRate(result.product.operationHourlyCost)}
                emphasis="accent"
              />
              <ResultTile
                label="Ciclos por hora"
                value={formatCyclesPerHour(result.product.cyclesPerHour)}
              />
              <ResultTile
                label="Peças teóricas por hora"
                value={
                  result.product.theoreticalPiecesPerHour == null
                    ? TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE
                    : `${formatNumber(result.product.theoreticalPiecesPerHour, 0)} peças/h`
                }
              />
              <ResultTile
                label="Peças boas por hora"
                value={formatPiecesPerHour(result.product.goodPiecesPerHour)}
              />
            </div>
          </div>
        </BlockCard>
      </div>

      <section
        className={cn(
          "rounded-xl border p-6 shadow-sm",
          injectionHourlyReady
            ? "border-slate-300 bg-gradient-to-r from-slate-50 via-white to-slate-50"
            : "border-slate-200 bg-white"
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Custo hora de injeção
            </p>
            <p
              className={cn(
                "font-black tabular-nums tracking-tight",
                injectionHourlyReady ? "text-3xl text-slate-900 sm:text-4xl" : "text-base italic text-slate-500"
              )}
            >
              {formatInjectionHourlyRate(result.product.injectionHourlyCost)}
            </p>
            <p className="text-sm text-slate-600">HH ajustado + HM energia ajustado</p>
          </div>
          {showOperationHourly ? (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Custo hora da operação
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {formatHourlyRate(result.product.operationHourlyCost)}
              </p>
              <p className="mt-1 text-xs text-slate-600">HM ajustado + (HH ajustado × operadores)</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-4 w-4 text-slate-600" aria-hidden />
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Resumo final consolidado
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col justify-center rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-white p-6 shadow-sm">
            <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
              Resultado principal
            </span>
            <p className="mt-3 text-base font-semibold text-slate-800">
              Custo de Injeção Estimado por Peça
            </p>
            <p
              className={cn(
                "mt-3 font-black tabular-nums tracking-tight",
                heroReady ? "text-4xl text-emerald-900 sm:text-5xl" : "text-lg italic text-slate-500"
              )}
            >
              {heroCost}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Estimativa operacional calculada a partir do custo hora de injeção, ciclo, cavidades e
              refugo. Não substitui custo oficial publicado.
            </p>
            {form.simulationName.trim() ? (
              <p className="mt-4 border-t border-emerald-100 pt-3 text-sm text-slate-600">
                Cenário:{" "}
                <span className="font-semibold text-slate-900">{form.simulationName.trim()}</span>
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ResultTile
                label="Custo hora de injeção"
                value={formatInjectionHourlyRate(result.product.injectionHourlyCost)}
                emphasis="accent"
              />
              <p className="mt-1 px-1 text-[11px] text-slate-500">HH ajustado + HM energia ajustado</p>
            </div>
            <ResultTile
              label="HH ajustado"
              value={formatHourlyRate(result.labor.adjustedHH)}
              emphasis="accent"
            />
            <ResultTile
              label="HM energia ajustado"
              value={formatHourlyRate(result.energy.adjustedHM)}
              emphasis="accent"
            />
            {showOperationHourly ? (
              <ResultTile
                label="Custo hora da operação"
                value={formatHourlyRate(result.product.operationHourlyCost)}
                emphasis="accent"
              />
            ) : null}
            <ResultTile
              label="Peças boas por hora"
              value={formatPiecesPerHour(result.product.goodPiecesPerHour)}
            />
            <div className="sm:col-span-2">
              <ResultTile
                label="Custo de injeção estimado por peça"
                value={formatCostPerPiece(result.product.estimatedInjectionCostPerPiece)}
                emphasis="highlight"
              />
            </div>
            {showOperationHourly ? (
              <div className="sm:col-span-2">
                <ResultTile
                  label="Custo operacional estimado por peça"
                  value={formatCostPerPiece(result.product.estimatedTransformationCostPerPiece)}
                />
              </div>
            ) : null}
            {hourlyComparison ? (
              <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Scale className="h-4 w-4 text-slate-600" aria-hidden />
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    Comparação com referência oficial
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-600">Referência oficial</p>
                    <p className="font-bold tabular-nums text-slate-900">
                      {formatOfficialHourlyRate(hourlyComparison.official)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Simulação atual</p>
                    <p className="font-bold tabular-nums text-slate-900">
                      {formatOfficialHourlyRate(hourlyComparison.simulated)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Diferença</p>
                    <p className="font-bold tabular-nums text-slate-900">
                      {formatCurrency(hourlyComparison.difference)} (
                      {formatNumber(hourlyComparison.differencePct, 2)}%)
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <CostCenterHhHmSimulationPanel />

      <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-800 marker:content-none">
          <Info className="h-4 w-4 text-slate-600" aria-hidden />
          Como o cálculo funciona
          <span className="ml-auto text-xs font-medium text-slate-500 group-open:hidden">Expandir</span>
        </summary>
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm leading-relaxed text-slate-700 sm:grid-cols-2">
          <p>
            <span className="font-semibold text-slate-900">HH teórico</span> = folha produtiva ÷
            (pessoas × horas por pessoa).
          </p>
          <p>
            <span className="font-semibold text-slate-900">HH ajustado</span> = folha ÷ horas
            produtivas ajustadas (teóricas × eficiência).
          </p>
          <p>
            <span className="font-semibold text-slate-900">HM teórico</span> = energia ÷ (máquinas ×
            horas por máquina).
          </p>
          <p>
            <span className="font-semibold text-slate-900">HM ajustado</span> = energia ÷ horas
            máquina produtivas ajustadas.
          </p>
          <p>
            <span className="font-semibold text-slate-900">Custo hora de injeção</span> = HH
            ajustado + HM energia ajustado.
          </p>
          <p>
            <span className="font-semibold text-slate-900">Custo hora da operação</span> = HM
            ajustado + (HH ajustado × operadores).
          </p>
          <p>
            <span className="font-semibold text-slate-900">Custo de injeção por peça</span> = custo
            hora de injeção ÷ peças boas por hora.
          </p>
        </div>
      </details>
    </div>
  );
}
