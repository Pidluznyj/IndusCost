import React from "react";
import { cn } from "@/src/lib/utils";

export type OverlayTab<TId extends string = string> = {
  id: TId;
  label: React.ReactNode;
  /** Contador opcional exibido como badge após o label. */
  count?: number | string;
  /** Ícone opcional antes do label. */
  icon?: React.ReactNode;
  /** Desabilita a aba (mantém visível, mas não clicável). */
  disabled?: boolean;
};

export type OverlayTabsProps<TId extends string = string> = {
  tabs: ReadonlyArray<OverlayTab<TId>>;
  active: TId;
  onChange: (id: TId) => void;
  /**
   * Estilo visual:
   * - `underline` (padrão): aba ativa com borda inferior azul — para overlays
   *   analíticos e telas com muitas abas (auditoria, dashboards).
   * - `pill`: aba ativa como pastilha branca — para overlays com nav secundária
   *   (ex.: OrderFullAuditDialog atual).
   */
  variant?: "underline" | "pill";
  /** `data-testid` do container. Cada tab também recebe `${testId}-tab-${id}`. */
  testId?: string;
  className?: string;
  /** Rótulo acessível do tablist. */
  ariaLabel?: string;
};

/**
 * Navegação em abas para dentro de overlays. Sempre horizontal. Colocar
 * imediatamente após `<OverlayHeader>` e antes de `<OverlayBody>`.
 */
export function OverlayTabs<TId extends string = string>({
  tabs,
  active,
  onChange,
  variant = "underline",
  testId,
  className,
  ariaLabel,
}: OverlayTabsProps<TId>): JSX.Element {
  const isUnderline = variant === "underline";
  return (
    <nav
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1 border-b px-5",
        "border-[color:var(--color-overlay-border)]",
        isUnderline ? "bg-white" : "bg-[color:var(--color-overlay-surface-muted)] py-2",
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`overlay-panel-${tab.id}`}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            data-testid={testId ? `${testId}-tab-${tab.id}` : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              isUnderline
                ? cn(
                    "-mb-px border-b-2 px-3 py-2.5 font-medium",
                    isActive
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-slate-300"
                  )
                : cn(
                    "rounded-md px-3 py-1.5 font-semibold",
                    isActive
                      ? "bg-white text-foreground shadow-sm ring-1 ring-[color:var(--color-overlay-border)]"
                      : "text-muted-foreground hover:bg-white/60 hover:text-foreground"
                  )
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count != null ? (
              <span
                className={cn(
                  "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "bg-slate-100 text-slate-600"
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
