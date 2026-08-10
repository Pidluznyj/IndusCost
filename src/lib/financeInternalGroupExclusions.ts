import type { Prisma } from "@prisma/client";
import { isAccountsPayablePurchaseOrderSchedule } from "./financeAccountsPayableOperational.js";
import { safeFinanceNumber } from "./financeAccountsReceivableFormat.js";

/**
 * Fonte oficial única das empresas do grupo econômico (Lazarios, Koppetel, SM).
 * CNPJs sempre normalizados para 14 dígitos. Não duplicar esta lista em outros módulos.
 */
export const FINANCE_INTERNAL_GROUP_COMPANIES = [
  {
    cnpj: "72569510000195",
    displayCnpj: "72.569.510/0001-95",
    name: "Lazarios Comercio de Plasticos LTDA",
    aliases: [
      "LAZARIOS",
      "LAZARIOS COMERCIO DE PLASTICOS LTDA",
      "LAZARIOS COMÉRCIO DE PLÁSTICOS LTDA",
    ],
  },
  {
    cnpj: "14055501000180",
    displayCnpj: "14.055.501/0001-80",
    name: "Koppetel Comercio de Plasticos LTDA",
    aliases: [
      "KOPPETEL",
      "KOPPETEL COMERCIO DE PLASTICOS LTDA",
      "KOPPETEL COMÉRCIO DE PLÁSTICOS LTDA",
    ],
  },
  {
    cnpj: "55717719000130",
    displayCnpj: "55.717.719/0001-30",
    name: "Sm Comercio de Plasticos LTDA - SM",
    aliases: [
      "SM",
      "SM COMERCIO DE PLASTICOS LTDA",
      "SM COMÉRCIO DE PLÁSTICOS LTDA",
      "SM COMERCIO DE PLASTICOS LTDA - SM",
      "SM COMÉRCIO DE PLÁSTICOS LTDA - SM",
    ],
  },
] as const;

/** CNPJs (somente dígitos) — alias canônico para SQL/Prisma. */
export const ECONOMIC_GROUP_CNPJ_DIGITS = FINANCE_INTERNAL_GROUP_COMPANIES.map(
  (c) => c.cnpj
) as readonly string[];

/** Motivo oficial de exclusão da população comercial/financeira. */
export const ECONOMIC_GROUP_INTERCOMPANY = "ECONOMIC_GROUP_INTERCOMPANY" as const;

/** Classificação de exclusão gerencial AP — pagador e credor do grupo econômico. */
export const FINANCE_AP_INTERCOMPANY_GROUP = "INTERCOMPANY_GROUP" as const;

/** Versão da regra de exclusão intercompany (auditoria / diagnósticos). */
export const ECONOMIC_GROUP_EXCLUSION_RULE_VERSION = "2026-07-27.1" as const;

const INTERNAL_GROUP_CNPJ_SET: Set<string> = new Set(
  FINANCE_INTERNAL_GROUP_COMPANIES.map((c) => c.cnpj)
);

const INTERNAL_GROUP_ALIASES = FINANCE_INTERNAL_GROUP_COMPANIES.flatMap((c) =>
  c.aliases.map((alias) => normalizeFinancePersonText(alias))
);

const SM_SAFE_ALIASES = new Set(
  INTERNAL_GROUP_ALIASES.filter(
    (alias) => alias !== "SM" && (alias.includes("SM") || alias.includes("COMERCIO"))
  )
);

const LAZARIOS_KOPPETEL_ALIASES = INTERNAL_GROUP_ALIASES.filter(
  (alias) => alias.includes("LAZARIOS") || alias.includes("KOPPETEL")
);

export type FinanceDataSanitization = {
  ignoredInternalGroupReceivables: number;
  ignoredInternalGroupPayables: number;
  ignoredGhostReceivables: number;
  ignoredStaleReceivables: number;
  ignoredStalePayables: number;
  ignoredPurchaseOrderAgendaPayables: number;
  ignoredOverdueWithoutFiscalDocumentReceivables: number;
  supersededPreInvoiceReceivables: number;
  supersededPreInvoiceAmount: number;
};

/** Visão gerencial financeira — mantido para compatibilidade de query/API. */
export type FinanceManagementScope = "company" | "group_consolidated";

export const DEFAULT_FINANCE_MANAGEMENT_SCOPE: FinanceManagementScope = "company";

export class FinanceManagementScopeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceManagementScopeParseError";
  }
}

export function parseFinanceManagementScope(value: unknown): FinanceManagementScope {
  const raw = String(value ?? DEFAULT_FINANCE_MANAGEMENT_SCOPE).trim().toLowerCase();
  if (raw === "company" || raw === "empresa") return "company";
  if (
    raw === "group_consolidated" ||
    raw === "group" ||
    raw === "consolidated" ||
    raw === "consolidado"
  ) {
    return "group_consolidated";
  }
  throw new FinanceManagementScopeParseError(
    'Escopo inválido. Use "company" (empresa) ou "group_consolidated" (grupo consolidado).'
  );
}

export function resolveFinanceManagementScope(
  scope: FinanceManagementScope | null | undefined
): FinanceManagementScope {
  return scope ?? DEFAULT_FINANCE_MANAGEMENT_SCOPE;
}

export function normalizeFinanceCnpj(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Uppercase, sem acentos, espaços normalizados — para contraparte (nomePessoa). */
export function normalizeFinancePersonText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSmInternalGroupName(normalizedName: string): boolean {
  if (!normalizedName) return false;
  if (normalizedName === "SM") return true;
  for (const alias of SM_SAFE_ALIASES) {
    if (normalizedName === alias || normalizedName.includes(alias)) return true;
  }
  if (
    (normalizedName.includes("SM COMERCIO") || normalizedName.includes("SM COM ")) &&
    normalizedName.includes("PLASTIC")
  ) {
    return true;
  }
  return false;
}

function matchesAliasInternalGroupName(normalizedName: string): boolean {
  if (!normalizedName) return false;

  for (const alias of LAZARIOS_KOPPETEL_ALIASES) {
    if (normalizedName === alias) return true;
    if (alias.length >= 8 && normalizedName.includes(alias)) return true;
    if (normalizedName.length >= 8 && alias.includes(normalizedName)) return true;
  }

  if (normalizedName.includes("LAZARIOS") && normalizedName.includes("PLASTIC")) {
    return true;
  }
  if (normalizedName.includes("KOPPETEL") && normalizedName.includes("PLASTIC")) {
    return true;
  }

  return matchesSmInternalGroupName(normalizedName);
}

export function isEconomicGroupCnpj(cnpj: string | null | undefined): boolean {
  const normalized = normalizeFinanceCnpj(cnpj);
  return normalized.length > 0 && INTERNAL_GROUP_CNPJ_SET.has(normalized);
}

export function isEconomicGroupName(name: string | null | undefined): boolean {
  const normalized = normalizeFinancePersonText(name);
  if (!normalized) return false;
  return matchesAliasInternalGroupName(normalized);
}

/** Empresa pagadora operacional (companyName) pertence ao grupo econômico. */
export function isInternalGroupCompany(companyName?: string | null): boolean {
  return isEconomicGroupName(companyName);
}

/** Fornecedor/credor (personName/personCnpj) pertence ao grupo econômico. */
export function isInternalGroupCounterparty(input: {
  personName?: string | null;
  personCnpj?: string | null;
}): boolean {
  if (isEconomicGroupCnpj(input.personCnpj)) return true;
  return isEconomicGroupName(input.personName);
}

/**
 * AP intercompany — exclusão somente quando pagador E credor são do grupo.
 * Pagador do grupo + fornecedor externo permanece na visão gerencial.
 */
export function isIntercompanyPayable(row: {
  companyName?: string | null;
  personName?: string | null;
  personCnpj?: string | null;
}): boolean {
  return (
    isInternalGroupCompany(row.companyName) &&
    isInternalGroupCounterparty({
      personName: row.personName,
      personCnpj: row.personCnpj,
    })
  );
}

/** Alias explícito — empresa do grupo econômico (CNPJ ou nome). */
export function isEconomicGroupCompany(input: {
  cnpj?: string | null;
  name?: string | null;
}): boolean {
  if (isEconomicGroupCnpj(input.cnpj)) return true;
  return isEconomicGroupName(input.name);
}

export type EconomicGroupExclusionClassification = {
  excluded: boolean;
  reason: typeof ECONOMIC_GROUP_INTERCOMPANY | null;
  normalizedCnpj: string | null;
  matchedCompany: string | null;
  source: string | null;
  ruleVersion: typeof ECONOMIC_GROUP_EXCLUSION_RULE_VERSION;
};

function resolveMatchedGroupCompany(cnpj: string | null | undefined, name?: string | null) {
  const digits = normalizeFinanceCnpj(cnpj);
  if (digits) {
    const byCnpj = FINANCE_INTERNAL_GROUP_COMPANIES.find((c) => c.cnpj === digits);
    if (byCnpj) return { company: byCnpj.name, normalizedCnpj: digits, source: "cnpj" as const };
  }
  if (isEconomicGroupName(name)) {
    const normalized = normalizeFinancePersonText(name);
    const byName = FINANCE_INTERNAL_GROUP_COMPANIES.find((c) =>
      c.aliases.some((alias) => {
        const a = normalizeFinancePersonText(alias);
        return normalized === a || (a.length >= 8 && normalized.includes(a));
      })
    );
    return {
      company: byName?.name ?? null,
      normalizedCnpj: digits || null,
      source: "name" as const,
    };
  }
  return { company: null, normalizedCnpj: digits || null, source: null };
}

/** AR — título intercompany quando o devedor/cliente é empresa do grupo. */
export function isIntercompanyReceivable(row: {
  personName?: string | null;
  personCnpj?: string | null;
}): boolean {
  return isInternalGroupCounterparty({
    personName: row.personName,
    personCnpj: row.personCnpj,
  });
}

export function classifyIntercompanyReceivable(row: {
  personName?: string | null;
  personCnpj?: string | null;
}): EconomicGroupExclusionClassification {
  const match = resolveMatchedGroupCompany(row.personCnpj, row.personName);
  const excluded = isIntercompanyReceivable(row);
  return {
    excluded,
    reason: excluded ? ECONOMIC_GROUP_INTERCOMPANY : null,
    normalizedCnpj: match.normalizedCnpj,
    matchedCompany: match.company,
    source: excluded ? match.source : null,
    ruleVersion: ECONOMIC_GROUP_EXCLUSION_RULE_VERSION,
  };
}

export function classifyIntercompanyPayable(row: {
  companyName?: string | null;
  personName?: string | null;
  personCnpj?: string | null;
}): EconomicGroupExclusionClassification {
  const match = resolveMatchedGroupCompany(row.personCnpj, row.personName);
  const excluded = isIntercompanyPayable(row);
  return {
    excluded,
    reason: excluded ? ECONOMIC_GROUP_INTERCOMPANY : null,
    normalizedCnpj: match.normalizedCnpj,
    matchedCompany: match.company,
    source: excluded
      ? `payer:${isInternalGroupCompany(row.companyName) ? "group" : "external"}+creditor:${match.source ?? "none"}`
      : null,
    ruleVersion: ECONOMIC_GROUP_EXCLUSION_RULE_VERSION,
  };
}

/**
 * SO — pedido intercompany quando o cliente (não o emitente) é empresa do grupo.
 * `companyIssuer` NÃO entra na decisão de exclusão.
 */
export function isIntercompanySalesOrder(order: {
  Customer?: {
    taxId?: string | null;
    companyName?: string | null;
    tradeName?: string | null;
  } | null;
  customerTaxId?: string | null;
  customerName?: string | null;
}): boolean {
  const taxId = order.Customer?.taxId ?? order.customerTaxId ?? null;
  const name =
    order.Customer?.companyName ??
    order.Customer?.tradeName ??
    order.customerName ??
    null;
  if (isInternalGroupCounterparty({ personCnpj: taxId, personName: name })) {
    return true;
  }
  if (order.Customer?.tradeName && order.Customer.tradeName !== name) {
    return isInternalGroupCounterparty({
      personCnpj: taxId,
      personName: order.Customer.tradeName,
    });
  }
  return false;
}

export function classifyIntercompanySalesOrder(order: {
  Customer?: {
    taxId?: string | null;
    companyName?: string | null;
    tradeName?: string | null;
  } | null;
  customerTaxId?: string | null;
  customerName?: string | null;
}): EconomicGroupExclusionClassification {
  const taxId = order.Customer?.taxId ?? order.customerTaxId ?? null;
  const name =
    order.Customer?.companyName ??
    order.Customer?.tradeName ??
    order.customerName ??
    null;
  const match = resolveMatchedGroupCompany(taxId, name);
  const excluded = isIntercompanySalesOrder(order);
  return {
    excluded,
    reason: excluded ? ECONOMIC_GROUP_INTERCOMPANY : null,
    normalizedCnpj: match.normalizedCnpj,
    matchedCompany: match.company,
    source: excluded ? (match.source === "cnpj" ? "Customer.taxId" : "Customer.name") : null,
    ruleVersion: ECONOMIC_GROUP_EXCLUSION_RULE_VERSION,
  };
}

/**
 * Cláusula Prisma: exclui pedidos cujo Customer é empresa do grupo (CNPJ formatado/dígitos ou nome).
 * Usada na população operacional oficial (listagem Comercial / Financeiro Pedidos).
 */
export function buildEconomicGroupCustomerPrismaExclusion(): Prisma.SalesOrderWhereInput {
  const customerOr: Prisma.CustomerWhereInput[] = [];
  for (const company of FINANCE_INTERNAL_GROUP_COMPANIES) {
    customerOr.push({ taxId: { equals: company.cnpj } });
    customerOr.push({ taxId: { equals: company.displayCnpj } });
    customerOr.push({ taxId: { contains: company.cnpj } });
    // Trecho estável do CNPJ formatado (evita depender só dos 14 dígitos colados).
    const formattedCore = company.displayCnpj.slice(0, 10); // "72.569.510"
    customerOr.push({ taxId: { contains: formattedCore } });
  }
  customerOr.push({ companyName: { contains: "Lazarios", mode: "insensitive" } });
  customerOr.push({ tradeName: { contains: "Lazarios", mode: "insensitive" } });
  customerOr.push({ companyName: { contains: "Koppetel", mode: "insensitive" } });
  customerOr.push({ tradeName: { contains: "Koppetel", mode: "insensitive" } });
  customerOr.push({ companyName: { contains: "SM Comercio", mode: "insensitive" } });
  customerOr.push({ tradeName: { contains: "SM Comercio", mode: "insensitive" } });
  customerOr.push({ companyName: { contains: "SM Comércio", mode: "insensitive" } });
  customerOr.push({ tradeName: { contains: "SM Comércio", mode: "insensitive" } });

  // `isNot` (não `NOT: { Customer: { is: {...} } }`) — a negação explícita do
  // Prisma para relação a filtro é o idioma correto aqui; a forma com `NOT`
  // envolvendo `is` é a suspeita nº 1 do zeramento em produção (ver commit
  // "diag(finance): surface population counts on empty ICR result": 804
  // candidatos, 804 excluídos, 0 elegíveis — 100% de exclusão é implausível
  // para clientes reais, sinal de que a cláusula nunca deixa passar ninguém).
  return {
    Customer: {
      isNot: {
        OR: customerOr,
      },
    },
  };
}

/**
 * Contraparte interna do grupo (cliente/fornecedor/devedor/credor).
 * Usa apenas personName/personCnpj — nunca companyName (empresa operacional).
 * @deprecated Preferir isInternalGroupCounterparty.
 */
export function isFinanceInternalGroupPerson(input: {
  personName?: string | null;
  personCnpj?: string | null;
}): boolean {
  return isInternalGroupCounterparty(input);
}

/** Título AR fantasma — Power BI: valorReceber > 0, valorRecebido = 0, saldoReceber = 0. */
export function isFinanceArGhostTitle(row: {
  amountReceivable?: unknown;
  amountReceived?: unknown;
  balanceReceivable?: unknown;
}): boolean {
  const receivable = safeFinanceNumber(row.amountReceivable);
  const received = safeFinanceNumber(row.amountReceived);
  const balance = safeFinanceNumber(row.balanceReceivable);
  return receivable > 0 && received === 0 && balance === 0;
}

/** Agenda AP de pedido de compra — type 2 ou descrição de PC no Nomus. */
export function isFinanceApPurchaseOrderAgenda(row: {
  description?: string | null;
  type?: number | null;
}): boolean {
  return isAccountsPayablePurchaseOrderSchedule(row);
}

export function isFinanceArExcludedFromManagement(row: {
  personName?: string | null;
  personCnpj?: string | null;
  amountReceivable?: unknown;
  amountReceived?: unknown;
  balanceReceivable?: unknown;
}): boolean {
  if (isInternalGroupCounterparty({ personName: row.personName, personCnpj: row.personCnpj })) {
    return true;
  }
  return isFinanceArGhostTitle(row);
}

export function isFinanceApExcludedFromManagement(
  row: {
    companyName?: string | null;
    personName?: string | null;
    personCnpj?: string | null;
    description?: string | null;
    type?: number | null;
  },
  _scope?: FinanceManagementScope
): boolean {
  if (isIntercompanyPayable(row)) return true;
  return isFinanceApPurchaseOrderAgenda(row);
}

export function totalFinanceDataSanitizationIgnored(
  data: FinanceDataSanitization
): number {
  return (
    data.ignoredInternalGroupReceivables +
    data.ignoredInternalGroupPayables +
    data.ignoredGhostReceivables +
    data.ignoredStaleReceivables +
    data.ignoredStalePayables +
    data.ignoredPurchaseOrderAgendaPayables
  );
}

export function mergeFinanceDataSanitization(
  ...parts: Array<Partial<FinanceDataSanitization>>
): FinanceDataSanitization {
  const merged: FinanceDataSanitization = {
    ignoredInternalGroupReceivables: 0,
    ignoredInternalGroupPayables: 0,
    ignoredGhostReceivables: 0,
    ignoredStaleReceivables: 0,
    ignoredStalePayables: 0,
    ignoredPurchaseOrderAgendaPayables: 0,
    ignoredOverdueWithoutFiscalDocumentReceivables: 0,
    supersededPreInvoiceReceivables: 0,
    supersededPreInvoiceAmount: 0,
  };
  for (const part of parts) {
    merged.ignoredInternalGroupReceivables +=
      part.ignoredInternalGroupReceivables ?? 0;
    merged.ignoredInternalGroupPayables += part.ignoredInternalGroupPayables ?? 0;
    merged.ignoredGhostReceivables += part.ignoredGhostReceivables ?? 0;
    merged.ignoredStaleReceivables += part.ignoredStaleReceivables ?? 0;
    merged.ignoredStalePayables += part.ignoredStalePayables ?? 0;
    merged.ignoredPurchaseOrderAgendaPayables +=
      part.ignoredPurchaseOrderAgendaPayables ?? 0;
    merged.ignoredOverdueWithoutFiscalDocumentReceivables +=
      part.ignoredOverdueWithoutFiscalDocumentReceivables ?? 0;
    merged.supersededPreInvoiceReceivables +=
      part.supersededPreInvoiceReceivables ?? 0;
    merged.supersededPreInvoiceAmount += part.supersededPreInvoiceAmount ?? 0;
  }
  return merged;
}

