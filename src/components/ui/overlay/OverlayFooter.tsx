import React from "react";
import { cn } from "@/src/lib/utils";

export type OverlayFooterProps = {
  children: React.ReactNode;
  /** Alinhamento das ações. Default: `end` (direita). */
  align?: "start" | "center" | "end" | "between";
  /** Slot secundário à esquerda (ex.: aviso "Auto-save"). Ignorado se `align="between"`. */
  hint?: React.ReactNode;
  className?: string;
  testId?: string;
};

const ALIGN_CLASS: Record<NonNullable<OverlayFooterProps["align"]>, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

/**
 * Barra de ações fixa no rodapé do overlay. Fundo levemente cinza para
 * separar do body sem gritar. Deve ser o último filho de `<Overlay>`.
 */
export function OverlayFooter({
  children,
  align = "end",
  hint,
  className,
  testId,
}: OverlayFooterProps): JSX.Element {
  return (
    <footer
      data-testid={testId}
      className={cn(
        "flex shrink-0 items-center gap-3 border-t px-5 py-3",
        "border-[color:var(--color-overlay-border)]",
        "bg-[color:var(--color-overlay-surface-muted)]",
        ALIGN_CLASS[align],
        className
      )}
    >
      {hint && align !== "between" ? (
        <div className="mr-auto text-xs text-muted-foreground">{hint}</div>
      ) : null}
      {children}
    </footer>
  );
}
