import React, { useCallback } from "react";
import {
  EntityAutocompleteFilter,
  type EntityAutocompleteFilterProps,
  type EntityAutocompleteItem,
} from "@/src/components/common/EntityAutocompleteFilter";
import { fetchJsonOk } from "@/src/lib/http";
import {
  CUSTOMER_SEARCH_DEBOUNCE_MS,
  CUSTOMER_SEARCH_MIN_CHARS,
  type CustomerSearchItem,
  type EntityAutocompleteSelection,
  customerSearchItemToSelection,
  formatCustomerSearchSecondaryLine,
  selectionFromFinancePersonFields,
} from "@/src/lib/customerSearch";

type CustomerSearchResponse = {
  items: CustomerSearchItem[];
};

async function fetchCustomerSearchItems(
  query: string,
  signal: AbortSignal
): Promise<EntityAutocompleteItem[]> {
  const res = await fetchJsonOk<CustomerSearchResponse>(
    `/api/customers/search?q=${encodeURIComponent(query)}&limit=20`,
    { signal }
  );
  return (res.items ?? []).map((item) => ({
    id: item.id,
    primaryLabel: item.tradeName && item.tradeName !== item.name ? `${item.name} (${item.tradeName})` : item.name,
    secondaryLabel: formatCustomerSearchSecondaryLine(item),
    selection: customerSearchItemToSelection(item),
  }));
}

export async function fetchCustomerByIdForAutocomplete(
  customerId: string,
  signal?: AbortSignal
): Promise<EntityAutocompleteSelection | null> {
  if (!customerId.trim()) return null;
  const res = await fetchJsonOk<CustomerSearchResponse>(
    `/api/customers/search?id=${encodeURIComponent(customerId.trim())}&limit=1`,
    signal ? { signal } : undefined
  );
  const item = res.items?.[0];
  return item ? customerSearchItemToSelection(item) : null;
}

export type CustomerAutocompleteFilterProps = Omit<
  EntityAutocompleteFilterProps,
  "entityType" | "fetchItems" | "allowFreeText" | "value"
> & {
  allowFreeText?: boolean;
  value?: EntityAutocompleteSelection | null;
  /** Compat financeiro: reconstruir seleção a partir de personName/personCnpj. */
  personName?: string;
  personCnpj?: string;
  customerId?: string;
};

export function CustomerAutocompleteFilter({
  allowFreeText = false,
  personName,
  personCnpj,
  customerId,
  value,
  minChars = CUSTOMER_SEARCH_MIN_CHARS,
  debounceMs = CUSTOMER_SEARCH_DEBOUNCE_MS,
  ...rest
}: CustomerAutocompleteFilterProps) {
  const fetchItems = useCallback(
    (query: string, signal: AbortSignal) => fetchCustomerSearchItems(query, signal),
    []
  );

  const resolvedValue =
    value ??
    (personName != null || personCnpj != null || customerId
      ? selectionFromFinancePersonFields(personName ?? "", personCnpj ?? "", customerId)
      : null);

  return (
    <EntityAutocompleteFilter
      {...rest}
      entityType="customer"
      value={resolvedValue}
      minChars={minChars}
      debounceMs={debounceMs}
      allowFreeText={allowFreeText}
      fetchItems={fetchItems}
      placeholder={rest.placeholder ?? "Buscar cliente…"}
    />
  );
}

export type { EntityAutocompleteSelection };
