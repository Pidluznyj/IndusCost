import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Altura do gráfico em modo apresentação (~72vh, limitada). */
export function useFinanceBiExpandedChartHeight(fallback = 560): number {
  const [height, setHeight] = useState(fallback);

  useEffect(() => {
    const update = () => {
      const next = Math.max(420, Math.min(Math.round(window.innerHeight * 0.72), 680));
      setHeight(next);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return height;
}

/**
 * Modal quase fullscreen para gráficos do Financeiro (modo apresentação).
 * Esc / botão fechar; trava scroll do body enquanto aberto.
 */
export function FinanceBiChartExpandModal({
  open,
  title,
  subtitle,
  eyebrow = "Financeiro · Fluxo de caixa",
  onClose,
  children,
  testId = "finance-bi-chart-expand-modal",
  headerAction,
  contentRef,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Faixa superior do header (contexto do módulo). */
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
  /** Ação opcional ao lado do fechar (ex.: imprimir em JPEG). */
  headerAction?: React.ReactNode;
  /** Ref opcional do card completo (header + corpo) — captura de imagem. */
  contentRef?: React.Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex flex-col bg-slate-950/70 backdrop-blur-[2px]"
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="mx-auto flex h-full w-full max-w-[1680px] flex-col px-3 py-3 sm:px-5 sm:py-4">
        <div
          ref={contentRef}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-white shadow-2xl"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E5E7EB] bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-5 py-4 text-white">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300/90">
                {eyebrow}
              </div>
              <h2 className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-1 text-sm text-slate-300 leading-snug">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAction ?? null}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 hover:bg-white/15"
                aria-label="Fechar apresentação do gráfico"
                data-testid={`${testId}-close`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
