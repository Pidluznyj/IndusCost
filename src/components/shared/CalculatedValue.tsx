import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { CalculationExplanation } from "@/src/types/calculation";

type Props = {
  /** Metadado vindo do backend (ou helper único no cliente); se ausente, renderiza só children. */
  meta?: CalculationExplanation | null;
  children: React.ReactNode;
  className?: string;
  /** Esconder ícone de info (ex.: tabela densa). */
  hideIcon?: boolean;
};

function TooltipBody({ meta, id }: { meta: CalculationExplanation; id: string }) {
  return (
    <div
      id={id}
      role="tooltip"
      className="rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-4 w-[min(100vw-2rem,22rem)] text-[11px] space-y-3 leading-snug z-[200]"
    >
      <div>
        <p className="font-bold text-xs text-foreground">{meta.title}</p>
        {meta.description && <p className="text-muted-foreground mt-1">{meta.description}</p>}
      </div>
      {meta.formulaText && (
        <div className="bg-accent/40 rounded-lg px-2 py-1.5 font-mono text-[10px] whitespace-pre-wrap">
          {meta.formulaText}
        </div>
      )}
      {meta.inputs && meta.inputs.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">Valores usados</p>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {meta.inputs.map((row, i) => (
              <li key={i} className="flex justify-between gap-2 border-b border-border/50 pb-0.5 last:border-0">
                <span className="text-muted-foreground shrink">{row.label}</span>
                <span className="font-mono text-right">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta.resultLabel != null && meta.resultValue != null && Number.isFinite(meta.resultValue) && (
        <div className="flex justify-between items-baseline pt-1 border-t border-border">
          <span className="font-bold">{meta.resultLabel}</span>
          <span className="font-mono font-bold text-primary">
            {meta.resultValue.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
          </span>
        </div>
      )}
      {meta.notes && <p className="text-amber-800/90 dark:text-amber-200/90 text-[10px]">{meta.notes}</p>}
      {meta.warnings && meta.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 space-y-1">
          <p className="text-[9px] font-bold uppercase text-amber-800 dark:text-amber-200">Alertas</p>
          {meta.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-900 dark:text-amber-100">
              • {w}
            </p>
          ))}
        </div>
      )}
      {meta.source && (
        <p className="text-[9px] text-muted-foreground border-t border-border pt-2">Fonte: {meta.source}</p>
      )}
    </div>
  );
}

/**
 * Valor numérico com painel explicativo (hover, foco, teclado e toque).
 * Sem `meta`, comporta-se como fragmento visual simples.
 */
export function CalculatedValue({ meta, children, className, hideIcon }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelWidth = Math.min(window.innerWidth - 16, 22 * 16);
    let left = r.left + r.width / 2 - panelWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    let top = r.bottom + 8;
    const estHeight = 280;
    if (top + estHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - estHeight - 8);
    }
    setCoords({ top, left });
  }, []);

  useEffect(() => {
    if (!open || !meta) return;
    reposition();
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, meta, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(t)) {
        const portal = document.getElementById(tooltipId);
        if (portal && portal.contains(t)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, tooltipId]);

  if (!meta) {
    return <span className={className}>{children}</span>;
  }

  const panel = open
    ? createPortal(
        <div
          id={tooltipId}
          className="fixed z-[199] pointer-events-auto"
          style={{ top: coords.top, left: coords.left, width: "min(100vw - 2rem, 22rem)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <TooltipBody meta={meta} id={`${tooltipId}-desc`} />
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <span
        ref={wrapRef}
        className={cn("inline-flex items-center gap-1 max-w-full", className)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && wrapRef.current?.contains(next)) return;
          setOpen(false);
        }}
        tabIndex={0}
        role="button"
        aria-label={hideIcon ? "Ver explicação do cálculo" : undefined}
        aria-expanded={open}
        aria-describedby={open ? `${tooltipId}-desc` : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="min-w-0">{children}</span>
        {!hideIcon && <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-70" aria-hidden />}
      </span>
      {panel}
    </>
  );
}
