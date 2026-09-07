/**
 * Régua 1–5 da avaliação de fornecedor. Legenda visível + seletor discreto.
 * Pesos e overallScore continuam no motor — este componente só captura o inteiro.
 */
import React from "react";
import { Info } from "lucide-react";
import {
  SUPPLIER_EVALUATION_RATING_LABELS,
  SUPPLIER_EVALUATION_RATING_VALUES,
  supplierEvaluationRatingAriaLabel,
  type SupplierEvaluationRatingValue,
} from "@/src/lib/purchasing/supplierPerformance";
import { cn } from "@/src/lib/utils";

const SHORT_LABEL: Record<SupplierEvaluationRatingValue, string> = {
  1: "Não atende",
  2: "Parcial",
  3: "Atende",
  4: "Acima",
  5: "Superou",
};

/** Grupo 1–5 compacto: uma linha, sem wrap, largura uniforme. */
export const SUPPLIER_EVALUATION_RATING_GROUP_CLASS =
  "inline-flex w-max flex-nowrap whitespace-nowrap overflow-hidden rounded-md border border-border" as const;

export const SUPPLIER_EVALUATION_RATING_OPTION_CLASS =
  "h-8 w-8 shrink-0 grow-0 basis-8 rounded-none border-0 border-r border-border last:border-r-0 font-semibold tabular-nums transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50" as const;

export function SupplierEvaluationRatingLegend({ compact = false }: { compact?: boolean }) {
  const fullTitle = SUPPLIER_EVALUATION_RATING_VALUES.map(
    (value) => `${value} — ${SUPPLIER_EVALUATION_RATING_LABELS[value]}`
  ).join("\n");

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2"
      data-testid="supplier-evaluation-rating-legend"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Régua de avaliação
        </p>
        <p className={cn("mt-1 text-xs text-foreground", compact && "truncate")}>
          {SUPPLIER_EVALUATION_RATING_VALUES.map((value, index) => (
            <span key={value}>
              {index > 0 ? " · " : null}
              <span className="font-semibold">{value}</span>{" "}
              {compact ? SHORT_LABEL[value] : SUPPLIER_EVALUATION_RATING_LABELS[value]}
            </span>
          ))}
        </p>
      </div>
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground"
        title={fullTitle}
        aria-label={fullTitle.split("\n").join("; ")}
      >
        <Info className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

type SelectorProps = {
  criterionKey: string;
  criterionLabel: string;
  value: number | null;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: SupplierEvaluationRatingValue) => void;
};

export function SupplierEvaluationRatingSelector({
  criterionKey,
  criterionLabel,
  value,
  disabled = false,
  compact = false,
  onChange,
}: SelectorProps) {
  return (
    <div
      className={cn(!compact && "space-y-1")}
      data-testid={`supplier-evaluation-score-${criterionKey}`}
    >
      {compact ? (
        <span className="sr-only">{criterionLabel}</span>
      ) : (
        <p className="text-xs font-semibold text-muted-foreground">{criterionLabel}</p>
      )}
      <div
        role="radiogroup"
        aria-label={criterionLabel}
        className={SUPPLIER_EVALUATION_RATING_GROUP_CLASS}
        onKeyDown={(event) => {
          if (disabled) return;
          const values = SUPPLIER_EVALUATION_RATING_VALUES;
          const currentIndex = value == null ? -1 : values.indexOf(value as SupplierEvaluationRatingValue);
          const selectAt = (index: number) => {
            const next = values[Math.min(values.length - 1, Math.max(0, index))];
            if (next != null) onChange(next);
          };
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            selectAt(currentIndex < 0 ? 0 : currentIndex + 1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            selectAt(currentIndex < 0 ? values.length - 1 : currentIndex - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            selectAt(0);
          } else if (event.key === "End") {
            event.preventDefault();
            selectAt(values.length - 1);
          }
        }}
      >
        {SUPPLIER_EVALUATION_RATING_VALUES.map((rating) => {
          const selected = value === rating;
          const tabbable = selected || (value == null && rating === 1);
          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${criterionLabel}: ${supplierEvaluationRatingAriaLabel(rating)}`}
              title={SUPPLIER_EVALUATION_RATING_LABELS[rating]}
              tabIndex={tabbable ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(rating)}
              className={cn(
                SUPPLIER_EVALUATION_RATING_OPTION_CLASS,
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent"
              )}
            >
              {rating}
            </button>
          );
        })}
      </div>
      {!compact && value != null ? (
        <p className="text-[10px] text-muted-foreground">
          {value} — {SUPPLIER_EVALUATION_RATING_LABELS[value as SupplierEvaluationRatingValue]}
        </p>
      ) : null}
    </div>
  );
}
