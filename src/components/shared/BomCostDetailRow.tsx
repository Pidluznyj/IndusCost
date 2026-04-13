import React from "react";
import { AlertCircle } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";

export type BomCostDetailRowData = {
  description: string;
  requiredQty: number;
  basePrice: number;
  unitCost: number;
  excludedFromCost?: boolean;
  errorCode?: string;
  message?: string;
  detailChain?: string;
  sku?: string | null;
  name?: string | null;
};

function buildExclusionTooltip(item: BomCostDetailRowData): string {
  const parts = [
    item.sku ? `SKU: ${item.sku}` : null,
    item.name ? `Nome: ${item.name}` : null,
    item.errorCode ? `Código: ${item.errorCode}` : null,
    item.message,
    item.detailChain,
    "Complete o cadastro do componente (processo, BOM e dados) para que ele entre no cálculo.",
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.join("\n\n");
}

export function BomCostDetailRow({ item }: { item: BomCostDetailRowData }) {
  const excluded = item.excludedFromCost === true;
  const tooltip = excluded ? buildExclusionTooltip(item) : undefined;

  return (
    <tr
      className={cn(
        excluded && "bg-red-500/10 text-red-800 dark:text-red-200 border-l-4 border-l-red-600"
      )}
      title={tooltip}
    >
      <td className={cn("p-3 font-medium", excluded && "text-red-700 dark:text-red-300")}>
        <div className="flex items-start gap-2">
          {excluded && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" aria-hidden />}
          <span>
            {item.description}
            {excluded && (
              <span className="block text-[10px] font-bold uppercase tracking-wide text-red-600 mt-1">
                Não incluído no custo
              </span>
            )}
          </span>
        </div>
      </td>
      <td className="p-3 text-right">{formatNumber(item.requiredQty, 5)}</td>
      <td className="p-3 text-right">{excluded ? "—" : formatCurrency(item.basePrice)}</td>
      <td className="p-3 text-right font-bold">{excluded ? "—" : formatCurrency(item.unitCost)}</td>
    </tr>
  );
}
