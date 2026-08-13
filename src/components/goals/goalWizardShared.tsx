/**
 * Metas (OKR) — peças reaproveitáveis da experiência conversacional
 * ("Esconder a Complexidade"). Usadas tanto pelo wizard de criação de
 * Objetivo (GoalWizardDialog) quanto pelo de adicionar Indicador a um
 * Objetivo já existente (GoalKeyResultWizardDialog) — mesma linguagem em
 * ambos os pontos de entrada, para o usuário nunca precisar adivinhar qual
 * botão "é o bonito".
 */

import React from "react";

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
