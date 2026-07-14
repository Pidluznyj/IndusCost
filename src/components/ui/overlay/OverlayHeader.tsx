import React from "react";
import { X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  OVERLAY_EYEBROW,
  OVERLAY_SUBTITLE,
  OVERLAY_TITLE,
  OVERLAY_TITLE_LG,
} from "@/src/lib/overlay/overlayTypography";

/**
 * Variantes de header:
 * - `flat` (padrão): fundo branco com eyebrow colorido — preserva a identidade
 *   atual (padrão nos modais financeiros e de materiais). Recomendado para 90%
 *   dos casos.
 * - `solid`: fundo azul corporativo com texto branco — reservado para overlays
 *   de decisão crítica ou "hero" analítico (auditorias 360º, wizards).
 */
export type OverlayHeaderVariant = "flat" | "solid";

/**
 * Densidade de tipografia:
 * - `default`: título em `text-lg` — cadastros, edições, cotações.
 * - `prominent`: título em `text-2xl font-black` — dashboards, auditorias.
 */
export type OverlayHeaderDensity = "default" | "prominent";

export type OverlayHeaderProps = {
  /** Título principal do overlay. */
  title: React.ReactNode;
  /** Contexto do módulo acima do título. Ex.: "Financeiro · Conciliação". */
  eyebrow?: React.ReactNode;
  /** Descrição curta abaixo do título. */
  subtitle?: React.ReactNode;
  /** Slot à direita — chips, badges, botões de ação. */
  actions?: React.ReactNode;
  /** Handler do botão de fechar. Se omitido, o botão não é renderizado. */
  onClose?: () => void;
  /** Rótulo acessível do botão fechar. Default: "Fechar". */
  closeLabel?: string;
  /** Id do título (para vincular ao `aria-labelledby` do dialog). */
  titleId?: string;
  variant?: OverlayHeaderVariant;
  density?: OverlayHeaderDensity;
  className?: string;
  testId?: string;
};

/**
 * Header canônico de overlays. Sempre renderizar como PRIMEIRO filho de
 * `<Overlay>` — o `Overlay` cuida do body scrollável e do footer.
 */
export function OverlayHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  onClose,
  closeLabel = "Fechar",
  titleId,
  variant = "flat",
  density = "default",
  className,
  testId,
}: OverlayHeaderProps): JSX.Element {
  const isSolid = variant === "solid";
  const titleClass = density === "prominent" ? OVERLAY_TITLE_LG : OVERLAY_TITLE;

  return (
    <header
      data-testid={testId}
      className={cn(
        "flex shrink-0 items-start justify-between gap-3 px-5 py-4",
        isSolid
          ? "bg-[color:var(--color-overlay-header-solid)] text-[color:var(--color-overlay-header-solid-foreground)]"
          : "border-b border-[color:var(--color-overlay-border)] bg-white",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p
            className={cn(
              OVERLAY_EYEBROW,
              isSolid && "text-white/70"
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={titleId}
          className={cn(
            titleClass,
            "truncate",
            isSolid && "text-white"
          )}
        >
          {title}
        </h2>
        {subtitle ? (
          <p className={cn(OVERLAY_SUBTITLE, "mt-0.5", isSolid && "text-white/80")}>
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
              isSolid
                ? "bg-white/10 text-white hover:bg-white/20"
                : "border border-[color:var(--color-overlay-border)] text-foreground hover:bg-[color:var(--color-overlay-surface-muted)]"
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{closeLabel}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
