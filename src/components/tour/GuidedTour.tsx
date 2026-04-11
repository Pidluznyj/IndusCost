import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/src/lib/utils";

export interface GuidedTourStep {
  /** Valor do atributo `data-tour` no elemento alvo */
  target: string;
  title: string;
  description: string;
  /** Se o elemento não existir, o passo é pulado automaticamente */
  optional?: boolean;
}

export interface GuidedTourProps {
  open: boolean;
  onClose: () => void;
  steps: GuidedTourStep[];
  tourName?: string;
}

function queryTarget(target: string): Element | null {
  try {
    return document.querySelector(`[data-tour="${CSS.escape(target)}"]`);
  } catch {
    return document.querySelector(`[data-tour="${target}"]`);
  }
}

export function GuidedTour({ open, onClose, steps, tourName = "Tour guiado" }: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const skipGuard = useRef(0);

  const safeSteps = useMemo(() => (Array.isArray(steps) ? steps.filter((s) => s?.target) : []), [steps]);
  const current = safeSteps[stepIndex];

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      setRect(null);
      skipGuard.current = 0;
    }
  }, [open]);

  useEffect(() => {
    if (open && safeSteps.length > 0 && (stepIndex < 0 || stepIndex >= safeSteps.length)) {
      onClose();
    }
  }, [open, stepIndex, safeSteps.length, onClose]);

  /** Atualiza retângulo do highlight e trata passos opcionais ausentes */
  useLayoutEffect(() => {
    if (!open || safeSteps.length === 0) return;

    const MAX_SKIPS = 24;
    const step = safeSteps[stepIndex];
    if (!step) {
      onClose();
      return;
    }

    const el = queryTarget(step.target);
    if (!el) {
      if (step.optional && skipGuard.current < MAX_SKIPS) {
        skipGuard.current += 1;
        if (stepIndex < safeSteps.length - 1) {
          setStepIndex((i) => i + 1);
        } else {
          onClose();
        }
        return;
      }
      setRect(null);
      return;
    }

    skipGuard.current = 0;
    const update = () => {
      const t = queryTarget(step.target);
      if (t) setRect(t.getBoundingClientRect());
    };
    update();
    try {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, stepIndex, safeSteps, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const goNext = useCallback(() => {
    skipGuard.current = 0;
    if (stepIndex < safeSteps.length - 1) setStepIndex((i) => i + 1);
    else onClose();
  }, [stepIndex, safeSteps.length, onClose]);

  const goPrev = useCallback(() => {
    skipGuard.current = 0;
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  if (!open || safeSteps.length === 0) return null;
  if (!current) return null;

  const isLast = stepIndex >= safeSteps.length - 1;
  const el = queryTarget(current.target);
  const missingRequired = Boolean(current && !el && !current.optional);
  const showHighlight = Boolean(rect && rect.width > 0 && rect.height > 0 && !missingRequired);

  const cardPosition = useMemo(() => {
    if (!rect || missingRequired) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" as const };
    }
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + margin;
    let left = rect.left;
    const cardW = Math.min(360, vw - 24);
    if (left + cardW > vw - 12) left = vw - cardW - 12;
    if (left < 12) left = 12;
    if (top + 240 > vh) top = Math.max(12, rect.top - margin - 210);
    return { top: `${top}px`, left: `${left}px`, transform: "none" as const };
  }, [rect, missingRequired]);

  const node = (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label={tourName}>
      <button
        type="button"
        className="absolute inset-0 bg-black/45 cursor-default border-0 p-0"
        aria-label="Fechar tour"
        onClick={onClose}
      />

      {showHighlight && rect && (
        <div
          className="absolute pointer-events-none rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_0_9999px_rgba(0,0,0,0.38)] transition-all duration-200 z-[201]"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}

      <div
        className={cn(
          "absolute z-[202] w-[min(360px,calc(100vw-24px))] rounded-2xl border border-border bg-card p-5 shadow-2xl pointer-events-auto",
          (missingRequired || !rect) && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        )}
        style={
          !missingRequired && rect
            ? { top: cardPosition.top, left: cardPosition.left, transform: cardPosition.transform }
            : undefined
        }
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-base font-bold leading-tight pr-6">{current?.title ?? "Tour"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
            aria-label="Fechar tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {missingRequired && (
          <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-500/15 rounded-lg px-3 py-2 mb-3">
            Este trecho não está visível no momento (outra aba ou conteúdo ainda carregando). Avance ou feche o
            tour.
          </p>
        )}
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{current?.description}</p>
        <div className="flex items-center justify-between gap-2 mt-5 pt-4 border-t border-border">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {stepIndex + 1} / {safeSteps.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={stepIndex === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </button>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-primary text-primary-foreground"
            >
              {isLast ? "Concluir" : "Avançar"}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">Esc para fechar · clique no fundo escuro para fechar</p>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
