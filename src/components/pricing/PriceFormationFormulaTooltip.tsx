import React, { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/src/lib/utils";

/**
 * Ícone de informação + tooltip rico mostrando a fórmula de formação de preço,
 * com o termo de frete destacado — frete% é fração do custo (não do preço),
 * por isso fica fora do divisor.
 */
export function PriceFormationFormulaTooltip({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label="Ver fórmula da formação de preço"
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex shrink-0 cursor-help items-center border-0 bg-transparent p-0 text-[#6B7280] hover:text-[#2563EB] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40 rounded-sm"
        data-testid="price-formation-formula-info"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          role="tooltip"
          data-testid="price-formation-formula-tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-[#E5E7EB] bg-white p-3 text-[11px] leading-snug text-[#111827] shadow-lg"
        >
          <p className="mb-1.5 font-bold uppercase tracking-wide text-[10px] text-[#6B7280]">
            Fórmula da formação de preço
          </p>
          <p className="font-mono tabular-nums">
            PV = (custo + <span className="font-semibold text-red-600">freteR$</span>) ÷
            (1 − imposto − comissão − outros − margem)
          </p>
          <p className="mt-1.5 font-mono tabular-nums">
            <span className="font-semibold text-red-600">freteR$</span> = custo ×{" "}
            <span className="font-semibold text-red-600">frete%</span>
          </p>
          <p className="mt-2 text-[#6B7280]">
            Frete% é fração do <strong>custo</strong>, somado no numerador — não do preço
            final. Por isso não escala junto com a margem entre as faixas comerciais.
          </p>
        </div>
      ) : null}
    </span>
  );
}
