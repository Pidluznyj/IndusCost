/**
 * Metas (OKR) — passo do ALVO, com dois caminhos de primeira classe:
 *
 *  1. NÚMERO DIGITADO — o de sempre, continua sendo o padrão;
 *  2. COMPARAÇÃO COM PERÍODO ANTERIOR — "quero 30% a mais que o mesmo
 *     período do ano passado". O sistema mede a MESMA regra na janela
 *     deslocada e mostra o número ANTES de salvar.
 *
 * O valor apurado é congelado no cadastro (o backend grava junto a janela e o
 * instante). Alvo que se recalcula sozinho deixa de ser compromisso — e o
 * sync do Nomus reescreve pedidos antigos, então "o ano passado" mudaria de
 * valor no meio do trimestre.
 *
 * Usado pelos dois assistentes e pela edição do indicador.
 */

import React, { useState } from "react";
import { FlaskConical, History } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http.js";
import {
  GOAL_TARGET_COMPARISON_MODES,
  GOAL_TARGET_COMPARISON_MODE_LABELS,
  computeGoalTargetFromComparison,
  resolveGoalTargetComparisonWindow,
  type GoalTargetComparisonModeValue,
  type GoalTrackingTypeValue,
} from "@/src/lib/goals/goalContracts.js";
import {
  PhraseSelect,
  formatCivilDateBr,
  formatNumberBr,
  wizardFieldClass,
  wizardLabelClass,
  type CivilWindow,
} from "./goalWizardShared.js";

/** Estado do passo "Alvo" — vive no wizard (componente controlado). */
export type GoalTargetDraft = {
  basis: "MANUAL" | "COMPARISON";
  /** Número digitado (modo MANUAL). */
  target: string;
  /** Percentual sobre o período de comparação (modo COMPARISON). */
  percent: string;
  comparisonMode: GoalTargetComparisonModeValue;
  customStartDate: string;
  customEndDate: string;
};

export const EMPTY_TARGET_DRAFT: GoalTargetDraft = {
  basis: "MANUAL",
  target: "",
  percent: "10",
  comparisonMode: "SAME_PERIOD_LAST_YEAR",
  customStartDate: "",
  customEndDate: "",
};

export function isTargetDraftValid(draft: GoalTargetDraft): boolean {
  if (draft.basis === "MANUAL") {
    const n = Number(draft.target.replace(",", "."));
    return draft.target.trim() !== "" && Number.isFinite(n);
  }
  if (!Number.isFinite(Number(draft.percent.replace(",", ".")))) return false;
  if (draft.comparisonMode === "CUSTOM") {
    return Boolean(
      draft.customStartDate &&
        draft.customEndDate &&
        draft.customEndDate >= draft.customStartDate
    );
  }
  return true;
}

/** Payload do alvo para a API — em COMPARISON o servidor apura e congela. */
export function buildTargetPayload(draft: GoalTargetDraft): {
  targetBasis: "MANUAL" | "COMPARISON";
  target: string | null;
  comparison: {
    mode: GoalTargetComparisonModeValue;
    percent: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
} {
  if (draft.basis === "MANUAL") {
    return {
      targetBasis: "MANUAL",
      target: draft.target.replace(",", "."),
      comparison: null,
    };
  }
  return {
    targetBasis: "COMPARISON",
    target: null,
    comparison: {
      mode: draft.comparisonMode,
      percent: draft.percent.replace(",", "."),
      startDate: draft.comparisonMode === "CUSTOM" ? draft.customStartDate : null,
      endDate: draft.comparisonMode === "CUSTOM" ? draft.customEndDate : null,
    },
  };
}

export function GoalTargetBuilder({
  value,
  onChange,
  measuredWindow,
  rule,
  trackingType,
  unit,
  canCompare,
}: {
  value: GoalTargetDraft;
  onChange: (next: GoalTargetDraft) => void;
  /** Janela medida pelo indicador — base do deslocamento. */
  measuredWindow: CivilWindow | null;
  /** Regra do indicador (para apurar o período anterior). */
  rule: unknown | null;
  trackingType: GoalTrackingTypeValue;
  unit: string;
  /** Indicador manual não tem histórico automático para comparar. */
  canCompare: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [comparisonValue, setComparisonValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const comparisonWindow =
    measuredWindow && value.basis === "COMPARISON"
      ? resolveGoalTargetComparisonWindow({
          measuredStartDate: measuredWindow.startDate,
          measuredEndDate: measuredWindow.endDate,
          mode: value.comparisonMode,
          customStartDate: value.customStartDate || null,
          customEndDate: value.customEndDate || null,
        })
      : null;

  function patch(partial: Partial<GoalTargetDraft>) {
    setComparisonValue(null);
    setError(null);
    onChange({ ...value, ...partial });
  }

  const projectedTarget =
    comparisonValue != null
      ? computeGoalTargetFromComparison({
          comparisonValue,
          percent: value.percent.replace(",", ".") || "0",
          trackingType,
        })
      : null;

  async function handleMeasure() {
    if (!comparisonWindow || !rule) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJsonOk<{ value: string }>("/api/goals/rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: comparisonWindow.startCivilDate,
          endDate: comparisonWindow.endCivilDate,
          rule,
        }),
      });
      setComparisonValue(res.value);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível medir o período anterior."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="target-builder">
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className={cn(
            "rounded-full border px-3 py-1 font-medium",
            value.basis === "MANUAL"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          )}
          onClick={() => patch({ basis: "MANUAL" })}
          data-testid="target-basis-manual"
        >
          Digitar um número
        </button>
        <button
          type="button"
          className={cn(
            "rounded-full border px-3 py-1 font-medium",
            value.basis === "COMPARISON"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground",
            !canCompare && "cursor-not-allowed opacity-40"
          )}
          disabled={!canCompare}
          onClick={() => patch({ basis: "COMPARISON" })}
          title={
            canCompare
              ? undefined
              : "Disponível quando o sistema mede sozinho — aqui o número é informado por você."
          }
          data-testid="target-basis-comparison"
        >
          <History className="mr-1 inline h-3 w-3" aria-hidden />
          Comparar com um período anterior
        </button>
      </div>

      {value.basis === "MANUAL" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Quero que esse número{" "}
          <strong className="text-foreground">
            {trackingType === "INCREASE" ? "aumente" : "diminua"}
          </strong>{" "}
          até chegar em{" "}
          <input
            className="w-36 rounded-md border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-right text-sm font-semibold text-primary tabular-nums"
            placeholder="100000"
            value={value.target}
            onChange={(e) => patch({ target: e.target.value })}
            data-testid="target-manual-value"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-1.5 text-sm leading-8">
            Quero{" "}
            <input
              className="w-16 rounded-md border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-right text-sm font-semibold text-primary tabular-nums"
              value={value.percent}
              onChange={(e) => patch({ percent: e.target.value })}
              data-testid="target-percent"
            />
            <span className="font-semibold">
              % {trackingType === "INCREASE" ? "a mais" : "a menos"}
            </span>{" "}
            que{" "}
            <PhraseSelect
              value={value.comparisonMode}
              onChange={(v) =>
                patch({ comparisonMode: v as GoalTargetComparisonModeValue })
              }
              options={GOAL_TARGET_COMPARISON_MODES.map((m) => ({
                value: m,
                label: GOAL_TARGET_COMPARISON_MODE_LABELS[m],
              }))}
              placeholder="escolha o período"
              testId="target-comparison-mode"
            />
          </p>

          {value.comparisonMode === "CUSTOM" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className={wizardLabelClass}>Comparar de</span>
                <input
                  type="date"
                  className={wizardFieldClass}
                  value={value.customStartDate}
                  onChange={(e) => patch({ customStartDate: e.target.value })}
                  data-testid="target-custom-start"
                />
              </label>
              <label className="block space-y-1">
                <span className={wizardLabelClass}>até</span>
                <input
                  type="date"
                  className={wizardFieldClass}
                  value={value.customEndDate}
                  onChange={(e) => patch({ customEndDate: e.target.value })}
                  data-testid="target-custom-end"
                />
              </label>
            </div>
          ) : null}

          {comparisonWindow ? (
            <div
              className="rounded-lg border border-border bg-card p-2.5"
              data-testid="target-comparison-box"
            >
              <p className="text-[11px] text-muted-foreground">
                Período de comparação:{" "}
                <strong className="text-foreground">
                  {formatCivilDateBr(comparisonWindow.startCivilDate)} a{" "}
                  {formatCivilDateBr(comparisonWindow.endCivilDate)}
                </strong>
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                  disabled={busy || !rule}
                  onClick={() => void handleMeasure()}
                  data-testid="target-measure-button"
                >
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                  {busy ? "Medindo…" : "Ver quanto foi nesse período"}
                </button>
                {comparisonValue != null && projectedTarget != null ? (
                  <span className="text-xs" data-testid="target-projection">
                    Naquele período:{" "}
                    <strong>{formatNumberBr(Number(comparisonValue) || 0)}</strong>{" "}
                    → seu alvo fica{" "}
                    <strong className="text-[#065F46]">
                      {formatNumberBr(Number(projectedTarget) || 0)} {unit}
                    </strong>
                  </span>
                ) : null}
              </div>
              {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
              <p className="mt-1 text-[10px] text-muted-foreground">
                O valor apurado é congelado ao salvar — o alvo não muda sozinho
                depois. Para atualizar a base, salve o indicador novamente.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Defina as datas do indicador para montar o período de comparação.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
