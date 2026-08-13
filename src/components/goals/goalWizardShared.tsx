/**
 * Metas (OKR) — peças reaproveitáveis da experiência conversacional
 * ("Esconder a Complexidade"). Usadas tanto pelo wizard de criação de
 * Objetivo (GoalWizardDialog) quanto pelo de adicionar Indicador a um
 * Objetivo já existente (GoalKeyResultWizardDialog) — mesma linguagem em
 * ambos os pontos de entrada, para o usuário nunca precisar adivinhar qual
 * botão "é o bonito".
 */

import React, { useState } from "react";
import { Sparkles, FlaskConical } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http.js";
import { GOAL_RECIPES, type GoalRecipe } from "@/src/lib/goals/goalRecipes.js";

export const wizardFieldClass =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm";
export const wizardLabelClass = "text-[11px] font-semibold text-muted-foreground";

/** Bloco clicável da frase interativa (dropdown disfarçado). */
export function PhraseSelect({
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

export function formatNumberBr(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

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

export type WizardFilter = {
  id: string;
  fieldKey: string;
  operator: string;
  value: string;
  connector: "AND" | "OR";
};

export type WizardQuota = {
  id: string;
  assignedAppUserId: string;
  quotaValue: string;
};

export function buildRuleFromWizardState(
  entityKey: string,
  metricKey: string,
  filters: WizardFilter[]
): { entityKey: string; metricKey: string; filters: unknown[] } | null {
  if (!entityKey || !metricKey) return null;
  return {
    entityKey,
    metricKey,
    filters: filters.map((f) => ({
      fieldKey: f.fieldKey,
      operator: f.operator,
      value: f.operator === "IS_EMPTY" ? null : f.value,
      connector: f.connector,
    })),
  };
}

// ─── Período (janela civil) ─────────────────────────────────────────────────

export type CivilWindow = { startDate: string; endDate: string };

export function formatCivilDateBr(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function lastDayOfMonth(year: number, month1: number): string {
  return pad2(new Date(year, month1, 0).getDate());
}

/** Períodos rápidos do calendário corrente (Passo "prazo" do Objetivo). */
export function goalQuickPeriods(
  today: Date
): Array<{ key: string; label: string } & CivilWindow> {
  const year = today.getFullYear();
  const month0 = today.getMonth();
  const quarterStart = Math.floor(month0 / 3) * 3;
  const semesterStart = month0 < 6 ? 0 : 6;
  return [
    {
      key: "YEAR",
      label: "Este ano",
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    },
    {
      key: "SEMESTER",
      label: "Este semestre",
      startDate: `${year}-${pad2(semesterStart + 1)}-01`,
      endDate: `${year}-${pad2(semesterStart + 6)}-${lastDayOfMonth(year, semesterStart + 6)}`,
    },
    {
      key: "QUARTER",
      label: "Este trimestre",
      startDate: `${year}-${pad2(quarterStart + 1)}-01`,
      endDate: `${year}-${pad2(quarterStart + 3)}-${lastDayOfMonth(year, quarterStart + 3)}`,
    },
  ];
}

/**
 * Recortes possíveis DENTRO de uma janela (trimestres e semestres que
 * cabem no período do Objetivo). É o que permite "objetivo anual com
 * indicador trimestral" em um clique — sem o usuário calcular datas.
 */
export function goalSubPeriodChips(
  bounds: CivilWindow
): Array<{ key: string; label: string } & CivilWindow> {
  const startYear = Number(bounds.startDate.slice(0, 4));
  const endYear = Number(bounds.endDate.slice(0, 4));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [];
  const multiYear = endYear > startYear;
  const out: Array<{ key: string; label: string } & CivilWindow> = [];
  const seen = new Set<string>();

  const push = (key: string, label: string, rawStart: string, rawEnd: string) => {
    const startDate = rawStart < bounds.startDate ? bounds.startDate : rawStart;
    const endDate = rawEnd > bounds.endDate ? bounds.endDate : rawEnd;
    if (startDate > endDate) return; // não intersecta o objetivo
    if (startDate === bounds.startDate && endDate === bounds.endDate) return; // = todo o período
    const dedupe = `${startDate}|${endDate}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ key, label, startDate, endDate });
  };

  for (let year = startYear; year <= Math.min(endYear, startYear + 2); year += 1) {
    const suffix = multiYear ? `/${year}` : "";
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const firstMonth = quarter * 3 + 1;
      const lastMonth = firstMonth + 2;
      push(
        `Q${quarter + 1}-${year}`,
        `${quarter + 1}º trimestre${suffix}`,
        `${year}-${pad2(firstMonth)}-01`,
        `${year}-${pad2(lastMonth)}-${lastDayOfMonth(year, lastMonth)}`
      );
    }
    for (let semester = 0; semester < 2; semester += 1) {
      const firstMonth = semester * 6 + 1;
      const lastMonth = firstMonth + 5;
      push(
        `S${semester + 1}-${year}`,
        `${semester + 1}º semestre${suffix}`,
        `${year}-${pad2(firstMonth)}-01`,
        `${year}-${pad2(lastMonth)}-${lastDayOfMonth(year, lastMonth)}`
      );
    }
  }
  return out.slice(0, 12);
}

/**
 * Seletor do período MEDIDO por um indicador.
 *
 * Um objetivo anual quase nunca tem só indicadores anuais: dá para querer
 * "faturamento do 3º trimestre" dentro de "crescer 30% em 2026". Aqui o
 * usuário escolhe o recorte em um clique (ou digita datas), sempre limitado
 * ao período do objetivo — o backend valida de novo e recorta na execução.
 */
export function GoalPeriodPicker({
  bounds,
  value,
  onChange,
  hint,
}: {
  bounds: CivilWindow;
  value: CivilWindow;
  onChange: (next: CivilWindow) => void;
  /** Frase extra abaixo do seletor (ex.: coluna de data da medição). */
  hint?: string;
}) {
  const chips = goalSubPeriodChips(bounds);
  const isWholeGoal =
    value.startDate === bounds.startDate && value.endDate === bounds.endDate;
  const outOfBounds =
    value.startDate < bounds.startDate ||
    value.endDate > bounds.endDate ||
    value.endDate < value.startDate;

  return (
    <div className="space-y-2" data-testid="period-picker">
      <span className={wizardLabelClass}>Qual período este indicador mede?</span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            isWholeGoal
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onChange({ ...bounds })}
          data-testid="period-whole-goal"
        >
          Todo o período do objetivo
        </button>
        {chips.map((chip) => {
          const active =
            value.startDate === chip.startDate && value.endDate === chip.endDate;
          return (
            <button
              key={chip.key}
              type="button"
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
              onClick={() =>
                onChange({ startDate: chip.startDate, endDate: chip.endDate })
              }
              data-testid={`period-chip-${chip.key}`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={wizardLabelClass}>De</span>
          <input
            type="date"
            className={wizardFieldClass}
            min={bounds.startDate}
            max={bounds.endDate}
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
            data-testid="period-start"
          />
        </label>
        <label className="block space-y-1">
          <span className={wizardLabelClass}>Até</span>
          <input
            type="date"
            className={wizardFieldClass}
            min={bounds.startDate}
            max={bounds.endDate}
            value={value.endDate}
            onChange={(e) => onChange({ ...value, endDate: e.target.value })}
            data-testid="period-end"
          />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground" data-testid="period-summary">
        {outOfBounds ? (
          <span className="text-red-600">
            As datas precisam ficar entre {formatCivilDateBr(bounds.startDate)} e{" "}
            {formatCivilDateBr(bounds.endDate)} (o período do objetivo), e a data
            final não pode ser antes da inicial.
          </span>
        ) : (
          <>
            Vamos contar apenas o que aconteceu de{" "}
            <strong className="text-foreground">
              {formatCivilDateBr(value.startDate)}
            </strong>{" "}
            até{" "}
            <strong className="text-foreground">
              {formatCivilDateBr(value.endDate)}
            </strong>
            {isWholeGoal ? " (todo o período do objetivo)" : ""}.
            {hint ? ` ${hint}` : ""}
          </>
        )}
      </p>
    </div>
  );
}

export function isCivilWindowWithin(value: CivilWindow, bounds: CivilWindow): boolean {
  return (
    Boolean(value.startDate && value.endDate) &&
    value.startDate >= bounds.startDate &&
    value.endDate <= bounds.endDate &&
    value.endDate >= value.startDate
  );
}

// ─── Construtor de medição compartilhado (cadastro guiado v2) ───────────────

/** Estado completo do passo de medição — vive no wizard (controlado). */
export type GoalMeasureDraft = {
  mode: "AUTO" | "MANUAL";
  entityKey: string;
  metricKey: string;
  filters: WizardFilter[];
  krTitle: string;
};

export const EMPTY_MEASURE_DRAFT: GoalMeasureDraft = {
  mode: "AUTO",
  entityKey: "",
  metricKey: "",
  filters: [],
  krTitle: "",
};

export function isMeasureDraftValid(draft: GoalMeasureDraft): boolean {
  if (draft.mode === "MANUAL") return Boolean(draft.krTitle.trim());
  return Boolean(
    draft.entityKey &&
      draft.metricKey &&
      draft.filters.every(
        (f) => f.fieldKey && f.operator && (f.operator === "IS_EMPTY" || f.value.trim())
      )
  );
}

/**
 * Construtor de medição — usado pelos DOIS wizards (Objetivo novo e
 * Indicador em objetivo existente), para a experiência ser idêntica:
 *
 *  1. GALERIA DE RECEITAS: um clique preenche a frase inteira (área +
 *     medição + filtros típicos) — o caminho de 90% dos casos;
 *  2. FRASE NA ORDEM NATURAL: "Na área de [área], quero acompanhar
 *     [medição]" — o primeiro bloco é o primeiro habilitado; o segundo
 *     ganha destaque quando falta escolher;
 *  3. TESTAR MEDIÇÃO AGORA: executa a regra em modo leitura e mostra o
 *     valor atual — confiança antes de salvar; o valor é propagado ao
 *     wizard para virar sugestão de ponto de partida (baseline).
 */
export function GoalMeasureBuilder({
  metadataEntities,
  value,
  onChange,
  onRecipeApplied,
  previewWindow,
  onPreviewValue,
}: {
  metadataEntities: GoalMetadataPublicEntity[];
  value: GoalMeasureDraft;
  onChange: (next: GoalMeasureDraft) => void;
  /** Receita aplicada — o wizard pode aproveitar a direção sugerida. */
  onRecipeApplied?: (recipe: GoalRecipe) => void;
  /** Janela da meta p/ o teste (null = datas ainda não definidas). */
  previewWindow: { startDate: string; endDate: string } | null;
  /** Valor retornado pelo "Testar agora" — vira sugestão de baseline. */
  onPreviewValue?: (value: string) => void;
}) {
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const entity = metadataEntities.find((e) => e.key === value.entityKey) ?? null;
  const metric = entity?.metrics.find((m) => m.key === value.metricKey) ?? null;

  // Só oferece receitas cujas chaves existem no dicionário carregado.
  const recipes = GOAL_RECIPES.filter((r) =>
    metadataEntities.some(
      (e) => e.key === r.entityKey && e.metrics.some((m) => m.key === r.metricKey)
    )
  );

  function patch(partial: Partial<GoalMeasureDraft>) {
    setPreviewResult(null);
    setPreviewError(null);
    onChange({ ...value, ...partial });
  }

  function applyRecipe(recipe: GoalRecipe) {
    setPreviewResult(null);
    setPreviewError(null);
    onChange({
      ...value,
      mode: "AUTO",
      entityKey: recipe.entityKey,
      metricKey: recipe.metricKey,
      filters: recipe.filters.map((f, i) => ({
        id: `rf-${Date.now()}-${i}`,
        fieldKey: f.fieldKey,
        operator: f.operator,
        value: f.value ?? "",
        connector: f.connector,
      })),
      krTitle: "",
    });
    onRecipeApplied?.(recipe);
  }

  function addFilter() {
    patch({
      filters: [
        ...value.filters,
        {
          id: `f-${Date.now()}-${value.filters.length}`,
          fieldKey: "",
          operator: "",
          value: "",
          connector: "AND",
        },
      ],
    });
  }

  function updateFilter(id: string, filterPatch: Partial<WizardFilter>) {
    patch({
      filters: value.filters.map((f) => (f.id === id ? { ...f, ...filterPatch } : f)),
    });
  }

  async function handlePreview() {
    if (!previewWindow) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const res = await fetchJsonOk<{ value: string }>("/api/goals/rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: previewWindow.startDate,
          endDate: previewWindow.endDate,
          rule: buildRuleFromWizardState(value.entityKey, value.metricKey, value.filters),
        }),
      });
      setPreviewResult(res.value);
      onPreviewValue?.(res.value);
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : "Não foi possível testar agora."
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  const activeRecipeKey =
    recipes.find(
      (r) =>
        r.entityKey === value.entityKey &&
        r.metricKey === value.metricKey &&
        r.filters.length === value.filters.length &&
        r.filters.every((rf, i) => {
          const f = value.filters[i];
          return (
            f &&
            f.fieldKey === rf.fieldKey &&
            f.operator === rf.operator &&
            (rf.value ?? "") === f.value
          );
        })
    )?.key ?? null;

  return (
    <div className="space-y-3" data-testid="measure-builder">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={cn(
            "rounded-full border px-3 py-1 font-medium",
            value.mode === "AUTO"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          )}
          onClick={() => patch({ mode: "AUTO" })}
        >
          <Sparkles className="mr-1 inline h-3 w-3" aria-hidden />
          O sistema mede sozinho
        </button>
        <button
          type="button"
          className={cn(
            "rounded-full border px-3 py-1 font-medium",
            value.mode === "MANUAL"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          )}
          onClick={() => patch({ mode: "MANUAL" })}
          data-testid="measure-mode-manual"
        >
          Eu mesmo informo o número
        </button>
      </div>

      {value.mode === "AUTO" ? (
        <>
          {/* 1. Galeria de receitas — comece por aqui */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              Comece por uma medição pronta (você pode ajustar depois):
            </p>
            <div
              className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
              data-testid="measure-recipes"
            >
              {recipes.map((recipe) => (
                <button
                  key={recipe.key}
                  type="button"
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-left",
                    activeRecipeKey === recipe.key
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-muted/40"
                  )}
                  onClick={() => applyRecipe(recipe)}
                  data-testid={`measure-recipe-${recipe.key}`}
                >
                  <span className="text-xs font-semibold">
                    {recipe.emoji} {recipe.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {recipe.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. A frase interativa — ordem natural: área primeiro */}
          <p
            className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-8"
            data-testid="measure-phrase"
          >
            Na área de{" "}
            <PhraseSelect
              value={value.entityKey}
              onChange={(v) => patch({ entityKey: v, metricKey: "", filters: [] })}
              options={metadataEntities.map((e) => ({ value: e.key, label: e.label }))}
              placeholder="escolha a área"
              testId="measure-entity"
            />
            , eu quero acompanhar{" "}
            <span
              className={cn(
                value.entityKey &&
                  !value.metricKey &&
                  "rounded-md ring-2 ring-primary/60 ring-offset-1"
              )}
            >
              <PhraseSelect
                value={value.metricKey}
                onChange={(v) => patch({ metricKey: v })}
                options={(entity?.metrics ?? []).map((m) => ({
                  value: m.key,
                  label: `${m.operationLabel} de "${m.label}"`,
                }))}
                placeholder={entity ? "escolha a medição" : "primeiro escolha a área"}
                testId="measure-metric"
              />
            </span>
            .
            {metric ? (
              <span className="block text-[11px] text-muted-foreground">
                Conta pela {metric.periodLabel}, dentro do período que você escolher
                para este indicador no próximo passo.
              </span>
            ) : null}
          </p>

          {/* Regras de exceção empilhadas */}
          {value.filters.map((filter, index) => {
            const field = entity?.filterFields.find((f) => f.key === filter.fieldKey);
            const datalistId = `measure-filter-options-${filter.id}`;
            return (
              <p
                key={filter.id}
                className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm leading-8"
                data-testid={`measure-filter-${index}`}
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
                    <>
                      <input
                        className="mx-0.5 inline-block w-40 rounded-md border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-sm font-semibold text-primary"
                        placeholder={field.type === "NUMBER" ? "número" : "texto"}
                        value={filter.value}
                        list={field.options?.length ? datalistId : undefined}
                        onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                      />
                      {field.options?.length ? (
                        <datalist id={datalistId}>
                          {field.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </datalist>
                      ) : null}
                    </>
                  )
                ) : null}
                <button
                  type="button"
                  className="ml-2 text-[11px] text-muted-foreground hover:text-red-600"
                  onClick={() =>
                    patch({ filters: value.filters.filter((f) => f.id !== filter.id) })
                  }
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
              data-testid="measure-add-filter"
            >
              + Adicionar uma regra de exceção
            </button>
          ) : null}

          {/* 3. Testar medição agora */}
          {value.entityKey && value.metricKey ? (
            <div
              className="rounded-lg border border-border bg-card p-2.5"
              data-testid="measure-preview"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                  disabled={previewBusy || !previewWindow}
                  onClick={() => void handlePreview()}
                  data-testid="measure-preview-button"
                >
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                  {previewBusy ? "Calculando…" : "Testar medição agora"}
                </button>
                {!previewWindow ? (
                  <span className="text-[11px] text-muted-foreground">
                    (defina as datas da meta para testar)
                  </span>
                ) : null}
                {previewResult != null ? (
                  <span
                    className="text-xs font-semibold text-[#065F46]"
                    data-testid="measure-preview-value"
                  >
                    Hoje isso dá {formatNumberBr(Number(previewResult) || 0)}{" "}
                    {metric?.suggestedUnit ?? ""} ✔
                  </span>
                ) : null}
              </div>
              {previewError ? (
                <p className="mt-1 text-[11px] text-red-600">{previewError}</p>
              ) : null}
              {previewResult != null ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Valor da medição no período escolhido
                  {previewWindow
                    ? ` (${formatCivilDateBr(previewWindow.startDate)} a ${formatCivilDateBr(previewWindow.endDate)})`
                    : ""}
                  , calculado agora — nada foi salvo ainda.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="block space-y-1 pt-1">
            <span className={wizardLabelClass}>
              Nome do indicador (opcional — sugerimos o da medição)
            </span>
            <input
              className={wizardFieldClass}
              placeholder={metric?.label ?? "Ex.: Faturamento físico"}
              value={value.krTitle}
              onChange={(e) => patch({ krTitle: e.target.value })}
            />
          </label>
        </>
      ) : (
        <div className="space-y-2">
          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Sem medição automática: você (ou a equipe) lança o número realizado de
            tempos em tempos, e o painel acompanha do mesmo jeito.
          </p>
          <label className="block space-y-1">
            <span className={wizardLabelClass}>Nome do indicador</span>
            <input
              className={wizardFieldClass}
              placeholder="Ex.: Satisfação dos clientes (NPS)"
              value={value.krTitle}
              onChange={(e) => patch({ krTitle: e.target.value })}
              data-testid="measure-manual-title"
            />
          </label>
        </div>
      )}
    </div>
  );
}
