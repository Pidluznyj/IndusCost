import type { SelectOption } from "@/src/components/shared/SearchableSelect";
import type { SoldProductsFilterOptionsPayload } from "@/src/lib/salesProductRankingTypes.js";

export function buildSoldProductsCustomerSelectOptions(
  customers: SoldProductsFilterOptionsPayload["customers"]
): SelectOption[] {
  return [
    { value: "", label: "Todos os clientes", searchTerms: "todos clientes" },
    ...customers.map((c) => ({
      value: c.id,
      label: c.companyName,
      sublabel: c.taxId ? `CNPJ/CPF: ${c.taxId}` : undefined,
      searchTerms: [c.companyName, c.taxId].filter(Boolean).join(" "),
    })),
  ];
}

export function buildSoldProductsTaxIdSelectOptions(
  customers: SoldProductsFilterOptionsPayload["customers"]
): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [
    { value: "", label: "Todos os CNPJ/CPF", searchTerms: "todos cnpj cpf" },
  ];
  for (const customer of customers) {
    const taxId = customer.taxId?.trim();
    if (!taxId || seen.has(taxId)) continue;
    seen.add(taxId);
    options.push({
      value: taxId,
      label: taxId,
      sublabel: customer.companyName,
      searchTerms: [taxId, customer.companyName].join(" "),
    });
  }
  return options;
}

export function buildSoldProductsProductSelectOptions(
  products: SoldProductsFilterOptionsPayload["products"]
): SelectOption[] {
  return [
    { value: "", label: "Todos os produtos", searchTerms: "todos produtos" },
    ...products.map((p) => {
      const code = p.sku?.trim() || "—";
      return {
        value: p.id,
        label: code !== "—" ? `[${code}] ${p.name}` : p.name,
        sublabel: code !== "—" ? p.name : undefined,
        searchTerms: [p.name, p.sku].filter(Boolean).join(" "),
      };
    }),
  ];
}

export function buildSoldProductsSellerSelectOptions(
  sellers: SoldProductsFilterOptionsPayload["sellers"]
): SelectOption[] {
  return [
    { value: "", label: "Todos os vendedores", searchTerms: "todos vendedores" },
    ...sellers.map((s) => ({
      value: s.key,
      label: s.label,
      searchTerms: [s.label, s.key.replace(/^r:/, ""), s.key.replace(/^id:/, "")].join(" "),
    })),
  ];
}

export function resolveSoldProductsCustomerChipLabel(
  customerId: string,
  customers: SoldProductsFilterOptionsPayload["customers"]
): string {
  const match = customers.find((c) => c.id === customerId);
  return match ? `Cliente: ${match.companyName}` : `Cliente: ${customerId}`;
}

export function resolveSoldProductsProductChipLabel(
  productId: string,
  products: SoldProductsFilterOptionsPayload["products"]
): string {
  const match = products.find((p) => p.id === productId);
  if (!match) return `Produto: ${productId}`;
  const code = match.sku?.trim();
  return code ? `Produto: [${code}] ${match.name}` : `Produto: ${match.name}`;
}

export function syncCustomerTaxIdFromId(
  customerId: string,
  customers: SoldProductsFilterOptionsPayload["customers"]
): string {
  if (!customerId) return "";
  return customers.find((c) => c.id === customerId)?.taxId?.trim() ?? "";
}

export function syncCustomerIdFromTaxId(
  taxId: string,
  customers: SoldProductsFilterOptionsPayload["customers"]
): string {
  if (!taxId.trim()) return "";
  const matches = customers.filter((c) => (c.taxId ?? "").trim() === taxId.trim());
  return matches.length === 1 ? matches[0]!.id : "";
}

/** Limpa filtros textuais legados ao usar seleção por ID. */
export function soldProductsCustomerIdPatch(customerId: string): Partial<import("@/src/lib/salesProductRankingTypes.js").SoldProductsUiFilters> {
  return {
    customerId,
    customerName: "",
  };
}

export function soldProductsProductIdPatch(productId: string): Partial<import("@/src/lib/salesProductRankingTypes.js").SoldProductsUiFilters> {
  return {
    productId,
    productCode: "",
    productName: "",
  };
}
