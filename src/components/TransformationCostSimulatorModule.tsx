import React, { useEffect, useMemo, useState } from "react";
import { Gauge, RefreshCcw, Eraser, Info } from "lucide-react";
import { AppAlert } from "@/src/components/shared/AppAlert";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import {
  computeTransformationCostSimulator,
  DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES,
  EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES,
  TRANSFORMATION_COST_SIMULATOR_STORAGE_KEY,
  TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE,
  type TransformationCostSimulatorFormValues,
} from "@/src/lib/transformationCostSimulator";

const INPUT_CLASS =
  "w-full rounded-xl border border-border bg-background p-3 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";

function formatHourlyRate(value: number | null): string {
  if (value == null) return TRANSFORMATION_COST_SIMULATOR_UNAVAILABLE;
  return `${formatCurrency(value)}/h`;
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

function ResultTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "primary" | "amber" | "blue";
}) {
  const valueClass =
    highlight === "primary"
      ? "text-primary"
      : highlight === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : highlight === "blue"
          ? "text-blue-700 dark:text-blue-300"
          : "text-slate-900 dark:text-slate-100";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={cn("mt-1 text-sm font-semibold tabular-nums", valueClass)}>{value}</p>
    </div>
  );
}

function BlockCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 space-y-1">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">{title}</h3>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{subtitle}</p>
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
      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
      {error ? <p className="text-xs text-amber-700 dark:text-amber-300">{error}</p> : null}
    </div>
  );
}

export function TransformationCostSimulatorModule() {
  const [form, setForm] = useState<TransformationCostSimulatorFormValues>(loadStoredForm);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TRANSFORMATION_COST_SIMULATOR_STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const result = useMemo(() => computeTransformationCostSimulator(form), [form]);

  const patch = (key: keyof TransformationCostSimulatorFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <AppAlert variant="info" title="Simulador de estimativa" className="border-sky-200 bg-sky-50/70">
        Simulador de estimativa. Os valores calculados aqui não alteram custos oficiais, produtos,
        pedidos, margens ou tabelas vigentes.
      </AppAlert>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Gauge className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
                Simulador de Custo de Transformação
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Estime HH, HM e custo de transformação por peça para aprendizado e cenários
                operacionais.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setForm(DEFAULT_TRANSFORMATION_COST_SIMULATOR_VALUES)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent"
          >
            <RefreshCcw className="h-4 w-4" />
            Restaurar exemplo padrão
          </button>
          <button
            type="button"
            onClick={() => setForm(EMPTY_TRANSFORMATION_COST_SIMULATOR_VALUES)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent"
          >
            <Eraser className="h-4 w-4" />
            Limpar campos
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <BlockCard
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                highlight="blue"
              />
            </div>
          </div>
        </BlockCard>

        <BlockCard
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                highlight="blue"
              />
            </div>
          </div>
        </BlockCard>

        <BlockCard
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ResultTile
                label="Custo hora transformação"
                value={formatHourlyRate(result.product.transformationCostPerHour)}
                highlight="primary"
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

      <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Resumo final consolidado
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <ResultTile
            label="HH ajustado"
            value={formatHourlyRate(result.labor.adjustedHH)}
            highlight="blue"
          />
          <ResultTile
            label="HM energia ajustado"
            value={formatHourlyRate(result.energy.adjustedHM)}
            highlight="blue"
          />
          <ResultTile
            label="Custo hora transformação"
            value={formatHourlyRate(result.product.transformationCostPerHour)}
            highlight="primary"
          />
          <ResultTile
            label="Peças boas por hora"
            value={formatPiecesPerHour(result.product.goodPiecesPerHour)}
          />
          <ResultTile
            label="Custo transformação estimado por peça"
            value={formatCostPerPiece(result.product.estimatedTransformationCostPerPiece)}
            highlight="amber"
          />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-center dark:border-slate-700 dark:bg-slate-950/40">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Custo de Transformação Estimado por Peça
          </p>
          <p className="mt-2 text-3xl font-black tabular-nums text-primary">
            {formatCostPerPiece(result.product.estimatedTransformationCostPerPiece)}
          </p>
          {form.simulationName.trim() ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Simulação: <span className="font-medium text-slate-800 dark:text-slate-200">{form.simulationName}</span>
            </p>
          ) : null}
        </div>
      </section>

      <details className="rounded-2xl border border-border bg-card p-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Info className="h-4 w-4 text-primary" />
          Como o cálculo funciona
        </summary>
        <div className="mt-4 space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <p>
            <strong>HH teórico</strong> = folha produtiva ÷ (pessoas × horas por pessoa).{" "}
            <strong>HH ajustado</strong> = folha ÷ horas produtivas ajustadas (teóricas × eficiência).
          </p>
          <p>
            <strong>HM teórico</strong> = energia ÷ (máquinas × horas por máquina).{" "}
            <strong>HM ajustado</strong> = energia ÷ horas máquina produtivas ajustadas.
          </p>
          <p>
            <strong>Custo hora transformação</strong> = HM ajustado + (HH ajustado × operadores).{" "}
            <strong>Ciclos/h</strong> = 3600 ÷ ciclo (s). <strong>Peças boas/h</strong> = ciclos/h ×
            cavidades × (1 − refugo).
          </p>
          <p>
            <strong>Custo por peça</strong> = custo hora transformação ÷ peças boas por hora.
          </p>
        </div>
      </details>
    </div>
  );
}
