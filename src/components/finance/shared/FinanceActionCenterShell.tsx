import React from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

type Props = {
  title?: string;
  subtitle?: string;
  badgeCount?: number;
  children: React.ReactNode;
};

export function FinanceActionCenterShell({
  title = "Centro de Ações",
  subtitle = "Alertas priorizados — filtros aplicados",
  badgeCount,
  children,
}: Props) {
  return (
    <div className={`${financeBiCardClass} flex flex-col`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
        <div>
          <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p>
        </div>
        {badgeCount != null && badgeCount > 0 ? (
          <span className="h-6 min-w-[1.5rem] rounded-full bg-red-500 text-white text-[10px] font-bold px-2 flex items-center justify-center">
            {badgeCount}
          </span>
        ) : null}
      </div>
      <div className="flex-1 divide-y divide-border/40 overflow-auto max-h-[420px]">{children}</div>
    </div>
  );
}
