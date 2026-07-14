import React, { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/src/lib/utils";

/**
 * Larguras canônicas para overlays.
 * - sm: forms curtos (confirmações, notas)
 * - md: forms padrão de cadastro/edição
 * - lg: painéis com abas ou grid de KPIs
 * - xl: dashboards e telas de detalhe
 * - full: auditorias 360º, telas quase full-screen
 */
export type OverlaySize = "sm" | "md" | "lg" | "xl" | "full";

const SIZE_CLASS: Record<OverlaySize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[1680px]",
};

export type OverlayProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Tamanho do container. Default: `lg`. */
  size?: OverlaySize;
  /** Fecha ao clicar no backdrop. Default: `true`. */
  dismissOnBackdrop?: boolean;
  /** Fecha ao pressionar Esc. Default: `true`. */
  dismissOnEsc?: boolean;
  /** Rótulo acessível quando não houver `aria-labelledby`. */
  ariaLabel?: string;
  /** Id do elemento que rotula o dialog (geralmente o `<h*>` do header). */
  ariaLabelledBy?: string;
  /** Id do elemento que descreve o dialog. */
  ariaDescribedBy?: string;
  /** `data-testid` do container do overlay. */
  testId?: string;
  /** Classes extras aplicadas ao container do dialog (não ao backdrop). */
  className?: string;
  /**
   * Container do portal. Se omitido, usa `document.body`. Aceita função
   * lazy para casos SSR/portal customizado.
   */
  container?: HTMLElement | (() => HTMLElement | null) | null;
};

/**
 * Shell base de todo overlay do sistema.
 *
 * - Renderiza via portal em `document.body` (evita bugs de z-index/stacking).
 * - Backdrop escurece o fundo (`--color-overlay-scrim`).
 * - Fecha em Esc e no click-outside (configurável).
 * - Trava o scroll da página enquanto está aberto.
 * - Move foco para o container ao abrir.
 *
 * Compor com `<OverlayHeader>`, `<OverlayBody>` e `<OverlayFooter>`.
 */
export function Overlay({
  open,
  onClose,
  children,
  size = "lg",
  dismissOnBackdrop = true,
  dismissOnEsc = true,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  testId,
  className,
  container,
}: OverlayProps): React.ReactPortal | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!dismissOnBackdrop) return;
      if (event.target === event.currentTarget) onClose();
    },
    [dismissOnBackdrop, onClose]
  );

  useEffect(() => {
    if (!open || !dismissOnEsc) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissOnEsc, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const resolvedContainer =
    typeof container === "function" ? container() : container ?? document.body;
  if (!resolvedContainer) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto p-4 sm:items-center"
      style={{ backgroundColor: "var(--color-overlay-scrim)" }}
      onClick={handleBackdropClick}
      data-testid={testId}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={cn(
          "flex w-full flex-col overflow-hidden bg-white outline-none",
          "border border-[color:var(--color-overlay-border)]",
          "rounded-[var(--radius-overlay)] shadow-[var(--shadow-overlay)]",
          "max-h-[calc(100vh-2rem)]",
          SIZE_CLASS[size],
          className
        )}
      >
        {children}
      </div>
    </div>,
    resolvedContainer
  );
}

/**
 * Corpo rolável do overlay. Coloca `flex-1` + `overflow-y-auto` — deixa o
 * header/footer fixos e só o conteúdo rola.
 */
export function OverlayBody({
  children,
  className,
  padded = true,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  /** Aplica padding padrão (`px-5 py-4`). Default: `true`. */
  padded?: boolean;
  testId?: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto",
        padded && "px-5 py-4",
        className
      )}
    >
      {children}
    </div>
  );
}
