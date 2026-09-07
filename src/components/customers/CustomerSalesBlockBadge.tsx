import React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  CUSTOMER_SALES_BLOCKED_BUTTON_HINT,
  customerHasFinancialSalesBlockDetails,
  customerSalesBlockTooltip,
  formatCustomerCadastralStatus,
  isCustomerCadastralActive,
  type CustomerSalesBlockPublic,
} from "@/src/lib/commercial/customerSalesBlockView";

export function CustomerCadastralStatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const active = isCustomerCadastralActive(status);
  const blocked = String(status ?? "").trim().toUpperCase() === "BLOCKED";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        active ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600",
        className
      )}
      data-testid="customer-cadastral-status"
    >
      <div className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-green-600" : "bg-red-600")} />
      {formatCustomerCadastralStatus(status)}
      {blocked ? <span className="sr-only">cadastral</span> : null}
    </div>
  );
}

export function CustomerSalesBlockBadge({
  salesBlock,
  className,
}: {
  salesBlock: CustomerSalesBlockPublic | null | undefined;
  className?: string;
}) {
  if (!salesBlock?.blocked) return null;
  const includeFinancial = customerHasFinancialSalesBlockDetails(salesBlock);
  const title = customerSalesBlockTooltip(salesBlock, includeFinancial);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700",
        className
      )}
      title={title}
      data-testid="customer-sales-block-badge"
    >
      <Lock className="h-3 w-3" aria-hidden />
      Venda bloqueada
    </div>
  );
}

export function CustomerNewSaleButton({
  blocked,
  disabled,
  onClick,
  className,
}: {
  blocked: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const isDisabled = Boolean(disabled || blocked);
  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onClick}
      title={blocked ? CUSTOMER_SALES_BLOCKED_BUTTON_HINT : "Nova venda"}
      className={cn(
        "rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      data-testid="customer-new-sale"
    >
      Nova venda
    </button>
  );
}

export function CustomerNewQuoteButton({
  onClick,
  className,
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Novo orçamento"
      className={cn(
        "rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent",
        className
      )}
      data-testid="customer-new-quote"
    >
      Novo orçamento
    </button>
  );
}
