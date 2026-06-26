import React from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function ExecutiveNarrativeBox({
  title,
  body,
}: {
  title?: string;
  body: string;
}) {
  return (
    <div
      className={cn(
        financeBiCardClass,
        "finance-executive-narrative-box p-5 space-y-2 border-l-4 border-l-[#2563EB]"
      )}
    >
      {title ? (
        <h3 className="finance-executive-narrative-title text-[11px] font-bold uppercase tracking-widest text-[#2563EB]">
          {title}
        </h3>
      ) : null}
      <p className="finance-executive-reading text-sm leading-relaxed text-[#374151] m-0">{body}</p>
    </div>
  );
}
