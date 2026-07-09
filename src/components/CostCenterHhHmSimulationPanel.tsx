import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Calculator, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import {
  buildFinanceCostCentersListApiPath,
} from "@/src/lib/financeCostCentersPageTypes";
import {
  computeCostCenterHhHmSimulation,
  COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS,
  COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE,
  DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD,
  EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
  type CostCenterHhHmSimulationFormValues,
  type CostCenterHhHmSimulationHourType,
  type CostCenterMonthlyExpenseBucket,
} from "@/src/lib/financeCostCenterHhHmSimulation";
import { formatCurrency, formatNumber, cn } from "@/src/lib/utils";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const STORAGE_KEY = "induscost.cost-center-hh-hm-simulation.v1";

type MonthlyDataPayload = {
  periodLabel: string;
  metricsScope: string;
  monthlyBuckets: CostCenterMonthlyExpenseBucket[];
};

function loadStoredForm(): CostCenterHhHmSimulationFormValues {
  if (typeof window === "undefined") return EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        averagePeriod: DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD,
      };
    }
    const parsed = JSON.parse(raw) as Partial<CostCenterHhHmSimulationFormValues>;
    return { ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM, ...parsed };
  } catch {
    return EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM;
  }
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(INPUT_CLASS, disabled && "cursor-not-allowed bg-slate-50 text-slate-500")}
      />
    </div>
  );
}

export function CostCenterHhHmSimulationPanel() {
  const [form, setForm] = useState<CostCenterHhHmSimulationFormValues>(loadStoredForm);
  const [costCenters, setCostCenters] = useState<FinanceCostCenterDto[]>([]);
  const [costCentersLoading, setCostCentersLoading] = useState(true);
  const [costCentersError, setCostCentersError] = useState<string | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyDataPayload | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCostCentersLoading(true);
      try {
        const rows = (await fetchJsonOk(buildFinanceCostCentersListApiPath("ACTIVE"))) as FinanceCostCenterDto[];
        if (!cancelled) {
          setCostCenters(rows);
          setCostCentersError(null);
        }
      } catch {
        if (!cancelled) {
          setCostCenters([]);
          setCostCentersError("Não foi possível carregar os centros de custo.");
        }
      } finally {
        if (!cancelled) setCostCentersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    if (form.selectedCostCenterIds.length === 0 || form.averagePeriod === "MANUAL_VALUE") {
      setMonthlyData(null);
      setMonthlyError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setMonthlyLoading(true);
      try {
        const qs = new URLSearchParams({
          costCenterIds: form.selectedCostCenterIds.join(","),
          averagePeriod: form.averagePeriod,
          status: "all",
        });
        if (form.averagePeriod === "FILTERED_PERIOD") {
          if (form.filteredDueDateFrom.trim()) qs.set("dueDateFrom", form.filteredDueDateFrom.trim());
          if (form.filteredDueDateTo.trim()) qs.set("dueDateTo", form.filteredDueDateTo.trim());
        }
        const payload = (await fetchJsonOk(
          `/api/finance/cost-centers/hh-hm-simulation/monthly-data?${qs.toString()}`
        )) as MonthlyDataPayload;
        if (!cancelled) {
          setMonthlyData(payload);
          setMonthlyError(null);
        }
      } catch {
        if (!cancelled) {
          setMonthlyData(null);
          setMonthlyError("Não foi possível carregar a média mensal dos centros selecionados.");
        }
      } finally {
        if (!cancelled) setMonthlyLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [form.selectedCostCenterIds, form.averagePeriod, form.filteredDueDateFrom, form.filteredDueDateTo]);

  const simulation = useMemo(
    () =>
      computeCostCenterHhHmSimulation({
        form,
        monthlyBuckets: monthlyData?.monthlyBuckets ?? [],
      }),
    [form, monthlyData]
  );

  const patch = <K extends keyof CostCenterHhHmSimulationFormValues>(
    key: K,
    value: CostCenterHhHmSimulationFormValues[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleCostCenter = (costCenterId: string) => {
    setForm((prev) => {
      const selected = new Set(prev.selectedCostCenterIds);
      if (selected.has(costCenterId)) selected.delete(costCenterId);
      else selected.add(costCenterId);
      return { ...prev, selectedCostCenterIds: [...selected] };
    });
  };

  const hourLabel = form.hourType === "HH" ? "HH" : "HM";
  const manualMode = form.useManualRate || form.averagePeriod === "MANUAL_VALUE";

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-lg font-bold text-slate-900">Simulação HH/HM por Centro de Custo</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Taxa simulada = média mensal dos centros selecionados ÷ horas base mensais.{" "}
            {COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE}. Não altera custos oficiais.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["HH", "HM"] as CostCenterHhHmSimulationHourType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => patch("hourType", type)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-semibold transition-colors",
                  form.hourType === type
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
              >
                {type === "HH" ? "Mão de obra (HH)" : "Máquina (HM)"}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Período da média</label>
            <select
              value={form.averagePeriod}
              onChange={(e) =>
                patch(
                  "averagePeriod",
                  e.target.value as CostCenterHhHmSimulationFormValues["averagePeriod"]
                )
              }
              className={INPUT_CLASS}
            >
              {COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {form.averagePeriod === "FILTERED_PERIOD" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Vencimento de"
                value={form.filteredDueDateFrom}
                onChange={(value) => patch("filteredDueDateFrom", value)}
                type="date"
              />
              <Field
                label="Vencimento até"
                value={form.filteredDueDateTo}
                onChange={(value) => patch("filteredDueDateTo", value)}
                type="date"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Centros de custo selecionados</label>
            {costCentersLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando centros de custo...
              </div>
            ) : costCentersError ? (
              <p className="text-sm text-amber-800">{costCentersError}</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {costCenters.map((center) => {
                  const checked = form.selectedCostCenterIds.includes(center.id);
                  return (
                    <label
                      key={center.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCostCenter(center.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-800">
                        <span className="font-semibold">{center.code}</span> — {center.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <Field
            label="Horas base mensais (driver)"
            value={form.baseMonthlyHours}
            onChange={(value) => patch("baseMonthlyHours", value)}
            type="number"
            step="0.01"
            placeholder="Ex.: 4000"
            disabled={manualMode && form.averagePeriod === "MANUAL_VALUE"}
          />

          <Field
            label={`Quantidade de ${hourLabel} usada no item`}
            value={form.quantityUsedInItem}
            onChange={(value) => patch("quantityUsedInItem", value)}
            type="number"
            step="0.00001"
            placeholder="Ex.: 0.05"
          />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.useManualRate}
              onChange={(e) => patch("useManualRate", e.target.checked)}
              disabled={form.averagePeriod === "MANUAL_VALUE"}
            />
            Usar valor manual (R$/{hourLabel})
          </label>

          {(manualMode || form.useManualRate) && (
            <Field
              label={`Valor manual R$/${hourLabel}`}
              value={form.manualRatePerHour}
              onChange={(value) => patch("manualRatePerHour", value)}
              type="number"
              step="0.0001"
              placeholder="Ex.: 30"
            />
          )}

          <Field
            label="Observação"
            value={form.note}
            onChange={(value) => patch("note", value)}
            placeholder="Override ou contexto da simulação"
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Calculator className="h-4 w-4" />
              Composição do cálculo
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Período</dt>
                <dd className="font-medium text-slate-900">
                  {monthlyData?.periodLabel ??
                    COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS.find(
                      (row) => row.value === form.averagePeriod
                    )?.label}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Média mensal dos centros</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {simulation.composition.monthlyAverageAmount != null
                    ? formatCurrency(simulation.composition.monthlyAverageAmount)
                    : manualMode
                      ? "— (manual)"
                      : monthlyLoading
                        ? "Calculando..."
                        : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Horas base</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {simulation.composition.baseMonthlyHours != null
                    ? `${formatNumber(simulation.composition.baseMonthlyHours, 2)} h/mês`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Taxa calculada</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {simulation.composition.calculatedRatePerHour != null
                    ? `${formatCurrency(simulation.composition.calculatedRatePerHour)}/${hourLabel}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Taxa efetiva</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {simulation.composition.effectiveRatePerHour != null
                    ? `${formatCurrency(simulation.composition.effectiveRatePerHour)}/${hourLabel}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Quantidade no item</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {simulation.composition.quantityUsedInItem != null
                    ? `${formatNumber(simulation.composition.quantityUsedInItem, 5)} ${hourLabel}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
                <dt className="font-semibold text-slate-800">Impacto no custo do item</dt>
                <dd className="text-lg font-black tabular-nums text-emerald-800">
                  {simulation.composition.simulatedItemCost != null
                    ? formatCurrency(simulation.composition.simulatedItemCost, 5)
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>

          {monthlyLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando série mensal por vencimento...
            </div>
          ) : null}

          {monthlyError ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{monthlyError}</span>
            </div>
          ) : null}

          {simulation.warnings.map((warning) => (
            <div
              key={warning}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}

          {simulation.errors.map((error) => (
            <div
              key={error}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              {error}
            </div>
          ))}

          <p className="text-xs leading-relaxed text-slate-500">
            A média mensal considera todos os meses do período (incluindo meses zerados). Meses sem
            lançamentos reduzem a média e geram aviso. Use valor manual quando não houver dados
            suficientes.
          </p>
        </div>
      </div>
    </section>
  );
}
