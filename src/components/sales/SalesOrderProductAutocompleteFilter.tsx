import React from "react";
import {
  EntityAutocompleteFilter,
  type EntityAutocompleteItem,
  type EntityAutocompleteSelection,
} from "@/src/components/common/EntityAutocompleteFilter";
import { fetchJsonOk } from "@/src/lib/http";
import {
  SALES_ORDER_PRODUCT_FILTER_MIN_CHARS,
  getSalesOrderProductFilterOptionsUrl,
  type SalesOrderProductFilterOption,
} from "@/src/lib/salesOrderProductFilter";

/** Busca produtos vendidos (SKU ou nome) para o dropdown do filtro de produto. */
export async function fetchSalesOrderProductFilterItems(
  query: string,
  signal: AbortSignal
): Promise<EntityAutocompleteItem[]> {
  const res = await fetchJsonOk<{ options?: SalesOrderProductFilterOption[] }>(
    getSalesOrderProductFilterOptionsUrl(query),
    { signal }
  );
  return (res.options ?? []).map((option) => ({
    id: option.productId,
    primaryLabel: option.name,
    secondaryLabel: `SKU ${option.sku}`,
    selection: {
      id: option.productId,
      code: option.sku,
      name: `${option.sku} — ${option.name}`,
      source: "induscost" as const,
    },
  }));
}

/**
 * Filtro de produto no padrão do sistema: digita SKU ou nome e escolhe no
 * dropdown (nada de UUID digitado). A seleção guarda o id do produto.
 */
export function SalesOrderProductAutocompleteFilter({
  label = "Produto",
  placeholder = "Todos os produtos",
  value,
  onChange,
  className,
}: {
  label?: string;
  placeholder?: string;
  value: EntityAutocompleteSelection | null;
  onChange: (selection: EntityAutocompleteSelection | null) => void;
  className?: string;
}) {
  return (
    <EntityAutocompleteFilter
      label={label}
      entityType="product"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      fetchItems={fetchSalesOrderProductFilterItems}
      minChars={SALES_ORDER_PRODUCT_FILTER_MIN_CHARS}
      className={className}
    />
  );
}
