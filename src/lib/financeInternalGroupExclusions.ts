import { safeFinanceNumber } from "./financeAccountsReceivableFormat.js";

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
  ignoredPurchaseOrderAgendaPayables: number;
};

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
    normalizedName.includes("SM COMERCIO") &&
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

/**
 * Contraparte interna do grupo (cliente/fornecedor/devedor/credor).
 * Usa apenas personName/personCnpj — nunca companyName (empresa operacional).
 */
export function isFinanceInternalGroupPerson(input: {
  personName?: string | null;
  personCnpj?: string | null;
}): boolean {
  const cnpj = normalizeFinanceCnpj(input.personCnpj);
  if (cnpj && INTERNAL_GROUP_CNPJ_SET.has(cnpj)) return true;

  const name = normalizeFinancePersonText(input.personName);
  if (!name) return false;

  return matchesAliasInternalGroupName(name);
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

/** Agenda AP de pedido de compra — descrição inicia com PEDIDO DE COMPRA. */
export function isFinanceApPurchaseOrderAgenda(row: {
  description?: string | null;
}): boolean {
  const desc = normalizeFinancePersonText(row.description ?? "");
  return desc.startsWith("PEDIDO DE COMPRA");
}

export function isFinanceArExcludedFromManagement(row: {
  personName?: string | null;
  personCnpj?: string | null;
  amountReceivable?: unknown;
  amountReceived?: unknown;
  balanceReceivable?: unknown;
}): boolean {
  if (
    isFinanceInternalGroupPerson({
      personName: row.personName,
      personCnpj: row.personCnpj,
    })
  ) {
    return true;
  }
  return isFinanceArGhostTitle(row);
}

export function isFinanceApExcludedFromManagement(row: {
  personName?: string | null;
  personCnpj?: string | null;
  description?: string | null;
}): boolean {
  if (
    isFinanceInternalGroupPerson({
      personName: row.personName,
      personCnpj: row.personCnpj,
    })
  ) {
    return true;
  }
  return isFinanceApPurchaseOrderAgenda(row);
}

export function totalFinanceDataSanitizationIgnored(
  data: FinanceDataSanitization
): number {
  return (
    data.ignoredInternalGroupReceivables +
    data.ignoredInternalGroupPayables +
    data.ignoredGhostReceivables +
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
    ignoredPurchaseOrderAgendaPayables: 0,
  };
  for (const part of parts) {
    merged.ignoredInternalGroupReceivables +=
      part.ignoredInternalGroupReceivables ?? 0;
    merged.ignoredInternalGroupPayables += part.ignoredInternalGroupPayables ?? 0;
    merged.ignoredGhostReceivables += part.ignoredGhostReceivables ?? 0;
    merged.ignoredPurchaseOrderAgendaPayables +=
      part.ignoredPurchaseOrderAgendaPayables ?? 0;
  }
  return merged;
}
