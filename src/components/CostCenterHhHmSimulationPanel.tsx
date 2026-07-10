import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Calculator, ChevronDown, Loader2 } from "lucide-react";
import { CostCenterHhHmSimulationMultiselect } from "@/src/components/CostCenterHhHmSimulationMultiselect";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildCostCenterHhHmSimulationCostCentersApiPath,
  computeCostCenterHhHmDualRateSimulation,
  COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS,
  COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE,
  DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD,
  EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
  formatCostCenterHhHmSimulationSelectedLabels,
  normalizeCostCenterHhHmSimulationStoredForm,
  parseCostCenterHhHmSimulationCostCentersResponse,
  parseCostCenterHhHmSimulationMonthlyDataResponse,
  pruneCostCenterHhHmSimulationSelectedIds,
  type CostCenterHhHmSimulationCostCenterRow,
  type CostCenterHhHmSimulationFormValues,
  type CostCenterHhHmSimulationHourType,
  type CostCenterHhHmSimulationSideFormValues,
  type CostCenterHhHmSideSimulationResult,
  type CostCenterMonthlyExpenseBucket,
} from "@/src/lib/financeCostCenterHhHmSimulation";
import { formatCurrency, formatNumber, cn } from "@/src/lib/utils";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const STORAGE_KEY = "induscost.cost-center-hh-hm-simulation.v2";

type MonthlyDataPayload = {
  periodLabel: string;
  metricsScope: string;
  monthlyBuckets: CostCenterMonthlyExpenseBucket[];
};

type SideKey = "hh" | "hm";

function loadStoredForm(): CostCenterHhHmSimulationFormValues {
  if (typeof window === "undefined") return EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = window.localStorage.getItem("induscost.cost-center-hh-hm-simulation.v1");
      if (legacy) return normalizeCostCenterHhHmSimulationStoredForm(JSON.parse(legacy));
      return {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hh: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM.hh,
          averagePeriod: DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD,
        },
        hm: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM.hm,
          averagePeriod: DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD,
        },
      };
    }
    return normalizeCostCenterHhHmSimulationStoredForm(JSON.parse(raw));
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

function useMonthlyDataForSide(side: CostCenterHhHmSimulationSideFormValues) {
  const [monthlyData, setMonthlyData] = useState<MonthlyDataPayload | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  useEffect(() => {
    if (side.selectedCostCenterIds.length === 0 || side.averagePeriod === "MANUAL_VALUE") {
      setMonthlyData(null);
      setMonthlyError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setMonthlyLoading(true);
      try {
        const qs = new URLSearchParams({
          costCenterIds: side.selectedCostCenterIds.join(","),
          averagePeriod: side.averagePeriod,
          status: "all",
        });
        if (side.averagePeriod === "FILTERED_PERIOD") {
          if (side.filteredDueDateFrom.trim()) qs.set("dueDateFrom", side.filteredDueDateFrom.trim());
          if (side.filteredDueDateTo.trim()) qs.set("dueDateTo", side.filteredDueDateTo.trim());
        }
        const payload = await fetchJsonOk(
          `/api/finance/cost-centers/hh-hm-simulation/monthly-data?${qs.toString()}`
        );
        const parsed = parseCostCenterHhHmSimulationMonthlyDataResponse(payload);
        if (!cancelled) {
          if (!parsed.ok) {
            setMonthlyData(null);
            setMonthlyError(parsed.message);
          } else {
            setMonthlyData({
              periodLabel: parsed.periodLabel,
              metricsScope: parsed.metricsScope,
              monthlyBuckets: parsed.monthlyBuckets,
            });
            setMonthlyError(null);
          }
        }
      } catch (error) {
        console.error("CostCenterHhHmSimulation: falha ao carregar média mensal", error);
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
  }, [
    side.selectedCostCenterIds,
    side.averagePeriod,
    side.filteredDueDateFrom,
    side.filteredDueDateTo,
  ]);

  return { monthlyData, monthlyLoading, monthlyError };
}

function SideCalculationBlock({
  sideKey,
  title,
  hourType,
  side,
  costCenters,
  costCentersLoading,
  costCentersError,
  onRetryCostCenters,
  onPatch,
  monthlyData,
  monthlyLoading,
  monthlyError,
  sideResult,
}: {
  sideKey: SideKey;
  title: string;
  hourType: CostCenterHhHmSimulationHourType;
  side: CostCenterHhHmSimulationSideFormValues;
  costCenters: CostCenterHhHmSimulationCostCenterRow[];
  costCentersLoading: boolean;
  costCentersError: string | null;
  onRetryCostCenters: () => void;
  onPatch: <K extends keyof CostCenterHhHmSimulationSideFormValues>(
    key: K,
    value: CostCenterHhHmSimulationSideFormValues[K]
  ) => void;
  monthlyData: MonthlyDataPayload | null;
  monthlyLoading: boolean;
  monthlyError: string | null;
  sideResult: CostCenterHhHmSideSimulationResult;
}) {
  const manualMode = side.useManualRate || side.averagePeriod === "MANUAL_VALUE";
  const selectedCentersLabel = formatCostCenterHhHmSimulationSelectedLabels(
    side.selectedCostCenterIds,
    costCenters
  );

  return (
    <div
      className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4"
      data-hh-hm-side={sideKey}
    >
      <h3 className="text-base font-bold text-slate-900">{title}</h3>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Período da média</label>
        <select
          value={side.averagePeriod}
          onChange={(e) =>
            onPatch(
              "averagePeriod",
              e.target.value as CostCenterHhHmSimulationSideFormValues["averagePeriod"]
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

      {side.averagePeriod === "FILTERED_PERIOD" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Vencimento de"
            value={side.filteredDueDateFrom}
            onChange={(value) => onPatch("filteredDueDateFrom", value)}
            type="date"
          />
          <Field
            label="Vencimento até"
            value={side.filteredDueDateTo}
            onChange={(value) => onPatch("filteredDueDateTo", value)}
            type="date"
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">
          Centros de custo para {hourType}
        </label>
        <CostCenterHhHmSimulationMultiselect
          options={costCenters}
          selectedIds={side.selectedCostCenterIds}
          onChange={(selectedCostCenterIds) => onPatch("selectedCostCenterIds", selectedCostCenterIds)}
          hourType={hourType}
          loading={costCentersLoading}
          error={costCentersError}
          onRetry={onRetryCostCenters}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label={hourType === "HH" ? "Pessoas produtivas" : "Máquinas produtivas"}
          value={side.productiveCount}
          onChange={(value) => onPatch("productiveCount", value)}
          type="number"
          step="1"
          placeholder={hourType === "HH" ? "Ex.: 60" : "Ex.: 13"}
          disabled={manualMode && side.averagePeriod === "MANUAL_VALUE"}
        />
        <Field
          label={hourType === "HH" ? "Horas mensais por pessoa" : "Horas mensais por máquina"}
          value={side.hoursPerUnit}
          onChange={(value) => onPatch("hoursPerUnit", value)}
          type="number"
          step="0.01"
          placeholder="Ex.: 180"
          disabled={manualMode && side.averagePeriod === "MANUAL_VALUE"}
        />
        <Field
          label={
            hourType === "HH"
              ? "Eficiência produtiva da mão de obra (%)"
              : "Eficiência produtiva das máquinas (%)"
          }
          value={side.efficiencyPercent}
          onChange={(value) => onPatch("efficiencyPercent", value)}
          type="number"
          step="0.01"
          placeholder="Ex.: 80"
          disabled={manualMode && side.averagePeriod === "MANUAL_VALUE"}
        />
      </div>

      <details className="rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
          Configuração avançada — informar horas base manualmente
        </summary>
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={side.useManualBaseHours}
              onChange={(e) => onPatch("useManualBaseHours", e.target.checked)}
              disabled={manualMode && side.averagePeriod === "MANUAL_VALUE"}
            />
            Informar horas base manualmente
          </label>
          {side.useManualBaseHours ? (
            <Field
              label={`Horas base mensais ${hourType} (driver)`}
              value={side.baseMonthlyHours}
              onChange={(value) => onPatch("baseMonthlyHours", value)}
              type="number"
              step="0.01"
              placeholder="Ex.: 8640"
              disabled={manualMode && side.averagePeriod === "MANUAL_VALUE"}
            />
          ) : null}
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={side.useManualRate}
          onChange={(e) => onPatch("useManualRate", e.target.checked)}
          disabled={side.averagePeriod === "MANUAL_VALUE"}
        />
        Usar taxa manual de {hourType}
      </label>

      {(manualMode || side.useManualRate) && (
        <Field
          label={`Taxa manual R$/${hourType}`}
          value={side.manualRatePerHour}
          onChange={(value) => onPatch("manualRatePerHour", value)}
          type="number"
          step="0.0001"
          placeholder="Ex.: 38"
        />
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {hourType === "HH" ? "Horas homem teóricas" : "Horas máquina teóricas"}
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
            {sideResult.composition.theoreticalHours != null
              ? `${formatNumber(sideResult.composition.theoreticalHours, 2)} h`
              : "—"}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {hourType === "HH" ? "Horas HH ajustadas" : "Horas HM ajustadas"}
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
            {sideResult.composition.adjustedHours != null
              ? `${formatNumber(sideResult.composition.adjustedHours, 2)} h`
              : "—"}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Média mensal
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
            {sideResult.composition.monthlyAverageAmount != null
              ? formatCurrency(sideResult.composition.monthlyAverageAmount)
              : manualMode
                ? "— (manual)"
                : monthlyLoading
                  ? "…"
                  : "—"}
          </p>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            Taxa {hourType}
          </p>
          <p className="mt-1 text-sm font-black tabular-nums text-emerald-950">
            {sideResult.composition.effectiveRatePerHour != null
              ? `${formatCurrency(sideResult.composition.effectiveRatePerHour)}/${hourType}`
              : "—"}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Período</dt>
            <dd className="text-right font-medium text-slate-900">
              {monthlyData?.periodLabel ??
                COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS.find(
                  (row) => row.value === side.averagePeriod
                )?.label}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-slate-600">Centros</dt>
            <dd className="max-w-[55%] text-right text-xs font-medium leading-relaxed text-slate-900">
              {selectedCentersLabel}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">
              {hourType === "HH" ? "Pessoas produtivas" : "Máquinas produtivas"}
            </dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {sideResult.composition.productiveCount != null
                ? formatNumber(sideResult.composition.productiveCount, 0)
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Eficiência</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {sideResult.composition.efficiencyPercent != null
                ? `${formatNumber(sideResult.composition.efficiencyPercent, 0)}%`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1.5">
            <dt className="font-semibold text-slate-800">Taxa {hourType}</dt>
            <dd className="font-bold tabular-nums text-slate-900">
              {sideResult.composition.effectiveRatePerHour != null
                ? `${formatCurrency(sideResult.composition.effectiveRatePerHour)}/${hourType}`
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

      {sideResult.warnings.map((warning) => (
        <div
          key={warning}
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}

      {sideResult.errors.map((error) => (
        <div
          key={error}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          {error}
        </div>
      ))}
    </div>
  );
}

export function CostCenterHhHmSimulationPanel() {
  const [form, setForm] = useState<CostCenterHhHmSimulationFormValues>(loadStoredForm);
  const [costCenters, setCostCenters] = useState<CostCenterHhHmSimulationCostCenterRow[]>([]);
  const [costCentersLoading, setCostCentersLoading] = useState(true);
  const [costCentersError, setCostCentersError] = useState<string | null>(null);
  const [costCentersReloadKey, setCostCentersReloadKey] = useState(0);

  const loadCostCenters = useCallback(async (cancelled: () => boolean) => {
    setCostCentersLoading(true);
    try {
      const payload = await fetchJsonOk(buildCostCenterHhHmSimulationCostCentersApiPath("ACTIVE"));
      if (cancelled()) return;
      const parsed = parseCostCenterHhHmSimulationCostCentersResponse(payload);
      if (parsed.invalidShape) {
        console.error("CostCenterHhHmSimulation: payload inválido de centros de custo", payload);
        setCostCenters([]);
        setCostCentersError(
          "Não foi possível interpretar a lista de centros de custo. Tente novamente."
        );
        return;
      }
      setCostCenters(parsed.items);
      setCostCentersError(null);
      setForm((prev) => {
        const pruneSide = (side: CostCenterHhHmSimulationSideFormValues) =>
          pruneCostCenterHhHmSimulationSelectedIds(
            side.selectedCostCenterIds,
            parsed.items.map((row) => row.id)
          );
        const hhPruned = pruneSide(prev.hh);
        const hmPruned = pruneSide(prev.hm);
        if (
          hhPruned.length === prev.hh.selectedCostCenterIds.length &&
          hmPruned.length === prev.hm.selectedCostCenterIds.length
        ) {
          return prev;
        }
        return { ...prev, hh: { ...prev.hh, selectedCostCenterIds: hhPruned }, hm: { ...prev.hm, selectedCostCenterIds: hmPruned } };
      });
    } catch (error) {
      console.error("CostCenterHhHmSimulation: falha ao carregar centros de custo", error);
      if (!cancelled()) {
        setCostCenters([]);
        setCostCentersError(
          "Não foi possível carregar os centros de custo. Verifique sua permissão ou tente novamente."
        );
      }
    } finally {
      if (!cancelled()) setCostCentersLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadCostCenters(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadCostCenters, costCentersReloadKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const hhMonthly = useMonthlyDataForSide(form.hh);
  const hmMonthly = useMonthlyDataForSide(form.hm);

  const simulation = useMemo(
    () =>
      computeCostCenterHhHmDualRateSimulation({
        form,
        monthlyBucketsHh: hhMonthly.monthlyData?.monthlyBuckets ?? [],
        monthlyBucketsHm: hmMonthly.monthlyData?.monthlyBuckets ?? [],
      }),
    [form, hhMonthly.monthlyData, hmMonthly.monthlyData]
  );

  const patchSide = (
    sideKey: SideKey,
    key: keyof CostCenterHhHmSimulationSideFormValues,
    value: CostCenterHhHmSimulationSideFormValues[typeof key]
  ) => {
    setForm((prev) => ({
      ...prev,
      [sideKey]: { ...prev[sideKey], [key]: value },
    }));
  };

  const patchRoot = <K extends keyof CostCenterHhHmSimulationFormValues>(
    key: K,
    value: CostCenterHhHmSimulationFormValues[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-lg font-bold text-slate-900">Simulação HH/HM por Centro de Custo</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Calcule a taxa final de HH e HM a partir da média mensal dos centros de custo
            selecionados. Esta simulação não altera custos oficiais.{" "}
            {COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE}.
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SideCalculationBlock
          sideKey="hh"
          title="Cálculo da taxa HH (Hora Homem)"
          hourType="HH"
          side={form.hh}
          costCenters={costCenters}
          costCentersLoading={costCentersLoading}
          costCentersError={costCentersError}
          onRetryCostCenters={() => setCostCentersReloadKey((value) => value + 1)}
          onPatch={(key, value) => patchSide("hh", key, value)}
          monthlyData={hhMonthly.monthlyData}
          monthlyLoading={hhMonthly.monthlyLoading}
          monthlyError={hhMonthly.monthlyError}
          sideResult={simulation.hh}
        />
        <SideCalculationBlock
          sideKey="hm"
          title="Cálculo da taxa HM (Hora Máquina)"
          hourType="HM"
          side={form.hm}
          costCenters={costCenters}
          costCentersLoading={costCentersLoading}
          costCentersError={costCentersError}
          onRetryCostCenters={() => setCostCentersReloadKey((value) => value + 1)}
          onPatch={(key, value) => patchSide("hm", key, value)}
          monthlyData={hmMonthly.monthlyData}
          monthlyLoading={hmMonthly.monthlyLoading}
          monthlyError={hmMonthly.monthlyError}
          sideResult={simulation.hm}
        />
      </div>

      <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <Calculator className="h-4 w-4" />
          Resultado final — taxas HH e HM
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-100 bg-white p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-600">Taxa HH</dt>
            <dd className="mt-1 text-xl font-black tabular-nums text-slate-900">
              {simulation.hh.composition.effectiveRatePerHour != null
                ? `${formatCurrency(simulation.hh.composition.effectiveRatePerHour)}/HH`
                : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-white p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-600">Taxa HM</dt>
            <dd className="mt-1 text-xl font-black tabular-nums text-slate-900">
              {simulation.hm.composition.effectiveRatePerHour != null
                ? `${formatCurrency(simulation.hm.composition.effectiveRatePerHour)}/HM`
                : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-100/50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
              Taxa final HH + HM
            </dt>
            <dd className="mt-1 text-2xl font-black tabular-nums text-emerald-950">
              {simulation.combinedRatePerHour != null
                ? formatCurrency(simulation.combinedRatePerHour)
                : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-800">Composição do cálculo</div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Período HH</dt>
            <dd className="font-medium text-slate-900 text-right">
              {hhMonthly.monthlyData?.periodLabel ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Período HM</dt>
            <dd className="font-medium text-slate-900 text-right">
              {hmMonthly.monthlyData?.periodLabel ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Centros HH</dt>
            <dd className="max-w-[55%] text-right text-xs font-medium text-slate-900">
              {formatCostCenterHhHmSimulationSelectedLabels(form.hh.selectedCostCenterIds, costCenters)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Centros HM</dt>
            <dd className="max-w-[55%] text-right text-xs font-medium text-slate-900">
              {formatCostCenterHhHmSimulationSelectedLabels(form.hm.selectedCostCenterIds, costCenters)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Pessoas produtivas</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {simulation.hh.composition.productiveCount != null
                ? formatNumber(simulation.hh.composition.productiveCount, 0)
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Máquinas produtivas</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {simulation.hm.composition.productiveCount != null
                ? formatNumber(simulation.hm.composition.productiveCount, 0)
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Horas/pessoa · eficiência HH</dt>
            <dd className="font-medium tabular-nums text-slate-900 text-right">
              {simulation.hh.composition.hoursPerUnit != null
                ? `${formatNumber(simulation.hh.composition.hoursPerUnit, 0)} h`
                : "—"}
              {" · "}
              {simulation.hh.composition.efficiencyPercent != null
                ? `${formatNumber(simulation.hh.composition.efficiencyPercent, 0)}%`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Horas/máquina · eficiência HM</dt>
            <dd className="font-medium tabular-nums text-slate-900 text-right">
              {simulation.hm.composition.hoursPerUnit != null
                ? `${formatNumber(simulation.hm.composition.hoursPerUnit, 0)} h`
                : "—"}
              {" · "}
              {simulation.hm.composition.efficiencyPercent != null
                ? `${formatNumber(simulation.hm.composition.efficiencyPercent, 0)}%`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Horas HH teóricas / ajustadas</dt>
            <dd className="font-medium tabular-nums text-slate-900 text-right">
              {simulation.hh.composition.theoreticalHours != null
                ? formatNumber(simulation.hh.composition.theoreticalHours, 2)
                : "—"}
              {" / "}
              {simulation.hh.composition.adjustedHours != null
                ? `${formatNumber(simulation.hh.composition.adjustedHours, 2)} h`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Horas HM teóricas / ajustadas</dt>
            <dd className="font-medium tabular-nums text-slate-900 text-right">
              {simulation.hm.composition.theoreticalHours != null
                ? formatNumber(simulation.hm.composition.theoreticalHours, 2)
                : "—"}
              {" / "}
              {simulation.hm.composition.adjustedHours != null
                ? `${formatNumber(simulation.hm.composition.adjustedHours, 2)} h`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Média mensal HH</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {simulation.hh.composition.monthlyAverageAmount != null
                ? formatCurrency(simulation.hh.composition.monthlyAverageAmount)
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Média mensal HM</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {simulation.hm.composition.monthlyAverageAmount != null
                ? formatCurrency(simulation.hm.composition.monthlyAverageAmount)
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Taxa HH</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {simulation.hh.composition.effectiveRatePerHour != null
                ? `${formatCurrency(simulation.hh.composition.effectiveRatePerHour)}/HH`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Taxa HM</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {simulation.hm.composition.effectiveRatePerHour != null
                ? `${formatCurrency(simulation.hm.composition.effectiveRatePerHour)}/HM`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 md:col-span-2 border-t border-slate-200 pt-2">
            <dt className="font-semibold text-slate-800">Taxa final HH + HM</dt>
            <dd className="text-lg font-black tabular-nums text-emerald-800">
              {simulation.combinedRatePerHour != null
                ? formatCurrency(simulation.combinedRatePerHour)
                : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <details
        className="mb-4 rounded-lg border border-slate-200 bg-white"
        open={form.itemApplicationOpen}
        onToggle={(event) =>
          patchRoot("itemApplicationOpen", (event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
          <span>Aplicar taxa em uma peça/item (opcional)</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        </summary>
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          <p className="text-xs leading-relaxed text-slate-500">
            Use apenas para estimar o impacto em uma peça específica. Não altera custos oficiais do
            produto.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Quantidade de HH na peça"
              value={form.quantityHhInItem}
              onChange={(value) => patchRoot("quantityHhInItem", value)}
              type="number"
              step="0.00001"
              placeholder="Ex.: 0.05"
            />
            <Field
              label="Quantidade de HM na peça"
              value={form.quantityHmInItem}
              onChange={(value) => patchRoot("quantityHmInItem", value)}
              type="number"
              step="0.00001"
              placeholder="Ex.: 0.02"
            />
          </div>
          <div className="flex justify-between gap-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Estimativa na peça (HH + HM)</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {simulation.optionalItemImpact != null
                ? formatCurrency(simulation.optionalItemImpact, 5)
                : "—"}
            </span>
          </div>
        </div>
      </details>

      <Field
        label="Observação"
        value={form.note}
        onChange={(value) => patchRoot("note", value)}
        placeholder="Contexto da simulação"
      />

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        A média mensal considera todos os meses do período (incluindo meses zerados). Meses sem
        lançamentos reduzem a média e geram aviso. Use valor manual quando não houver dados
        suficientes para calcular a taxa.
      </p>
    </section>
  );
}
