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
  whatItMeans: "Explicação não disponível para esta métrica na resposta atual.",
  howWeCalculate: "Informação não disponível na importação atual.",
  whatIsIncluded: "Informação não disponível na importação atual.",
  whatIsExcluded: "Informação não disponível na importação atual.",
  howToInterpret: "Atualize a conciliação ou consulte o suporte se o problema persistir.",
};

type Props = {
  title: string;
  explanation?: PortfolioIntelligenceExplanation | null;
  missingExplanation?: boolean;
};

/**
 * Ícone “?” discreto com popover ao clicar (não inventa regra — só exibe explanation da API).
 */
export function PortfolioIntelligenceHelpPopover({
  title,
  explanation,
  missingExplanation = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const content = explanation ?? FALLBACK;

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 16, 320);
    let left = rect.right - width;
    if (left < 8) left = 8;
    let top = rect.bottom + 8;
    if (top + 280 > window.innerHeight) {
      top = Math.max(8, rect.top - 288);
    }
    setPos({ top, left });
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
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground",
          "hover:border-sky-300 hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50",
          missingExplanation && "border-amber-300 text-amber-700"
        )}
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-label={`Explicação: ${title}`}
        data-testid="portfolio-intelligence-help"
        onClick={(e) => {
          e.stopPropagation();
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
              aria-label={`Como interpretar ${title}`}
              data-testid="portfolio-intelligence-help-panel"
              className="fixed z-[220] w-[min(100vw-1rem,20rem)] rounded-xl border border-border bg-popover p-3 text-[11px] leading-snug text-popover-foreground shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <p className="text-xs font-semibold text-foreground">{title}</p>
              {missingExplanation ? (
                <p className="mt-1 text-[10px] text-amber-800">
                  Explicação incompleta na API — usando texto de apoio.
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
            </div>,
            document.body
          )
        : null}
    </>
  );
}
