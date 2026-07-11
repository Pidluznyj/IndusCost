import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { cn } from "@/src/lib/utils";

export type PortfolioIntelligenceExplanation = {
  whatItMeans: string;
  howWeCalculate: string;
  whatIsIncluded: string;
  whatIsExcluded: string;
  howToInterpret: string;
};

const FALLBACK: PortfolioIntelligenceExplanation = {
  whatItMeans: "Ainda não temos uma explicação completa para esta métrica nesta tela.",
  howWeCalculate: "Informação não disponível na importação atual.",
  whatIsIncluded: "Informação não disponível na importação atual.",
  whatIsExcluded: "Informação não disponível na importação atual.",
  howToInterpret:
    "Trate o número com cautela até a conciliação trazer a explicação completa.",
};

const OPERATIONAL_NOTICE =
  "Atenção: esta é uma métrica operacional/evidencial da Central de Inteligência. Não substitui o Fluxo de Caixa, Contas a Receber oficial nem o Relatório Presidencial.";

type Props = {
  title: string;
  explanation?: PortfolioIntelligenceExplanation | null;
  missingExplanation?: boolean;
  /** Mostra aviso de métrica operacional (padrão: true). */
  showOperationalNotice?: boolean;
  className?: string;
  /** Posição do botão no card (canto superior direito). */
  corner?: boolean;
};

/**
 * MetricHelpTooltip — ícone “?” discreto com popover padronizado (acessível).
 * Alias exportado também como PortfolioIntelligenceHelpPopover.
 */
export function MetricHelpTooltip({
  title,
  explanation,
  missingExplanation = false,
  showOperationalNotice = true,
  className,
  corner = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const content = explanation ?? FALLBACK;
  const incomplete = missingExplanation || !explanation;

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const place = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const width = Math.min(window.innerWidth - 16, 340);
      const approxHeight = 360;
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      let top = rect.bottom + 8;
      if (top + approxHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - approxHeight - 8);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <span
      className={cn(corner && "absolute right-1.5 top-1.5 z-10", className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm",
          "hover:border-sky-300 hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50",
          incomplete && "border-amber-300 text-amber-700"
        )}
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-haspopup="dialog"
        aria-label={`Ajuda: ${title}`}
        data-testid="portfolio-intelligence-help"
        data-metric-help={title}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              id={tooltipId}
              role="dialog"
              aria-modal="false"
              aria-label={`Como interpretar ${title}`}
              data-testid="portfolio-intelligence-help-panel"
              className="fixed z-[220] max-h-[min(70vh,28rem)] w-[min(100vw-1rem,21rem)] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-[11px] leading-snug text-popover-foreground shadow-xl"
              style={{ top: pos.top, left: pos.left }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p className="text-xs font-semibold text-foreground">{title}</p>
              {incomplete ? (
                <p className="mt-1 text-[10px] text-amber-800">
                  Explicação incompleta na origem — usando texto de apoio.
                </p>
              ) : null}
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="font-semibold text-muted-foreground">O que significa?</dt>
                  <dd className="text-foreground">{content.whatItMeans}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">Como calculamos?</dt>
                  <dd className="text-foreground">{content.howWeCalculate}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">O que entra?</dt>
                  <dd className="text-foreground">{content.whatIsIncluded}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">O que não entra?</dt>
                  <dd className="text-foreground">{content.whatIsExcluded}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">Como interpretar?</dt>
                  <dd className="text-foreground">{content.howToInterpret}</dd>
                </div>
              </dl>
              {showOperationalNotice ? (
                <p
                  className="mt-3 rounded-md border border-sky-200/80 bg-sky-50/70 px-2 py-1.5 text-[10px] text-sky-950"
                  data-testid="portfolio-intelligence-help-operational"
                >
                  {OPERATIONAL_NOTICE}
                </p>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

/** Nome legado — mesmo componente. */
export const PortfolioIntelligenceHelpPopover = MetricHelpTooltip;
