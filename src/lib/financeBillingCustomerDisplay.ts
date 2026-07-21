/**
 * Identificação legível de destinatário de NF-e no Faturamento.
 * Prioridade: tradeName → companyName (Customer) → xNome do XML → CNPJ formatado.
 */
import { formatCnpj, normalizeCnpj } from "./companyCnpjFormat.js";

export function resolveFinanceBillingCustomerDisplayName(input: {
  tradeName?: string | null;
  companyName?: string | null;
  xmlDestName?: string | null;
  xmlDestCnpjCpf?: string | null;
}): string {
  const trade = input.tradeName?.trim();
  if (trade) return trade;
  const company = input.companyName?.trim();
  if (company) return company;
  const xmlName = input.xmlDestName?.trim();
  if (xmlName) return xmlName;
  const cnpj = formatCnpj(input.xmlDestCnpjCpf);
  return cnpj !== "—" ? cnpj : "Cliente não identificado";
}

export function formatFinanceBillingCustomerDocument(
  xmlDestCnpjCpf: string | null | undefined
): string | null {
  const digits = normalizeCnpj(xmlDestCnpjCpf);
  if (!digits) return null;
  if (digits.length === 14) return formatCnpj(digits);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

/** Extrai xNome do bloco <dest> no XML da NF-e (sem parser completo). */
export function extractNomusNfeDestNameFromXml(xmlRaw: string | null | undefined): string | null {
  if (!xmlRaw || typeof xmlRaw !== "string") return null;
  const destBlock = /<dest[^>]*>([\s\S]*?)<\/dest>/i.exec(xmlRaw);
  if (!destBlock?.[1]) return null;
  const nameMatch = /<xNome[^>]*>([^<]*)<\/xNome>/i.exec(destBlock[1]);
  const name = nameMatch?.[1]?.trim();
  return name || null;
}
