import React from "react";
import { cn } from "@/src/lib/utils";

/**
 * Tons semânticos do sistema. Alinhados aos usos já existentes:
 * - `sky`: status operacional (fulfillment, entregas, expedição)
 * - `emerald`: status financeiro positivo (baixa, recebimento, sucesso)
 * - `amber`: alertas, atenção, dados em revisão
 * - `rose`: erros, divergências críticas, exclusões
 * - `violet`: comercial (proposta, comissão, CRM)
 * - `slate`: neutro (chip informativo, metadados)
 * - `primary`: destaque de marca (KPI de negócio, filtro ativo)
 */
export type OverlayBadgeTone =
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "slate"
  | "primary";

const TONE_SOLID: Record<OverlayBadgeTone, string> = {
  sky: "bg-sky-500 text-white",
  emerald: "bg-emerald-500 text-white",
  amber: "bg-amber-500 text-white",
  rose: "bg-rose-500 text-white",
  violet: "bg-violet-500 text-white",
  slate: "bg-slate-500 text-white",
  primary: "bg-primary text-primary-foreground",
};

const TONE_SOFT: Record<OverlayBadgeTone, string> = {
  sky: "bg-sky-50 text-sky-800 border border-sky-200",
  emerald: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  amber: "bg-amber-50 text-amber-900 border border-amber-200",
  rose: "bg-rose-50 text-rose-800 border border-rose-200",
  violet: "bg-violet-50 text-violet-800 border border-violet-200",
  slate: "bg-slate-50 text-slate-700 border border-slate-200",
  primary: "bg-primary/10 text-primary border border-primary/20",
};

const TONE_OUTLINE: Record<OverlayBadgeTone, string> = {
  sky: "border-sky-300 text-sky-700",
  emerald: "border-emerald-300 text-emerald-700",
  amber: "border-amber-300 text-amber-800",
  rose: "border-rose-300 text-rose-700",
  violet: "border-violet-300 text-violet-700",
  slate: "border-slate-300 text-slate-600",
  primary: "border-primary/30 text-primary",
};

export type OverlayBadgeProps = {
  children: React.ReactNode;
  /** Variante visual. Default: `soft`. */
  variant?: "solid" | "soft" | "outline";
  tone?: OverlayBadgeTone;
  /** Ícone à esquerda do texto. */
  icon?: React.ReactNode;
  /** `data-testid` opcional. */
  testId?: string;
  className?: string;
  /** Renderiza como `<button>` clicável. */
  onClick?: () => void;
  /** Se `true`, aumenta padding e usa peso `font-semibold`. */
  emphasized?: boolean;
  title?: string;
};

/**
 * Chip/pill semântico usado dentro de overlays (header, KPI cards, listas).
 * Substitui as pastilhas replicadas em vários lugares (sky/emerald/amber/rose).
 */
export function OverlayBadge({
  children,
  variant = "soft",
  tone = "slate",
  icon,
  testId,
  className,
  onClick,
  emphasized = false,
  title,
}: OverlayBadgeProps): JSX.Element {
  const toneClass =
    variant === "solid"
      ? TONE_SOLID[tone]
      : variant === "outline"
        ? cn("border bg-transparent", TONE_OUTLINE[tone])
        : TONE_SOFT[tone];
  const Component = onClick ? "button" : "span";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 rounded-md text-[11px] leading-tight",
        emphasized ? "px-2.5 py-1 font-semibold" : "px-2 py-0.5 font-medium",
        toneClass,
        onClick && "cursor-pointer transition-opacity hover:opacity-80",
        className
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </Component>
  );
}
