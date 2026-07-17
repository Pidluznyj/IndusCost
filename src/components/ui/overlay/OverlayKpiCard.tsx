import React from "react";
import { cn } from "@/src/lib/utils";
import {
  OVERLAY_KPI_VALUE,
  OVERLAY_KPI_VALUE_SM,
  OVERLAY_LABEL_DENSE,
} from "@/src/lib/overlay/overlayTypography";

export type OverlayKpiCardTone =
  | "neutral"
  | "positive"
  | "negative"
  | "warning"
  | "info";

const TONE_ACCENT: Record<OverlayKpiCardTone, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-600",
  negative: "text-rose-600",
  warning: "text-amber-600",
  info: "text-sky-600",
};

const TONE_HINT: Record<OverlayKpiCardTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-emerald-600",
  negative: "text-rose-600",
  warning: "text-amber-600",
  info: "text-sky-600",
};

export type OverlayKpiCardProps = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Nota abaixo do valor (ex.: variação, contagem, descrição). */
  hint?: React.ReactNode;
  /** Ícone à direita do label. */
  icon?: React.ReactNode;
  /** Slot no rodapé do card (ex.: mini-gráfico, chip). */
  footer?: React.ReactNode;
  /** Cor semântica do valor. */
  tone?: OverlayKpiCardTone;
  /** Tamanho do valor. `sm` para grids densos (>4 cards). Default: `default`. */
  size?: "default" | "sm";
  className?: string;
  testId?: string;
  /** Se `true`, renderiza como botão clicável. */
  onClick?: () => void;
};

/**
 * Card de indicador (KPI) para uso dentro de overlays. Fundo branco, borda
 * fina, label uppercase e valor com tipografia forte (`font-black`) para
 * criar o contraste analítico do design system High Density.
 *
 * Para grids: usar `<OverlayKpiCardGrid>` (mesmo arquivo) ou compor com
 * `grid grid-cols-2 md:grid-cols-4 gap-3`.
 */
export function OverlayKpiCard({
  label,
  value,
  hint,
  icon,
  footer,
  tone = "neutral",
  size = "default",
  className,
  testId,
  onClick,
}: OverlayKpiCardProps): React.ReactElement {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-[var(--radius-overlay-inner)] border bg-white p-3 text-left",
        "border-[color:var(--color-overlay-border)]",
        onClick && "transition-colors hover:border-primary/40 hover:bg-primary/5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn(OVERLAY_LABEL_DENSE, "truncate")}>{label}</span>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <div
        className={cn(
          size === "sm" ? OVERLAY_KPI_VALUE_SM : OVERLAY_KPI_VALUE,
          "truncate",
          TONE_ACCENT[tone]
        )}
      >
        {value}
      </div>
      {hint ? (
        <p className={cn("truncate text-[11px]", TONE_HINT[tone])}>{hint}</p>
      ) : null}
      {footer ? <div className="mt-1">{footer}</div> : null}
    </Wrapper>
  );
}

/**
 * Grid responsivo para KPI cards. 1 coluna no mobile, 2 no `sm`, 4 no `md`.
 */
export function OverlayKpiCardGrid({
  children,
  className,
  columns = 4,
}: {
  children: React.ReactNode;
  className?: string;
  columns?: 2 | 3 | 4 | 5 | 6;
}): React.ReactElement {
  const columnsClass: Record<number, string> = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 md:grid-cols-3",
    4: "sm:grid-cols-2 md:grid-cols-4",
    5: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
    6: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
  };
  return (
    <div className={cn("grid grid-cols-1 gap-3", columnsClass[columns], className)}>
      {children}
    </div>
  );
}
