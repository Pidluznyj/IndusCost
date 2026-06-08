import React from "react";
import { AlertCircle } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";

export const FABRICATED_BOM_COMPONENT_TOOLTIP =
  "Custo total do componente fabricado: MP própria + conversão própria. Nos cards acima, essas parcelas podem aparecer separadas para conciliação.";

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

export function BomCostDetailRow({
  item,
  isFabricatedComponent = false,
}: {
  item: BomCostDetailRowData;
  isFabricatedComponent?: boolean;
}) {
  const excluded = item.excludedFromCost === true;
  const tooltip = excluded
    ? buildExclusionTooltip(item)
    : isFabricatedComponent
      ? FABRICATED_BOM_COMPONENT_TOOLTIP
      : undefined;

  return (
    <tr
      className={cn(
        excluded && "bg-red-500/10 text-red-800 dark:text-red-200 border-l-4 border-l-red-600"
      )}
      title={tooltip}
    >
      <td className={cn("min-w-0 px-3 py-2.5 align-top text-[13px] font-medium leading-snug", excluded && "text-red-700 dark:text-red-300")}>
        <div className="flex items-start gap-2">
          {excluded && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" aria-hidden />}
          <span className="min-w-0 break-words">
            {item.description}
            {excluded && (
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-red-600">
                Não incluído no custo
              </span>
            )}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right align-middle tabular-nums text-muted-foreground">
        {formatNumber(item.requiredQty, 5)}
      </td>
      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
        {excluded ? "—" : formatCurrency(item.basePrice)}
      </td>
      <td className="px-3 py-2.5 text-right align-middle tabular-nums font-semibold text-foreground">
        {excluded ? "—" : formatCurrency(item.unitCost)}
      </td>
    </tr>
  );
}
