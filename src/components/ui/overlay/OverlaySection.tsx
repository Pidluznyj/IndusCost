import React from "react";
import { cn } from "@/src/lib/utils";
import { OVERLAY_EYEBROW } from "@/src/lib/overlay/overlayTypography";

export type OverlaySectionProps = {
  /** Título curto e forte da seção. */
  title?: React.ReactNode;
  /** Descrição opcional abaixo do título. */
  description?: React.ReactNode;
  /** Slot à direita do título (chips, botões, ações). */
  actions?: React.ReactNode;
  /** Ícone à esquerda do título. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Aplica padding interno. Default: `true`. */
  padded?: boolean;
  /**
   * Estilo do container:
   * - `card` (default): fundo branco + borda — para blocos independentes.
   * - `plain`: sem borda/fundo — quando a section só precisa do cabeçalho.
   * - `muted`: fundo cinza claro — para agrupar sem competir visualmente.
   */
  variant?: "card" | "plain" | "muted";
  className?: string;
  testId?: string;
};

/**
 * Bloco/painel dentro do body do overlay. Substitui aquele padrão de
 * `<section className="rounded-xl border ...">` replicado em vários lugares.
 */
export function OverlaySection({
  title,
  description,
  actions,
  icon,
  children,
  padded = true,
  variant = "card",
  className,
  testId,
}: OverlaySectionProps): JSX.Element {
  const hasHeader = title || description || actions;
  return (
    <section
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-[var(--radius-overlay-inner)]",
        variant === "card" && "border border-[color:var(--color-overlay-border)] bg-white",
        variant === "muted" &&
          "border border-[color:var(--color-overlay-border)] bg-[color:var(--color-overlay-surface-muted)]",
        className
      )}
    >
      {hasHeader ? (
        <header
          className={cn(
            "flex items-start justify-between gap-3",
            variant === "plain" ? "mb-2" : "border-b border-[color:var(--color-overlay-border)] px-3 py-2"
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {icon ? <span className="text-muted-foreground">{icon}</span> : null}
              {title ? (
                <h3 className={OVERLAY_EYEBROW}>{title}</h3>
              ) : null}
            </div>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(padded && variant !== "plain" && "px-3 py-3")}>
        {children}
      </div>
    </section>
  );
}
