/**
 * Metas (OKR) — assistente para adicionar um NOVO INDICADOR a um Objetivo
 * já existente. Mesma experiência do wizard de criação (GoalMeasureBuilder
 * compartilhado: receitas prontas, frase na ordem natural e "Testar medição
 * agora") — sem repetir o Passo "Direção", porque o Objetivo já existe.
 *
 * Por que este componente existe: antes só havia UM jeito "bonito" de medir
 * uma meta — o wizard "+ Novo Objetivo", que sempre cria um Objetivo NOVO.
 * Isso empurrava quem só queria adicionar mais um indicador a usar o botão
 * errado, criando um Objetivo duplicado sem querer. Este diálogo fecha essa
 * lacuna: mesma linguagem leiga, resultado correto (indicador dentro do
 * Objetivo escolhido).
 *
 * O indicador tem PERÍODO PRÓPRIO (um trimestre dentro de um objetivo anual,
 * por exemplo), sempre limitado ao período do Objetivo.
 */

import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { renderInPortal } from "@/src/lib/renderInPortal.js";
import { fetchJsonOk } from "@/src/lib/http.js";
import type {
  GoalDto,
  GoalKeyResultDto,
  GoalTrackingTypeValue,
} from "@/src/lib/goals/goalContracts.js";
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
  isCivilWindowWithin,
  isMeasureDraftValid,
  wizardFieldClass as fieldClass,
  wizardLabelClass as labelClass,
  type CivilWindow,
  type GoalMeasureDraft,
  type GoalMetadataPublicEntity,
  type WizardQuota,
} from "./goalWizardShared.js";

type OwnerOption = { id: string; name: string };

const STEP_TITLES = [
  "Como vamos medir o sucesso disso?",
  "Qual é a linha de chegada?",
  "Quem vai te ajudar a bater essa meta?",
] as const;

export function GoalKeyResultWizardDialog({
  goal,
  owners,
  metadataEntities,
  onCancel,
  onCreated,
}: {
  goal: GoalDto;
  owners: OwnerOption[];
  metadataEntities: GoalMetadataPublicEntity[];
  onCancel: () => void;
  onCreated: (keyResult: GoalKeyResultDto) => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Indicador JÁ criado nesta sessão do diálogo. Se a gravação passou e um
   * passo posterior falhou (fatias, rede caindo ao ler a resposta), tentar de
   * novo NÃO pode criar outro indicador: a retentativa retoma de onde parou.
   * Era assim que a tela colecionava indicadores idênticos — cada clique em
   * "criar" depois de um erro gravava mais um.
   */
  const [createdKeyResult, setCreatedKeyResult] = useState<GoalKeyResultDto | null>(null);

  const goalWindow: CivilWindow = { startDate: goal.startDate, endDate: goal.endDate };

  // Passo 1 — Medição + período do indicador.
  const [measure, setMeasure] = useState<GoalMeasureDraft>(EMPTY_MEASURE_DRAFT);
  const [previewValue, setPreviewValue] = useState<string | null>(null);
  const [period, setPeriod] = useState<CivilWindow>(goalWindow);

  // Passo 2 — Alvo.
  const [trackingType, setTrackingType] = useState<GoalTrackingTypeValue>("INCREASE");
  const [baseline, setBaseline] = useState("0");
  const [targetDraft, setTargetDraft] = useState<GoalTargetDraft>(EMPTY_TARGET_DRAFT);
  const [unit, setUnit] = useState("");

  // Passo 3 — Equipe (quotas) + responsável do indicador.
  const [ownerAppUserId, setOwnerAppUserId] = useState(goal.ownerAppUserId);
  const [quotas, setQuotas] = useState<WizardQuota[]>([]);
  const [quotaSearch, setQuotaSearch] = useState("");

  const entity = useMemo(
    () => metadataEntities.find((e) => e.key === measure.entityKey) ?? null,
    [metadataEntities, measure.entityKey]
  );
  const metric = useMemo(
    () => entity?.metrics.find((m) => m.key === measure.metricKey) ?? null,
    [entity, measure.metricKey]
  );

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
  const quotasOverTarget = Number.isFinite(targetNumber) && quotasSum > targetNumber + 1e-9;
  const quotasExact =
    Number.isFinite(targetNumber) && quotas.length > 0 && Math.abs(quotasSum - targetNumber) < 1e-9;

  const periodValid = isCivilWindowWithin(period, goalWindow);

  const stepValid = [
    isMeasureDraftValid(measure) && periodValid,
    Boolean(baseline.trim() !== "" && Number.isFinite(baselineNumber)) &&
      isTargetDraftValid(targetDraft),
    Boolean(ownerAppUserId) && !quotasOverTarget,
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
    /** Só chama o pai DEPOIS do try: erro do pai não é falha de gravação. */
    let saved: GoalKeyResultDto | null = null;
    try {
      const hasOwnPeriod =
        period.startDate !== goalWindow.startDate || period.endDate !== goalWindow.endDate;
      const payload = {
        title:
          measure.mode === "MANUAL"
            ? measure.krTitle
            : measure.krTitle.trim() || metric?.label || "Resultado-chave",
        domain: entity?.domain ?? "OUTROS",
        trackingType,
        baseline: baseline.replace(",", "."),
        ...buildTargetPayload(targetDraft),
        unit: unit || metric?.suggestedUnit || null,
        weight: "1",
        ownerAppUserId,
        startDate: hasOwnPeriod ? period.startDate : null,
        endDate: hasOwnPeriod ? period.endDate : null,
        rule:
          measure.mode === "AUTO"
            ? buildRuleFromWizardState(measure.entityKey, measure.metricKey, measure.filters)
            : null,
      };
      // UM único request ATÔMICO: indicador + fatias nascem na mesma
      // transação do backend. Fatia inválida = indicador NÃO é criado —
      // acabou o estado "criou mas as fatias falharam" que induzia o
      // usuário a clicar de novo e duplicar.
      const nonEmptyQuotas = quotas.filter((q) => q.quotaValue.trim() !== "");
      const finalKr = (
        await fetchJsonOk<{ keyResult: GoalKeyResultDto }>(
          `/api/goals/${goal.id}/key-results`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              quotas: nonEmptyQuotas.map((q) => ({
                assignedAppUserId: q.assignedAppUserId,
                quotaValue: q.quotaValue.replace(",", "."),
              })),
            }),
          }
        )
      ).keyResult;
      setCreatedKeyResult(finalKr);
      saved = finalKr;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o resultado-chave.");
    } finally {
      setBusy(false);
    }
    if (saved) onCreated(saved);
  }

  const gap =
    Number.isFinite(targetNumber) && Number.isFinite(baselineNumber) ? targetNumber - baselineNumber : null;

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
      data-testid="kr-wizard"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span
              title="Resultado-chave: um resultado mensurável que mostra se o objetivo está sendo alcançado."
            >
              Novo resultado-chave em <strong className="text-foreground">{goal.title}</strong> — passo{" "}
              {step + 1} de 3
            </span>
            <button type="button" className="hover:text-foreground" onClick={onCancel}>
              Cancelar
            </button>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
            ))}
          </div>
        </div>

        <h2 className="mb-3 text-lg font-semibold">{STEP_TITLES[step]}</h2>

        {step === 0 ? (
          <div className="space-y-4" data-testid="kr-wizard-step-measure">
            <GoalMeasureBuilder
              metadataEntities={metadataEntities}
              value={measure}
              onChange={setMeasure}
              onRecipeApplied={(recipe) => setTrackingType(recipe.suggestedTrackingType)}
              previewWindow={periodValid ? period : null}
              onPreviewValue={setPreviewValue}
            />
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <GoalPeriodPicker
                bounds={goalWindow}
                value={period}
                onChange={setPeriod}
                hint={metric ? `Conta pela ${metric.periodLabel}.` : undefined}
              />
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3" data-testid="kr-wizard-step-target">
            {measureSummary ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Medindo: <strong className="text-foreground">{measureSummary}</strong>
                {previewValue != null ? (
                  <span className="block">
                    Valor atual testado:{" "}
                    <strong className="text-foreground">
                      {formatNumberBr(Number(previewValue) || 0)} {unit || metric?.suggestedUnit || ""}
                    </strong>{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary hover:underline"
                      onClick={() => setBaseline(previewValue)}
                      data-testid="kr-wizard-use-preview-as-baseline"
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
              measuredWindow={periodValid ? period : null}
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
                  data-testid="kr-wizard-baseline"
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
                data-testid="kr-wizard-gap-hint"
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

        {step === 2 ? (
          <div className="space-y-3" data-testid="kr-wizard-step-team">
            <label className="block space-y-1">
              <span className={labelClass}>Responsável por este resultado-chave *</span>
              <select
                className={fieldClass}
                value={ownerAppUserId}
                onChange={(e) => setOwnerAppUserId(e.target.value)}
                data-testid="kr-wizard-owner"
              >
                <option value="">Selecione…</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Fatias por pessoa são configuração AVANÇADA — quem só quer o
                responsável principal não precisa nem ver isto. */}
            <details
              className="rounded-lg border border-border bg-muted/20 p-3"
              data-testid="kr-wizard-advanced"
            >
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                Opções avançadas — dividir o alvo em fatias por pessoa (opcional)
              </summary>
              <div className="mt-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              Opcional: divida o alvo em fatias nominais. Cada pessoa enxerga a própria fatia
              no painel.
            </p>
            <input
              className={fieldClass}
              placeholder="Busque pelo nome para adicionar…"
              value={quotaSearch}
              onChange={(e) => setQuotaSearch(e.target.value)}
              data-testid="kr-wizard-quota-search"
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
                  <span className="min-w-0 flex-1 truncate font-medium">{person?.name ?? "—"}</span>
                  <input
                    className="w-28 rounded border border-border px-1.5 py-0.5 text-right text-sm tabular-nums"
                    placeholder="valor"
                    value={quota.quotaValue}
                    onChange={(e) =>
                      setQuotas((prev) => prev.map((q) => (q.id === quota.id ? { ...q, quotaValue: e.target.value } : q)))
                    }
                  />
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
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
                data-testid="kr-wizard-quota-status"
              >
                {quotasOverTarget
                  ? `A soma (${formatNumberBr(quotasSum)}) passou do alvo (${formatNumberBr(targetNumber)}) — ajuste as fatias.`
                  : quotasExact
                    ? `A soma está perfeita! Bate com os ${formatNumberBr(targetNumber)} da meta.`
                    : `Distribuído ${formatNumberBr(quotasSum)} de ${formatNumberBr(targetNumber)} — o restante fica com o time todo.`}
              </p>
            ) : null}
              </div>
            </details>
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
          {step < 2 ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              disabled={!stepValid}
              onClick={() => setStep((s) => s + 1)}
              data-testid="kr-wizard-next"
            >
              Avançar <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              disabled={!stepValid || busy}
              onClick={() => void handleSubmit()}
              data-testid="kr-wizard-submit"
            >
              {busy
                ? "Salvando…"
                : createdKeyResult
                  ? "Tentar novamente (sem duplicar)"
                  : "Adicionar Resultado-chave"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
