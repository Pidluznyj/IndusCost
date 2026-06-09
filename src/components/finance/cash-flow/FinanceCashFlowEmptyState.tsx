import React from "react";
import { BarChart3 } from "lucide-react";
import { controlRoomCardClass } from "@/src/lib/financeControlRoomTheme";

export function FinanceCashFlowEmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className={`${controlRoomCardClass} px-5 py-10 text-center`}>
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md border border-[#E7E5E4] bg-[#F5F5F4] text-[#57534E]">
        <BarChart3 className="h-4 w-4" />
      </div>
      <p className="font-ui text-sm font-semibold text-[#1C1917]">{title}</p>
      {description ? (
        <p className="font-mono text-[10px] text-[#57534E] max-w-md mx-auto mt-1">{description}</p>
      ) : null}
    </div>
  );
}
