/**
 * Máscaras e sanitização de superfície pública. Sem rawMetadata.
 */

export function maskCpf(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length !== 11) return "***";
  return `***.***.***-${digits.slice(-2)}`;
}

export function maskPartyDocument(input: {
  document: string | null | undefined;
  personType?: string | null;
}): string | null {
  const digits = String(input.document ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 || input.personType === "PERSON") return maskCpf(digits);
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return "***";
}

export function stripRawMetadata<T extends Record<string, unknown>>(row: T): Omit<T, "rawMetadata"> {
  const { rawMetadata: _raw, ...rest } = row;
  return rest;
}
