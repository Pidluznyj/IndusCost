export function normalizeTaxId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Parser tolerante para formatos comuns vindos do Nomus:
 * - "2.376" => 2376
 * - "5,9400 por PC" => 5.94
 * - "1.234,56" => 1234.56
 * - "400" => 400
 */
export function parseNomusPtBrNumber(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return 0;

  const cleaned = input
    .trim()
    .replace(/\s+por\s+[A-Za-z]+$/i, "")
    .replace(/[^\d,.\-]/g, "");

  if (!cleaned) return 0;

  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;

  let normalized = cleaned;

  if (commaCount > 0 && dotCount > 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (commaCount > 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 0) {
    const parts = cleaned.split(".");
    const onlyThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    normalized = onlyThousands ? cleaned.replace(/\./g, "") : cleaned;
  }

  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

