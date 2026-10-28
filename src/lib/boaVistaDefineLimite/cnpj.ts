/** Validação de CNPJ (dígitos verificadores). Só pessoa jurídica: 14 dígitos; 11 dígitos = CPF (pessoa física). */

export type DocumentKind = "CNPJ" | "CPF" | "INVALID";

export function documentDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function classifyDocument(value: string | null | undefined): DocumentKind {
  const digits = documentDigits(value);
  if (digits.length === 14) return "CNPJ";
  if (digits.length === 11) return "CPF";
  return "INVALID";
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const digits = documentDigits(value);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (length: number) => {
    let sum = 0;
    let weight = length - 7;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

export function formatCnpj(value: string | null | undefined): string {
  const digits = documentDigits(value);
  if (digits.length !== 14) return String(value ?? "").trim() || "—";
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
