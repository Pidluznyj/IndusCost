import React, { useCallback, useMemo } from "react";
import {
  EntityAutocompleteFilter,
  type EntityAutocompleteItem,
  type EntityAutocompleteSelection,
} from "@/src/components/common/EntityAutocompleteFilter";
import type { FinanceArHorizonBucketCustomer } from "@/src/lib/financeArHorizonBucketCustomers";

type Props = {
  customers: FinanceArHorizonBucketCustomer[];
  value: EntityAutocompleteSelection | null;
  onChange: (selection: EntityAutocompleteSelection | null) => void;
  disabled?: boolean;
  loading?: boolean;
};

function customerToItem(customer: FinanceArHorizonBucketCustomer): EntityAutocompleteItem {
  const id = customer.personId > 0 ? String(customer.personId) : `name:${customer.personName}`;
  return {
    id,
    primaryLabel: customer.personName,
    secondaryLabel: customer.personCnpj
      ? `${customer.personCnpj} · ${customer.titlesCount} título(s)`
      : `${customer.titlesCount} título(s)`,
    selection: {
      id: customer.personId > 0 ? String(customer.personId) : undefined,
      name: customer.personName,
      taxId: customer.personCnpj,
      source: "nomus",
    },
  };
}

function matchesCustomerQuery(customer: FinanceArHorizonBucketCustomer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  if (customer.personName.toLowerCase().includes(q)) return true;
  if (digits && (customer.personCnpj ?? "").replace(/\D/g, "").includes(digits)) return true;
  if (customer.personId > 0 && String(customer.personId).includes(q)) return true;
  return false;
}

export function FinanceArHorizonBucketCustomerFilter({
  customers,
  value,
  onChange,
  disabled = false,
  loading = false,
}: Props) {
  const fetchItems = useCallback(
    async (query: string, _signal: AbortSignal): Promise<EntityAutocompleteItem[]> => {
      const filtered = customers.filter((customer) => matchesCustomerQuery(customer, query));
      return filtered.slice(0, 30).map(customerToItem);
    },
    [customers]
  );

  const placeholder = useMemo(() => {
    if (loading) return "Carregando clientes…";
    if (!customers.length) return "Nenhum cliente na faixa";
    return "Todos os clientes";
  }, [customers.length, loading]);

  return (
    <EntityAutocompleteFilter
      compact
      label="Cliente"
      entityType="customer"
      value={value}
      placeholder={placeholder}
      disabled={disabled || loading}
      minChars={0}
      debounceMs={120}
      fetchItems={fetchItems}
      onChange={onChange}
      onClear={() => onChange(null)}
      className="min-w-[200px] flex-1"
      htmlFor="finance-ar-horizon-bucket-customer"
    />
  );
}

export function horizonCustomerPersonIdFromSelection(
  selection: EntityAutocompleteSelection | null
): number | undefined {
  if (!selection) return undefined;
  const raw = selection.id?.trim();
  if (!raw || raw.startsWith("name:")) return undefined;
  const personId = Number.parseInt(raw, 10);
  return Number.isFinite(personId) && personId > 0 ? personId : undefined;
}

export function horizonCustomerLabelFromSelection(
  selection: EntityAutocompleteSelection | null
): string | undefined {
  const name = selection?.name?.trim();
  return name || undefined;
}

export function horizonCustomerQueryFromSelection(
  selection: EntityAutocompleteSelection | null
): { customerId?: number; customerName?: string } {
  const customerId = horizonCustomerPersonIdFromSelection(selection);
  if (customerId) return { customerId };
  const customerName = horizonCustomerLabelFromSelection(selection);
  return customerName ? { customerName } : {};
}
