/**
 * IndusCost Design System — bloco executivo de resumo/KPI.
 *
 * Composição: título contextual + grid de SummaryKpiCard / MetricCard.
 * Referência visual: "Resumo geral dos centros filtrados" (Mapa de Centros).
 */

import React from "react";
import { cn } from "@/src/lib/utils";
import "./executive-summary-section.css";

export type ExecutiveSummarySectionProps = {
  /** Título principal da seção, ex.: "Resumo geral dos centros filtrados". */
  title: string;
  /** Linha de contexto acima do título (uppercase discreto). */
  eyebrow?: string;
  /** Ações à direita do cabeçalho (ex.: limpar seleção). */
  actions?: React.ReactNode;
  /** Rodapé opcional abaixo do grid. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** data-testid da seção — padrão executive-summary-section. */
  testId?: string;
  /** Sem borda/sombra própria — quando aninhado em outro painel (ex.: sync Nomus). */
  embedded?: boolean;
};

export function ExecutiveSummarySection({
  title,
  eyebrow,
  actions,
  footer,
  children,
  className,
  testId = "executive-summary-section",
  embedded = false,
}: ExecutiveSummarySectionProps) {
  return (
    <section
      className={cn(
        "executive-summary-section",
        embedded && "executive-summary-section--embedded",
        className
      )}
      data-testid={testId}
      aria-label={title}
    >
      <header className="executive-summary-section__header">
        <div className="executive-summary-section__titles">
          {eyebrow ? (
            <p className="executive-summary-section__eyebrow">{eyebrow}</p>
          ) : null}
          <h3 className="executive-summary-section__title">{title}</h3>
        </div>
        {actions ? (
          <div className="executive-summary-section__actions">{actions}</div>
        ) : null}
      </header>

      {children}

      {footer ? (
        <footer className="executive-summary-section__footer">{footer}</footer>
      ) : null}
    </section>
  );
}
