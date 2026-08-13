/**
 * Metas (OKR) — Wizard de criação em 4 passos ("Esconder a Complexidade").
 *
 * O usuário nunca lê "banco", "agregação" ou "join": o Passo 2 é um jogo de
 * completar frases cujos blocos vêm do dicionário público de metadados
 * (chaves + rótulos leigos). O JSON lógico é montado em background e o
 * backend valida tudo de novo (o front nunca é autoridade).
 */

import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { renderInPortal } from "@/src/lib/renderInPortal.js";
import { fetchJsonOk } from "@/src/lib/http.js";
import {
  GOAL_TRACKING_TYPES,
  GOAL_TRACKING_TYPE_LABELS,
  type GoalDto,
  type GoalTrackingTypeValue,
} from "@/src/lib/goals/goalContracts.js";

export type GoalMetadataPublicEntity = {
  key: string;
  label: string;
  domain: string;
  supportsQuotaSplit: boolean;
  metrics: Array<{
    key: string;
    label: string;
    operation: string;
    operationLabel: string;
    suggestedUnit: string | null;
    periodLabel: string;
  }>;
  filterFields: Array<{
    key: string;
    label: string;
    type: "ENUM" | "TEXT" | "NUMBER";
    operators: Array<{ value: string; label: string }>;
    options: Array<{ value: string; label: string }> | null;
  }>;
};

type OwnerOption = { id: string; name: string };

type WizardFilter = {
  id: string;
  fieldKey: string;
  operator: string;
  value: string;
  connector: "AND" | "OR";
};

type WizardQuota = {
  id: string;
  assignedAppUserId: string;
  quotaValue: string;
};

const STEP_TITLES = [
  "Onde queremos chegar?",
  "Como vamos medir o sucesso disso?",
  "Qual é a linha de chegada?",
  "Quem vai te ajudar a bater essa meta?",
] as const;

const fieldClass =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm";
const labelClass = "text-[11px] font-semibold text-muted-foreground";

/** Bloco clicável da frase interativa (dropdown disfarçado). */
function PhraseSelect({
  value,
  onChange,
  options,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  testId?: string;
}) {
  return (
    <select
      className="mx-0.5 inline-block max-w-[240px] rounded-md border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-sm font-semibold text-primary"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function formatNumberBr(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function GoalWizardDialog({
  owners,
  metadataEntities,
  onCancel,
  onCreated,
}: {
  owners: OwnerOption[];
  metadataEntities: GoalMetadataPublicEntity[];
  onCancel: () => void;
  onCreated: (goal: GoalDto) => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Passo 1 — Direção.
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [ownerAppUserId, setOwnerAppUserId] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");

  // Passo 2 — Medição (frase interativa) OU manual.
  const [measureMode, setMeasureMode] = useState<"AUTO" | "MANUAL">("AUTO");
  const [entityKey, setEntityKey] = useState("");
  const [metricKey, setMetricKey] = useState("");
  const [filters, setFilters] = useState<WizardFilter[]>([]);
  const [krTitle, setKrTitle] = useState("");

  // Passo 3 — Alvo.
  const [trackingType, setTrackingType] = useState<GoalTrackingTypeValue>("INCREASE");
  const [baseline, setBaseline] = useState("0");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");

  // Passo 4 — Equipe (quotas).
  const [quotas, setQuotas] = useState<WizardQuota[]>([]);
  const [quotaSearch, setQuotaSearch] = useState("");

  const entity = useMemo(
    () => metadataEntities.find((e) => e.key === entityKey) ?? null,
    [metadataEntities, entityKey]
  );
  const metric = useMemo(
    () => entity?.metrics.find((m) => m.key === metricKey) ?? null,
    [entity, metricKey]
  );

  const filteredOwners = useMemo(() => {
    const term = ownerSearch.trim().toLowerCase();
    if (!term) return owners;
    return owners.filter((o) => o.name.toLowerCase().includes(term));
  }, [owners, ownerSearch]);

  const quotaCandidates = useMemo(() => {
    const term = quotaSearch.trim().toLowerCase();
    const chosen = new Set(quotas.map((q) => q.assignedAppUserId));
    return owners.filter(
      (o) => !chosen.has(o.id) && (!term || o.name.toLowerCase().includes(term))
    );
  }, [owners, quotaSearch, quotas]);

  const targetNumber = Number(target.replace(",", "."));
  const baselineNumber = Number(baseline.replace(",", "."));
  const quotasSum = quotas.reduce(
    (sum, q) => sum + (Number(q.quotaValue.replace(",", ".")) || 0),
    0
  );
  const quotasOverTarget =
    Number.isFinite(targetNumber) && quotasSum > targetNumber + 1e-9;
  const quotasExact =
    Number.isFinite(targetNumber) &&
    quotas.length > 0 &&
    Math.abs(quotasSum - targetNumber) < 1e-9;

  const stepValid = [
    Boolean(title.trim() && startDate && endDate && endDate >= startDate && ownerAppUserId),
    measureMode === "MANUAL"
      ? Boolean(krTitle.trim())
      : Boolean(
          entityKey &&
            metricKey &&
            filters.every((f) => f.fieldKey && f.operator && (f.operator === "IS_EMPTY" || f.value.trim()))
        ),
    Boolean(
      baseline.trim() !== "" &&
        target.trim() !== "" &&
        Number.isFinite(baselineNumber) &&
        Number.isFinite(targetNumber) &&
        baselineNumber !== targetNumber
    ),
    !quotasOverTarget,
  ][step]!;

  function addFilter() {
    setFilters((prev) => [
      ...prev,
      {
        id: `f-${Date.now()}-${prev.length}`,
        fieldKey: "",
        operator: "",
        value: "",
        connector: prev.length === 0 ? "AND" : "AND",
      },
    ]);
  }

  function updateFilter(id: string, patch: Partial<WizardFilter>) {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function addQuota(ownerId: string) {
    setQuotas((prev) => [
      ...prev,
      { id: `q-${Date.now()}-${prev.length}`, assignedAppUserId: ownerId, quotaValue: "" },
    ]);
    setQuotaSearch("");
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        goal: {
          title,
          description: null,
          startDate,
          endDate,
          status: "ACTIVE",
          ownerAppUserId,
        },
        keyResult: {
          title:
            measureMode === "MANUAL"
              ? krTitle
              : krTitle.trim() || metric?.label || "Indicador",
          domain: entity?.domain ?? "OUTROS",
          trackingType,
          baseline: baseline.replace(",", "."),
          target: target.replace(",", "."),
          unit: unit || metric?.suggestedUnit || null,
          weight: "1",
          ownerAppUserId,
          rule:
            measureMode === "AUTO" && entityKey && metricKey
              ? {
                  entityKey,
                  metricKey,
                  filters: filters.map((f) => ({
                    fieldKey: f.fieldKey,
                    operator: f.operator,
                    value: f.operator === "IS_EMPTY" ? null : f.value,
                    connector: f.connector,
                  })),
                }
              : null,
        },
        quotas: quotas
          .filter((q) => q.quotaValue.trim() !== "")
          .map((q) => ({
            assignedAppUserId: q.assignedAppUserId,
            quotaValue: q.quotaValue.replace(",", "."),
          })),
      };
      const res = await fetchJsonOk<{ goal: GoalDto }>("/api/goals/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onCreated(res.goal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar a meta.");
    } finally {
      setBusy(false);
    }
  }

  const gap =
    Number.isFinite(targetNumber) && Number.isFinite(baselineNumber)
      ? targetNumber - baselineNumber
      : null;

  return renderInPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="goal-wizard"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
        {/* Barra de progresso do wizard (1 de 4) */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Passo {step + 1} de 4 — {["Direção", "Medição", "Alvo", "Equipe"][step]}
            </span>
            <button type="button" className="hover:text-foreground" onClick={onCancel}>
              Cancelar
            </button>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
        </div>

        <h2 className="mb-3 text-lg font-semibold">{STEP_TITLES[step]}</h2>

        {step === 0 ? (
          <div className="space-y-3" data-testid="wizard-step-direction">
            <label className="block space-y-1">
              <span className={labelClass}>Dê um nome para o seu objetivo</span>
              <input
                className={fieldClass}
                placeholder='Ex.: "Dominar a Tração Comercial em 2026"'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="wizard-title"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className={labelClass}>Começa em</span>
                <input
                  type="date"
                  className={fieldClass}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Termina em</span>
                <input
                  type="date"
                  className={fieldClass}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </div>
            <div className="space-y-1">
              <span className={labelClass}>Quem é o dono desse objetivo?</span>
              <input
                className={fieldClass}
                placeholder="Busque pelo nome…"
                value={ownerSearch}
                onChange={(e) => setOwnerSearch(e.target.value)}
              />
              <div className="max-h-36 overflow-y-auto rounded border border-border">
                {filteredOwners.slice(0, 8).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted",
                      ownerAppUserId === o.id && "bg-primary/10 font-semibold"
                    )}
                    onClick={() => setOwnerAppUserId(o.id)}
                    data-testid={`wizard-owner-${o.id}`}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                      {o.name
                        .split(" ")
                        .slice(0, 2)
                        .map((p) => p[0])
                        .join("")
                        .toUpperCase()}
                    </span>
                    {o.name}
                    {ownerAppUserId === o.id ? (
                      <Check className="ml-auto h-4 w-4 text-primary" aria-hidden />
                    ) : null}
                  </button>
                ))}
                {filteredOwners.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    Ninguém encontrado com esse nome.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3" data-testid="wizard-step-measure">
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1 font-medium",
                  measureMode === "AUTO"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                )}
                onClick={() => setMeasureMode("AUTO")}
              >
                <Sparkles className="mr-1 inline h-3 w-3" aria-hidden />
                O sistema mede sozinho
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1 font-medium",
                  measureMode === "MANUAL"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                )}
                onClick={() => setMeasureMode("MANUAL")}
                data-testid="wizard-mode-manual"
              >
                Eu mesmo informo o número
              </button>
            </div>

            {measureMode === "AUTO" ? (
              <>
                {/* A frase interativa (Mad Libs) */}
                <p
                  className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-8"
                  data-testid="wizard-phrase"
                >
                  Eu quero acompanhar{" "}
                  <PhraseSelect
                    value={metricKey}
                    onChange={setMetricKey}
                    options={(entity?.metrics ?? []).map((m) => ({
                      value: m.key,
                      label: `${m.operationLabel} de "${m.label}"`,
                    }))}
                    placeholder={entity ? "escolha o indicador" : "…"}
                    testId="wizard-metric"
                  />{" "}
                  olhando para a área de{" "}
                  <PhraseSelect
                    value={entityKey}
                    onChange={(v) => {
                      setEntityKey(v);
                      setMetricKey("");
                      setFilters([]);
                    }}
                    options={metadataEntities.map((e) => ({ value: e.key, label: e.label }))}
                    placeholder="escolha a área"
                    testId="wizard-entity"
                  />
                  .
                  {metric ? (
                    <span className="block text-[11px] text-muted-foreground">
                      O período considerado é a {metric.periodLabel}, dentro das datas do
                      seu objetivo.
                    </span>
                  ) : null}
                </p>

                {/* Regras de exceção empilhadas */}
                {filters.map((filter, index) => {
                  const field = entity?.filterFields.find((f) => f.key === filter.fieldKey);
                  return (
                    <p
                      key={filter.id}
                      className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm leading-8"
                      data-testid={`wizard-filter-${index}`}
                    >
                      {index === 0 ? (
                        "Mas apenas considerar quando "
                      ) : (
                        <PhraseSelect
                          value={filter.connector}
                          onChange={(v) =>
                            updateFilter(filter.id, { connector: v as "AND" | "OR" })
                          }
                          options={[
                            { value: "AND", label: "e também quando" },
                            { value: "OR", label: "ou então quando" },
                          ]}
                          placeholder="…"
                        />
                      )}{" "}
                      <PhraseSelect
                        value={filter.fieldKey}
                        onChange={(v) =>
                          updateFilter(filter.id, { fieldKey: v, operator: "", value: "" })
                        }
                        options={(entity?.filterFields ?? []).map((f) => ({
                          value: f.key,
                          label: f.label,
                        }))}
                        placeholder="escolha o campo"
                      />{" "}
                      <PhraseSelect
                        value={filter.operator}
                        onChange={(v) => updateFilter(filter.id, { operator: v })}
                        options={(field?.operators ?? []).map((op) => ({
                          value: op.value,
                          label: op.label,
                        }))}
                        placeholder="condição"
                      />{" "}
                      {filter.operator !== "IS_EMPTY" && field ? (
                        field.type === "ENUM" ? (
                          <PhraseSelect
                            value={filter.value}
                            onChange={(v) => updateFilter(filter.id, { value: v })}
                            options={field.options ?? []}
                            placeholder="escolha o valor"
                          />
                        ) : (
                          <input
                            className="mx-0.5 inline-block w-40 rounded-md border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-sm font-semibold text-primary"
                            placeholder={field.type === "NUMBER" ? "número" : "texto"}
                            value={filter.value}
                            onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                          />
                        )
                      ) : null}
                      <button
                        type="button"
                        className="ml-2 text-[11px] text-muted-foreground hover:text-red-600"
                        onClick={() => setFilters((prev) => prev.filter((f) => f.id !== filter.id))}
                      >
                        remover
                      </button>
                    </p>
                  );
                })}

                {entity ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={addFilter}
                    data-testid="wizard-add-filter"
                  >
                    + Adicionar uma regra de exceção
                  </button>
                ) : null}

                <label className="block space-y-1 pt-1">
                  <span className={labelClass}>
                    Nome do indicador (opcional — sugerimos o da medição)
                  </span>
                  <input
                    className={fieldClass}
                    placeholder={metric?.label ?? "Ex.: Faturamento físico"}
                    value={krTitle}
                    onChange={(e) => setKrTitle(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <div className="space-y-2">
                <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Sem medição automática: você (ou a equipe) lança o número realizado
                  de tempos em tempos, e o painel acompanha do mesmo jeito.
                </p>
                <label className="block space-y-1">
                  <span className={labelClass}>Nome do indicador</span>
                  <input
                    className={fieldClass}
                    placeholder='Ex.: "Satisfação dos clientes (NPS)"'
                    value={krTitle}
                    onChange={(e) => setKrTitle(e.target.value)}
                    data-testid="wizard-kr-title"
                  />
                </label>
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3" data-testid="wizard-step-target">
            <div className="grid grid-cols-3 gap-2">
              <label className="block space-y-1">
                <span className={labelClass}>Nós estamos partindo de</span>
                <input
                  className={fieldClass}
                  value={baseline}
                  onChange={(e) => setBaseline(e.target.value)}
                  data-testid="wizard-baseline"
                />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Nós queremos chegar em</span>
                <input
                  className={fieldClass}
                  placeholder="Ex.: 100000"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  data-testid="wizard-target"
                />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>O formato é em</span>
                <input
                  className={fieldClass}
                  placeholder={metric?.suggestedUnit ?? "R$, un, %…"}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className={labelClass}>Direção da meta</span>
              <select
                className={fieldClass}
                value={trackingType}
                onChange={(e) => setTrackingType(e.target.value as GoalTrackingTypeValue)}
              >
                {GOAL_TRACKING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {GOAL_TRACKING_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            {gap != null && Number.isFinite(gap) && gap !== 0 ? (
              <p
                className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E40AF]"
                data-testid="wizard-gap-hint"
              >
                Isso significa que você precisa de{" "}
                <strong>
                  {gap > 0 ? "+" : "−"}
                  {formatNumberBr(Math.abs(gap))} {unit || metric?.suggestedUnit || ""}
                </strong>{" "}
                para bater a meta.
              </p>
            ) : null}
            {baseline.trim() !== "" &&
            target.trim() !== "" &&
            baselineNumber === targetNumber ? (
              <p className="text-xs text-red-600">
                O alvo precisa ser diferente do ponto de partida.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3" data-testid="wizard-step-team">
            <p className="text-xs text-muted-foreground">
              Opcional: divida o alvo em fatias nominais. Cada pessoa enxerga a
              própria fatia no painel.
            </p>
            <input
              className={fieldClass}
              placeholder="Busque pelo nome para adicionar…"
              value={quotaSearch}
              onChange={(e) => setQuotaSearch(e.target.value)}
              data-testid="wizard-quota-search"
            />
            {quotaSearch.trim() ? (
              <div className="max-h-28 overflow-y-auto rounded border border-border">
                {quotaCandidates.slice(0, 6).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => addQuota(o.id)}
                  >
                    + {o.name}
                  </button>
                ))}
              </div>
            ) : null}

            {quotas.map((quota) => {
              const person = owners.find((o) => o.id === quota.assignedAppUserId);
              const value = Number(quota.quotaValue.replace(",", ".")) || 0;
              const percent =
                Number.isFinite(targetNumber) && targetNumber !== 0
                  ? Math.round((value / targetNumber) * 100)
                  : 0;
              return (
                <div
                  key={quota.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {person?.name ?? "—"}
                  </span>
                  <input
                    className="w-28 rounded border border-border px-1.5 py-0.5 text-right text-sm tabular-nums"
                    placeholder="valor"
                    value={quota.quotaValue}
                    onChange={(e) =>
                      setQuotas((prev) =>
                        prev.map((q) =>
                          q.id === quota.id ? { ...q, quotaValue: e.target.value } : q
                        )
                      )
                    }
                  />
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                    {percent}%
                  </span>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-red-600"
                    onClick={() => setQuotas((prev) => prev.filter((q) => q.id !== quota.id))}
                  >
                    remover
                  </button>
                </div>
              );
            })}

            {quotas.length > 0 ? (
              <p
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-medium",
                  quotasOverTarget
                    ? "border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
                    : quotasExact
                      ? "border border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
                      : "border border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
                )}
                data-testid="wizard-quota-status"
              >
                {quotasOverTarget
                  ? `A soma (${formatNumberBr(quotasSum)}) passou do alvo (${formatNumberBr(targetNumber)}) — ajuste as fatias.`
                  : quotasExact
                    ? `A soma está perfeita! Bate com os ${formatNumberBr(targetNumber)} da meta.`
                    : `Distribuído ${formatNumberBr(quotasSum)} de ${formatNumberBr(targetNumber)} — o restante fica com o time todo.`}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs",
              step === 0 && "invisible"
            )}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Voltar
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              disabled={!stepValid}
              onClick={() => setStep((s) => s + 1)}
              data-testid="wizard-next"
            >
              Avançar <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              disabled={!stepValid || busy}
              onClick={() => void handleSubmit()}
              data-testid="wizard-submit"
            >
              {busy ? "Ligando os motores…" : "Ligar os Motores e Salvar Meta"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
