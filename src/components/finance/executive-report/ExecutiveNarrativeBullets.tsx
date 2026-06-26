import React from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function ExecutiveNarrativeBullets({
  title,
  bullets,
  emptyMessage = "Sem leitura executiva para os filtros aplicados.",
}: {
  title?: string;
  bullets: string[];
  emptyMessage?: string;
}) {
  const cardClass = cn(
    financeBiCardClass,
    "finance-executive-narrative-box p-5 space-y-3 border-l-4 border-l-[#2563EB]"
  );

  if (bullets.length === 0) {
    return (
      <div className={cardClass}>
        {title ? (
          <h3 className="finance-executive-narrative-title text-[11px] font-bold uppercase tracking-widest text-[#2563EB]">
            {title}
          </h3>
        ) : null}
        <p className="finance-executive-reading text-sm leading-relaxed text-[#374151] m-0">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cardClass} data-testid="executive-narrative-bullets">
      {title ? (
        <h3 className="finance-executive-narrative-title text-[11px] font-bold uppercase tracking-widest text-[#2563EB]">
          {title}
        </h3>
      ) : null}
      <ul className="finance-executive-narrative-bullets m-0 pl-4 space-y-2">
        {bullets.map((bullet) => (
          <li key={bullet} className="text-sm leading-relaxed text-[#374151]">
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}
