import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { cn } from "@/src/lib/utils";

export type PortfolioIntelligenceExplanation = {
  whatItMeans: string;
  howWeCalculate: string;
  whatIsIncluded: string;
  whatIsExcluded: string;
  howToInterpret: string;
};

const FALLBACK: PortfolioIntelligenceExplanation = {
  whatItMeans: "Ainda não temos uma explicação completa para este indicador nesta tela.",
  howWeCalculate: "Informação não disponível na importação atual.",
  whatIsIncluded: "Informação não disponível na importação atual.",
  whatIsExcluded: "Informação não disponível na importação atual.",
  howToInterpret:
    "Use o número com cautela até a conciliação trazer a explicação completa.",
};

const OPERATIONAL_NOTICE =
  "Este indicador é operacional (evidência da carteira comercial). Não substitui Fluxo de Caixa, Contas a Receber oficial nem Relatório Presidencial.";

const SECTIONS: Array<{
  key: keyof PortfolioIntelligenceExplanation;
  label: string;
}> = [
  { key: "whatItMeans", label: "O que significa?" },
  { key: "howWeCalculate", label: "Como calculamos?" },
  { key: "whatIsIncluded", label: "O que entra?" },
  { key: "whatIsExcluded", label: "O que não entra?" },
  { key: "howToInterpret", label: "Como interpretar?" },
];

type Props = {
  title: string;
  explanation?: PortfolioIntelligenceExplanation | null;
  missingExplanation?: boolean;
  showOperationalNotice?: boolean;
  className?: string;
  corner?: boolean;
};

/**
 * MetricHelpTooltip — ícone “?” discreto com popover padronizado (acessível).
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
      const width = Math.min(window.innerWidth - 16, 360);
      const approxHeight = 400;
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
      className={cn(corner && "absolute right-2 top-2 z-10", className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-white/95 text-muted-foreground shadow-sm",
          "hover:border-sky-300 hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50",
          incomplete && "border-amber-300/90 text-amber-700"
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
              className="fixed z-[220] max-h-[min(72vh,30rem)] w-[min(100vw-1rem,22.5rem)] overflow-y-auto rounded-2xl border border-border/80 bg-popover p-0 text-[12px] leading-relaxed text-popover-foreground shadow-2xl"
              style={{ top: pos.top, left: pos.left }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-start justify-between gap-2 border-b border-border/60 bg-popover/95 px-3.5 py-2.5 backdrop-blur">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ajuda do indicador
                  </p>
                  <p className="truncate text-sm font-semibold text-foreground">{title}</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-border/70 p-1 text-muted-foreground hover:bg-muted/50"
                  aria-label="Fechar ajuda"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-3 px-3.5 py-3">
                {incomplete ? (
                  <p className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-950">
                    Explicação incompleta na origem — usando texto de apoio.
                  </p>
                ) : null}
                <dl className="space-y-3">
                  {SECTIONS.map((section) => (
                    <div key={section.key}>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {section.label}
                      </dt>
                      <dd className="mt-0.5 text-[12px] text-foreground">
                        {content[section.key]}
                      </dd>
                    </div>
                  ))}
                </dl>
                {showOperationalNotice ? (
                  <p
                    className="rounded-xl border border-sky-200/70 bg-sky-50/60 px-2.5 py-2 text-[11px] leading-relaxed text-sky-950"
                    data-testid="portfolio-intelligence-help-operational"
                  >
                    {OPERATIONAL_NOTICE}
                  </p>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

export const PortfolioIntelligenceHelpPopover = MetricHelpTooltip;
