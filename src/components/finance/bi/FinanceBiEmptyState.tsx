import React from "react";
import { BarChart3 } from "lucide-react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

export function FinanceBiEmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={`${financeBiCardClass} px-6 py-12 text-center`}>
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[#6B7280]">
        {icon ?? <BarChart3 className="h-5 w-5" />}
      </div>
      <p className="text-sm font-semibold text-[#111827]">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-[#6B7280] max-w-md mx-auto">{description}</p>
      ) : null}
    </div>
  );
}
