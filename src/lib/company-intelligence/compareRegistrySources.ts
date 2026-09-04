import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import { formatCurrencyBrl } from "@/src/lib/companyCnpjFormat.js";
import {
  CNPJ_SOURCE_BRASIL_API,
  CNPJ_SOURCE_PUBLICA,
  PROVENANCE_FIELDS,
  type CnpjFieldProvenance,
  type RegistryCompareStatus,
} from "./registryTypes.js";

function collapse(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function valuesAreEquivalent(left: string | null, right: string | null): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  const a = collapse(left);
  const b = collapse(right);
  if (a === b) return true;
  const da = digits(left);
  const db = digits(right);
  if (da.length >= 8 && da === db) return true;
  return false;
}

function displayCnae(cnae: { code: string; description: string } | null | undefined): string | null {
  if (!cnae) return null;
  const code = cnae.code?.trim();
  const description = cnae.description?.trim();
  if (code && description && code !== "—") return `${code} — ${description}`;
  return description || code || null;
}

function displayPartners(partners: { name: string; role: string | null }[] | undefined): string | null {
  if (!partners?.length) return null;
  return partners
    .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
    .join(" · ");
}

function fieldDisplay(summary: NormalizedCnpjSummary | null, field: string): string | null {
  if (!summary) return null;
  switch (field) {
    case "companyName":
      return summary.companyName?.trim() && summary.companyName !== "—" ? summary.companyName.trim() : null;
    case "tradeName":
      return summary.tradeName?.trim() || null;
    case "registrationStatus":
      return summary.registrationStatusNormalized ?? summary.registrationStatus;
    case "openedAt":
      return summary.openedAt?.slice(0, 10) ?? null;
    case "legalNature":
      return summary.legalNature?.trim() || null;
    case "companySize":
      return summary.companySize?.trim() || null;
    case "shareCapital":
      return summary.shareCapital != null ? formatCurrencyBrl(summary.shareCapital) : null;
    case "mainCnae":
      return displayCnae(summary.mainCnae);
    case "address": {
      const parts = [summary.address, summary.addressNumber].filter(Boolean);
      return parts.length ? parts.join(", ") : null;
    }
    case "city":
      return summary.city?.trim() || null;
    case "state":
      return summary.state?.trim().toUpperCase() || null;
    case "zipCode":
      return summary.zipCode?.trim() || null;
    case "partners":
      return displayPartners(summary.partners);
    case "isMei":
      return summary.isMei ? "Sim" : "Não";
    default:
      return null;
  }
}

function compareStatus(
  primary: string | null,
  secondary: string | null,
  hasPrimarySource: boolean,
  hasSecondarySource: boolean
): RegistryCompareStatus {
  if (hasPrimarySource && !hasSecondarySource) return "SINGLE_SOURCE";
  if (!hasPrimarySource && hasSecondarySource) return "SINGLE_SOURCE";
  if (!primary && secondary) return "MISSING_PRIMARY";
  if (primary && !secondary) return "MISSING_SECONDARY";
  if (!primary && !secondary) return "MATCH";
  return valuesAreEquivalent(primary, secondary) ? "MATCH" : "DIFFERENT";
}

export function buildRegistryProvenance(
  primary: NormalizedCnpjSummary | null,
  secondary: NormalizedCnpjSummary | null
): CnpjFieldProvenance[] {
  const hasPrimary = primary != null;
  const hasSecondary = secondary != null;

  return PROVENANCE_FIELDS.map(({ field, label }) => {
    const primaryValue = fieldDisplay(primary, field);
    const secondaryValue = fieldDisplay(secondary, field);
    const status = compareStatus(primaryValue, secondaryValue, hasPrimary, hasSecondary);

    const values = [
      hasPrimary ? { source: CNPJ_SOURCE_PUBLICA, value: primaryValue } : null,
      hasSecondary ? { source: CNPJ_SOURCE_BRASIL_API, value: secondaryValue } : null,
    ].filter((row): row is { source: string; value: string | null } => row != null);

    const chosenValue = primaryValue ?? secondaryValue;
    const chosenSource = primaryValue
      ? CNPJ_SOURCE_PUBLICA
      : secondaryValue
        ? CNPJ_SOURCE_BRASIL_API
        : null;

    return {
      field,
      label,
      chosenValue,
      chosenSource,
      values,
      status,
    };
  });
}

export function provenanceConflicts(rows: CnpjFieldProvenance[]): CnpjFieldProvenance[] {
  return rows.filter((row) => row.status === "DIFFERENT");
}
