import React from "react";
import { ArrowDownLeft, ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import type { FinanceCashFlowDashboardPayload } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  controlRoomCaptionClass,
  controlRoomCardClass,
} from "@/src/lib/financeControlRoomTheme";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowPartyList({
  title,
  subtitle,
  items,
  emptyLabel,
  inflow = true,
}: {
  title: string;
  subtitle: string;
  items: FinanceCashFlowDashboardPayload["topCustomers"];
  emptyLabel: string;
  inflow?: boolean;
}) {
  return (
    <div className={cn(controlRoomCardClass, "p-3.5 space-y-2")}>
      <div>
        <h3 className="font-ui text-sm font-semibold text-[#1C1917]">{title}</h3>
        <p className={controlRoomCaptionClass}>{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <p className="font-ui text-xs text-[#57534E]">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={`${item.personCnpj ?? item.personName ?? idx}`}
              className="flex items-center justify-between gap-2 py-0.5 hover:bg-[#F5F5F4] rounded-sm px-1 -mx-1"
            >
              <span className="font-ui text-xs truncate text-[#1C1917]">
                {displayFinanceText(item.personName)}
              </span>
              <span
                className={cn(
                  "font-mono text-xs font-semibold shrink-0 tabular-nums",
                  inflow ? "text-[#2C5530]" : "text-[#B64230]"
                )}
              >
                {inflow ? "+" : "−"}
                {formatFinanceCurrency(item.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FinanceCashFlowCriticalList({
  title,
  items,
  outflow = false,
}: {
  title: string;
  items: FinanceCashFlowDashboardPayload["largestProjectedInflows"];
  outflow?: boolean;
}) {
  const Icon = outflow ? TrendingDown : TrendingUp;
  const Arrow = outflow ? ArrowUpRight : ArrowDownLeft;
  return (
    <div className={cn(controlRoomCardClass, "p-3.5 space-y-2")}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", outflow ? "text-[#B64230]" : "text-[#2C5530]")} />
        <h3 className="font-ui text-sm font-semibold text-[#1C1917]">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="font-ui text-xs text-[#57534E]">Nenhum título nesta categoria.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 5).map((item) => (
            <li
              key={`${item.side}-${item.externalId}`}
              className="py-0.5 hover:bg-[#F5F5F4] rounded-sm px-1 -mx-1"
            >
              <div className="flex justify-between gap-2 items-start">
                <div className="min-w-0 flex items-start gap-1">
                  <Arrow
                    className={cn(
                      "h-3 w-3 shrink-0 mt-0.5",
                      outflow ? "text-[#B64230]" : "text-[#2C5530]"
                    )}
                  />
                  <span className="font-ui text-xs truncate text-[#1C1917]">
                    {displayFinanceText(item.personName)}
                  </span>
                </div>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold shrink-0 tabular-nums",
                    outflow ? "text-[#B64230]" : "text-[#2C5530]"
                  )}
                >
                  {outflow ? "−" : "+"}
                  {formatFinanceCurrency(item.amount)}
                </span>
              </div>
              <p className={cn(controlRoomCaptionClass, "pl-4")}>
                Venc. {item.dueDate ? new Date(item.dueDate).toLocaleDateString("pt-BR") : "—"}
                {item.daysOverdue > 0 ? ` · ${item.daysOverdue}d atraso` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
