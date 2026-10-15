/**
 * Projetos — vínculo com o cadastro oficial de clientes (regra pura).
 *
 * Conciliação dos projetos existentes:
 * - SOMENTE por CNPJ/CPF (dígitos). Nunca por semelhança de nome.
 * - Nada é gravado sem confirmação: o dry-run gera um plano e um token (sha256 do plano);
 *   a aplicação exige o mesmo token, garantindo que se grava exatamente o que foi revisado.
 * - Conflitos (sem documento, documento inválido, não encontrado, mais de um cadastro com o
 *   mesmo documento, cliente inativo) ficam fora e aparecem no relatório.
 */

export type ReconciliationProject = {
  id: string;
  code: string;
  customerName: string;
  customerDocument: string | null;
  customerId: string | null;
};

export type ReconciliationCustomer = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  status: string | null;
};

export type ReconciliationStatus =
  | "LINK"
  | "ALREADY_LINKED"
  | "NO_DOCUMENT"
  | "INVALID_DOCUMENT"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "INACTIVE_CUSTOMER";

export const RECONCILIATION_STATUS_LABELS: Record<ReconciliationStatus, string> = {
  LINK: "Vincular (CNPJ/CPF idêntico)",
  ALREADY_LINKED: "Já vinculado",
  NO_DOCUMENT: "Projeto sem CNPJ/CPF",
  INVALID_DOCUMENT: "CNPJ/CPF do projeto inválido",
  NOT_FOUND: "Nenhum cliente com este CNPJ/CPF",
  AMBIGUOUS: "Mais de um cliente com este CNPJ/CPF",
  INACTIVE_CUSTOMER: "Cliente encontrado está inativo",
};

export type ReconciliationEntry = {
  projectId: string;
  projectCode: string;
  projectCustomerName: string;
  projectDocument: string | null;
  status: ReconciliationStatus;
  customerId: string | null;
  customerCompanyName: string | null;
  /** Só informativo: o nome do cadastro difere do snapshot do projeto (não impede o vínculo). */
  nameDiffers: boolean;
  candidates: { id: string; companyName: string; taxId: string; status: string | null }[];
};

export function taxIdDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** CNPJ (14) ou CPF (11) formatado; outro tamanho → dígitos como vieram. */
export function formatTaxId(value: string | null | undefined): string | null {
  const d = taxIdDigits(value);
  if (!d) return null;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

function normName(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function planProjectCustomerReconciliation(
  projects: readonly ReconciliationProject[],
  customers: readonly ReconciliationCustomer[],
): ReconciliationEntry[] {
  const byDigits = new Map<string, ReconciliationCustomer[]>();
  for (const c of customers) {
    const d = taxIdDigits(c.taxId);
    if (!d) continue;
    byDigits.set(d, [...(byDigits.get(d) ?? []), c]);
  }
  return projects
    .map((p): ReconciliationEntry => {
      const base = {
        projectId: p.id,
        projectCode: p.code,
        projectCustomerName: p.customerName,
        projectDocument: p.customerDocument,
        customerId: null as string | null,
        customerCompanyName: null as string | null,
        nameDiffers: false,
        candidates: [] as ReconciliationEntry["candidates"],
      };
      if (p.customerId) return { ...base, status: "ALREADY_LINKED", customerId: p.customerId };
      const d = taxIdDigits(p.customerDocument);
      if (!d) return { ...base, status: "NO_DOCUMENT" };
      if (d.length !== 11 && d.length !== 14) return { ...base, status: "INVALID_DOCUMENT" };
      const found = byDigits.get(d) ?? [];
      const candidates = found.map((c) => ({ id: c.id, companyName: c.companyName, taxId: c.taxId, status: c.status }));
      if (found.length === 0) return { ...base, status: "NOT_FOUND" };
      if (found.length > 1) return { ...base, status: "AMBIGUOUS", candidates };
      const c = found[0];
      const nameDiffers =
        normName(c.companyName) !== normName(p.customerName) && normName(c.tradeName) !== normName(p.customerName);
      if ((c.status ?? "ACTIVE") !== "ACTIVE") {
        return { ...base, status: "INACTIVE_CUSTOMER", customerCompanyName: c.companyName, nameDiffers, candidates };
      }
      return { ...base, status: "LINK", customerId: c.id, customerCompanyName: c.companyName, nameDiffers, candidates };
    })
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
}

export function summarizeReconciliation(entries: readonly ReconciliationEntry[]): Record<ReconciliationStatus, number> {
  const out = Object.fromEntries(Object.keys(RECONCILIATION_STATUS_LABELS).map((k) => [k, 0])) as Record<ReconciliationStatus, number>;
  for (const e of entries) out[e.status] += 1;
  return out;
}

/** Fonte estável do token de confirmação: só os vínculos que serão gravados. */
export function reconciliationTokenSource(entries: readonly ReconciliationEntry[]): string {
  return entries
    .filter((e) => e.status === "LINK")
    .map((e) => `${e.projectId}>${e.customerId}`)
    .sort()
    .join("\n");
}

/**
 * Snapshot gravado no projeto ao vincular: mesmo nome exibido na busca ("Razão (Fantasia)") e
 * CNPJ/CPF formatado. Preserva o dado da época mesmo se o cadastro mudar depois.
 */
export function buildLinkedCustomerSnapshot(c: { companyName: string; tradeName: string | null; taxId: string }): {
  customerName: string;
  customerDocument: string | null;
} {
  const company = c.companyName?.trim() ?? "";
  const trade = c.tradeName?.trim();
  return {
    customerName: trade && trade !== company ? `${company} (${trade})` : company,
    customerDocument: formatTaxId(c.taxId) ?? (c.taxId?.trim() || null),
  };
}
