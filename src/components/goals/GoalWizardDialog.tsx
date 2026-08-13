/**
 * Metas (OKR) — Wizard de criação em 4 passos ("Esconder a Complexidade").
 *
 * Cadastro guiado v2: o Passo 2 usa o GoalMeasureBuilder compartilhado
 * (galeria de receitas de 1 clique, frase na ordem natural área→medição e
 * "Testar medição agora") e o seletor de PERÍODO do indicador — o indicador
 * pode medir um trimestre/semestre dentro de um objetivo anual, nunca fora
 * dele. O Passo 1 tem períodos rápidos; o Passo 3 mostra o contexto da
 * medição + valor atual testado como sugestão de ponto de partida. O backend
 * valida tudo de novo (o front nunca é autoridade).
 */

import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { renderInPortal } from "@/src/lib/renderInPortal.js";
import { fetchJsonOk } from "@/src/lib/http.js";
import type { GoalDto, GoalTrackingTypeValue } from "@/src/lib/goals/goalContracts.js";
import {
  EMPTY_TARGET_DRAFT,
  GoalTargetBuilder,
  buildTargetPayload,
  isTargetDraftValid,
  type GoalTargetDraft,
} from "./GoalTargetBuilder.js";
import {
  EMPTY_MEASURE_DRAFT,
  GoalMeasureBuilder,
  GoalPeriodPicker,
  buildRuleFromWizardState,
  formatNumberBr,
  goalQuickPeriods,
  isCivilWindowWithin,
  isMeasureDraftValid,
  wizardFieldClass as fieldClass,
  wizardLabelClass as labelClass,
  type CivilWindow,
  type GoalMeasureDraft,
  type GoalMetadataPublicEntity,
  type WizardQuota,
} from "./goalWizardShared.js";

export type { GoalMetadataPublicEntity } from "./goalWizardShared.js";

type OwnerOption = { id: string; name: string };

const STEP_TITLES = [
  "Onde queremos chegar?",
  "Como vamos medir o sucesso disso?",
  "Qual é a linha de chegada?",
  "Quem vai te ajudar a bater essa meta?",
] as const;

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

  // Passo 2 — Medição (builder compartilhado) + período do indicador.
  const [measure, setMeasure] = useState<GoalMeasureDraft>(EMPTY_MEASURE_DRAFT);
  const [previewValue, setPreviewValue] = useState<string | null>(null);
  /** null = ainda não mexeu → segue o período do objetivo. */
  const [krPeriod, setKrPeriod] = useState<CivilWindow | null>(null);

  // Passo 3 — Alvo.
  const [trackingType, setTrackingType] = useState<GoalTrackingTypeValue>("INCREASE");
  const [baseline, setBaseline] = useState("0");
  const [targetDraft, setTargetDraft] = useState<GoalTargetDraft>(EMPTY_TARGET_DRAFT);
  const [unit, setUnit] = useState("");

  // Passo 4 — Equipe (quotas).
  const [quotas, setQuotas] = useState<WizardQuota[]>([]);
  const [quotaSearch, setQuotaSearch] = useState("");

  const periods = useMemo(() => goalQuickPeriods(new Date()), []);

  const goalWindow: CivilWindow | null =
    startDate && endDate && endDate >= startDate ? { startDate, endDate } : null;
  const measureWindow: CivilWindow | null = goalWindow
    ? (krPeriod ?? goalWindow)
    : null;
  const measureWindowValid =
    measureWindow != null &&
    goalWindow != null &&
    isCivilWindowWithin(measureWindow, goalWindow);

  const entity = useMemo(
    () => metadataEntities.find((e) => e.key === measure.entityKey) ?? null,
    [metadataEntities, measure.entityKey]
  );
  const metric = useMemo(
    () => entity?.metrics.find((m) => m.key === measure.metricKey) ?? null,
    [entity, measure.metricKey]
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

  const targetNumber = Number(targetDraft.target.replace(",", "."));
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
    Boolean(title.trim() && goalWindow && ownerAppUserId),
    isMeasureDraftValid(measure) && measureWindowValid,
    Boolean(baseline.trim() !== "" && Number.isFinite(baselineNumber)) &&
      isTargetDraftValid(targetDraft),
    !quotasOverTarget,
  ][step]!;

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
      // Só persiste período próprio quando ele difere do período do objetivo
      // (senão o indicador continua herdando — menos estado, menos surpresa).
      const ownPeriod =
        measureWindow &&
        goalWindow &&
        (measureWindow.startDate !== goalWindow.startDate ||
          measureWindow.endDate !== goalWindow.endDate)
          ? measureWindow
          : null;
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
            measure.mode === "MANUAL"
              ? measure.krTitle
              : measure.krTitle.trim() || metric?.label || "Indicador",
          domain: entity?.domain ?? "OUTROS",
          trackingType,
          baseline: baseline.replace(",", "."),
          ...buildTargetPayload(targetDraft),
          unit: unit || metric?.suggestedUnit || null,
          weight: "1",
          ownerAppUserId,
          startDate: ownPeriod?.startDate ?? null,
          endDate: ownPeriod?.endDate ?? null,
          rule:
            measure.mode === "AUTO"
              ? buildRuleFromWizardState(measure.entityKey, measure.metricKey, measure.filters)
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

  const measureSummary =
    measure.mode === "MANUAL"
      ? `"${measure.krTitle}" (lançamento manual)`
      : metric && entity
        ? `${metric.operationLabel} de "${metric.label}" em ${entity.label}`
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
            <div className="space-y-1">
              <span className={labelClass}>Qual é o prazo?</span>
              <div className="flex flex-wrap gap-1.5" data-testid="wizard-quick-periods">
                {periods.map((p) => {
                  const active = startDate === p.startDate && endDate === p.endDate;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => {
                        setStartDate(p.startDate);
                        setEndDate(p.endDate);
                        setKrPeriod(null);
                      }}
                      data-testid={`wizard-period-${p.key}`}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <span className="self-center text-[10px] text-muted-foreground">
                  ou escolha datas específicas:
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className={labelClass}>Começa em</span>
                  <input
                    type="date"
                    className={fieldClass}
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setKrPeriod(null);
                    }}
                  />
                </label>
                <label className="block space-y-1">
                  <span className={labelClass}>Termina em</span>
                  <input
                    type="date"
                    className={fieldClass}
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setKrPeriod(null);
                    }}
                  />
                </label>
              </div>
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
          <div className="space-y-4" data-testid="wizard-step-measure">
            <GoalMeasureBuilder
              metadataEntities={metadataEntities}
              value={measure}
              onChange={setMeasure}
              onRecipeApplied={(recipe) => setTrackingType(recipe.suggestedTrackingType)}
              previewWindow={measureWindow}
              onPreviewValue={setPreviewValue}
            />
            {goalWindow ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <GoalPeriodPicker
                  bounds={goalWindow}
                  value={measureWindow ?? goalWindow}
                  onChange={setKrPeriod}
                  hint={
                    metric
                      ? `Conta pela ${metric.periodLabel}.`
                      : undefined
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3" data-testid="wizard-step-target">
            {measureSummary ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Medindo: <strong className="text-foreground">{measureSummary}</strong>
                {previewValue != null ? (
                  <span className="block">
                    Valor atual testado:{" "}
                    <strong className="text-foreground">
                      {formatNumberBr(Number(previewValue) || 0)}{" "}
                      {unit || metric?.suggestedUnit || ""}
                    </strong>{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary hover:underline"
                      onClick={() => setBaseline(previewValue)}
                      data-testid="wizard-use-preview-as-baseline"
                    >
                      usar como ponto de partida
                    </button>
                  </span>
                ) : null}
              </p>
            ) : null}

            <GoalTargetBuilder
              value={targetDraft}
              onChange={setTargetDraft}
              measuredWindow={measureWindowValid ? measureWindow : null}
              rule={
                measure.mode === "AUTO"
                  ? buildRuleFromWizardState(
                      measure.entityKey,
                      measure.metricKey,
                      measure.filters
                    )
                  : null
              }
              trackingType={trackingType}
              unit={unit || metric?.suggestedUnit || ""}
              canCompare={measure.mode === "AUTO"}
            />

            <div className="grid grid-cols-2 gap-2">
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
                <span className={labelClass}>O formato é em</span>
                <input
                  className={fieldClass}
                  placeholder={metric?.suggestedUnit ?? "R$, un, %…"}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </label>
            </div>

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
