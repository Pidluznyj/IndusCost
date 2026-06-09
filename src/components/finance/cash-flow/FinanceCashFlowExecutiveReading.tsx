import React from "react";
import { FileText } from "lucide-react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

export function FinanceCashFlowExecutiveReading({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;

  return (
    <div
      data-testid="cash-flow-executive-reading"
      className={`${financeBiCardClass} p-5 space-y-3 border-l-4 border-l-[#2563EB]`}
    >
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-[#2563EB] shrink-0" />
        <h3 className="text-sm font-bold text-[#111827]">Leitura executiva do caixa</h3>
      </div>
      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line} className="text-sm text-[#374151] leading-relaxed pl-0.5">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
