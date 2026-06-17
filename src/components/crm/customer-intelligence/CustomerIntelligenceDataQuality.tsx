import React from "react";
import { Info } from "lucide-react";
import type { CustomerIntelligenceDataQuality } from "@/src/lib/customerIntelligenceTypes";

export function CustomerIntelligenceDataQuality({
  dataQuality,
}: {
  dataQuality: CustomerIntelligenceDataQuality;
}) {
  if (dataQuality.warnings.length === 0 && dataQuality.missingFields.length === 0) {
    return null;
  }

  return (
    <aside className="customer-intelligence-data-quality customer-intelligence-no-print rounded-lg border border-dashed border-border/80 bg-muted/10 px-3 py-2 text-muted-foreground">
      <div className="flex items-start gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          {dataQuality.warnings.length > 0 ? (
            <ul className="list-disc pl-4 space-y-0.5">
              {dataQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {dataQuality.missingFields.length > 0 ? (
            <p className="text-[10px] opacity-80">
              Campos ausentes: {dataQuality.missingFields.join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
