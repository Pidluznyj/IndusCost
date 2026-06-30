import { fetchJsonOk } from "@/src/lib/http";
import type { FinanceSupplierSearchResult } from "@/src/lib/financeSupplierCostCenterRules";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";

export type EnsureSupplierFromApIdentityResponse = {
  supplierId: string;
  displayName: string;
  document: string | null;
  created: boolean;
  identityKey: string;
};

/** Garante UUID gerencial para hit AP-only ou retorna id existente. */
export async function ensureFinanceSupplierSearchResult(
  supplier: FinanceSupplierSearchResult
): Promise<string> {
  if (supplier.id) return supplier.id;

  const payload = await fetchJsonOk<EnsureSupplierFromApIdentityResponse>(
    "/api/finance/suppliers/ensure-from-ap-identity",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityKey: supplier.identityKey ?? undefined,
        personName: supplier.name,
        personDocument: supplier.document,
      }),
    }
  );
  return payload.supplierId;
}

export function formatFinanceSupplierSearchMeta(supplier: FinanceSupplierSearchResult): string {
  const parts: string[] = [];
  if (supplier.document) parts.push(supplier.document);
  else parts.push("Sem documento");
  parts.push(`${formatFinanceInteger(supplier.titlesCount)} título(s)`);
  if (supplier.externalCode) parts.push(`código ${supplier.externalCode}`);
  if (supplier.source === "AP_ONLY") parts.push("origem AP");
  else if (!supplier.matched) parts.push("não casado");
  if (supplier.hasActiveRule) parts.push("com regra");
  if (supplier.status === "INACTIVE") parts.push("inativo");
  return parts.join(" · ");
}

export function financeSupplierSearchOptionKey(supplier: FinanceSupplierSearchResult): string {
  return supplier.id ?? supplier.identityKey ?? supplier.name;
}
