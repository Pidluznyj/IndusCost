import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";

export type CnpjRefreshPartyType = "CUSTOMER" | "SUPPLIER";

export type CnpjRefreshPartyDocument = {
  partyType: CnpjRefreshPartyType;
  partyId: string;
  rawDocument: string | null;
};

export type ClassifiedCnpjDocument =
  | {
      kind: "CNPJ";
      subjectKey: string;
      cnpj: string;
      customers: string[];
      suppliers: string[];
    }
  | {
      kind: "MISSING" | "CPF" | "INVALID";
      subjectKey: string;
      partyType: CnpjRefreshPartyType;
      partyId: string;
      digitLength: number;
    };

function subjectKeyForRejected(party: CnpjRefreshPartyDocument, kind: string): string {
  return `${kind}:${party.partyType}:${party.partyId}`;
}

/**
 * Um CNPJ válido gera uma única consulta, mesmo que exista como cliente e fornecedor.
 * CPF e documento inválido não vão para a API. O documento original do cadastro não é alterado.
 */
export function classifyPartyDocuments(parties: readonly CnpjRefreshPartyDocument[]): ClassifiedCnpjDocument[] {
  const grouped = new Map<string, { customers: string[]; suppliers: string[] }>();
  const rejected: ClassifiedCnpjDocument[] = [];

  for (const party of parties) {
    const digits = normalizeCnpj(party.rawDocument);
    if (!digits) {
      rejected.push({
        kind: "MISSING",
        subjectKey: subjectKeyForRejected(party, "MISSING"),
        partyType: party.partyType,
        partyId: party.partyId,
        digitLength: 0,
      });
      continue;
    }
    if (digits.length === 11) {
      rejected.push({
        kind: "CPF",
        subjectKey: subjectKeyForRejected(party, "CPF"),
        partyType: party.partyType,
        partyId: party.partyId,
        digitLength: 11,
      });
      continue;
    }
    if (!isValidCnpj(digits)) {
      rejected.push({
        kind: "INVALID",
        subjectKey: subjectKeyForRejected(party, "INVALID"),
        partyType: party.partyType,
        partyId: party.partyId,
        digitLength: digits.length,
      });
      continue;
    }
    const current = grouped.get(digits) ?? { customers: [], suppliers: [] };
    const bucket = party.partyType === "CUSTOMER" ? current.customers : current.suppliers;
    if (!bucket.includes(party.partyId)) bucket.push(party.partyId);
    grouped.set(digits, current);
  }

  const valid: ClassifiedCnpjDocument[] = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cnpj, partiesForCnpj]) => ({
      kind: "CNPJ" as const,
      subjectKey: cnpj,
      cnpj,
      customers: partiesForCnpj.customers,
      suppliers: partiesForCnpj.suppliers,
    }));

  return [...valid, ...rejected];
}

export function partyKindForCnpj(customers: readonly string[], suppliers: readonly string[]): "CUSTOMER" | "SUPPLIER" | "BOTH" {
  if (customers.length > 0 && suppliers.length > 0) return "BOTH";
  if (suppliers.length > 0) return "SUPPLIER";
  return "CUSTOMER";
}
