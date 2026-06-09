import React from "react";
import { Lightbulb } from "lucide-react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

export function FinanceCashFlowRecommendations({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;

  return (
    <div className={`${financeBiCardClass} p-5 space-y-3`} data-testid="cash-flow-recommendations">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-[#D97706]" />
        <h3 className="text-sm font-bold text-[#111827]">Recomendações operacionais</h3>
      </div>
      <p className="text-[11px] text-[#6B7280]">
        Sugestões geradas por regras sobre os dados filtrados — sem IA externa.
      </p>
      <ul className="space-y-2">
        {lines.map((line, idx) => (
          <li
            key={idx}
            className="text-sm text-[#374151] pl-3 border-l-2 border-[#E5E7EB] leading-snug"
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
