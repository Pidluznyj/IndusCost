/**
 * Sanitização financeira da ficha — o campo monetário não deve existir no JSON
 * quando o caller não tem employees.compensation.values.view (nem aliases sensíveis).
 */

const MONETARY_KEY_RE =
  /^(salary|previousAmount|newAmount|differenceAmount|bonusAmount|benefitAmount|amount|costs|totalBenefits|totalCharges|totalProvisions|totalMonthlyCost|costPerContractedHour|costPerProductiveHour|baseSalary|pay|bonus)$/i;

const MONETARY_NESTED_KEYS = new Set([
  "salary",
  "previousAmount",
  "newAmount",
  "differenceAmount",
  "bonusAmount",
  "benefitAmount",
  "amount",
  "costs",
  "totalBenefits",
  "totalCharges",
  "totalProvisions",
  "totalMonthlyCost",
  "costPerContractedHour",
  "costPerProductiveHour",
  "baseSalary",
  "bonus",
]);

export function isMonetaryDtoKey(key: string): boolean {
  return MONETARY_KEY_RE.test(key) || MONETARY_NESTED_KEYS.has(key);
}

export function omitMonetaryFields<T>(value: T): T {
  return strip(value, false) as T;
}

/**
 * Remove chaves monetárias. `amount` em benefícios só some quando `isFinancial`.
 * Por padrão remove todo `amount` — o caller deve copiar amount só se autorizado.
 */
function strip(value: unknown, _insidePayroll: boolean): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => strip(item, _insidePayroll));
  if (typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(src)) {
    if (isMonetaryDtoKey(key)) continue;
    out[key] = strip(nested, _insidePayroll);
  }
  return out;
}

export function collectMonetaryKeys(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  walk(value, path, hits);
  return hits;
}

function walk(value: unknown, path: string, hits: string[]): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, hits));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (isMonetaryDtoKey(key)) hits.push(next);
    walk(nested, next, hits);
  }
}

/** Falha se o JSON bruto ainda contém campos monetários sensíveis. */
export function assertNoCompensationValuesLeak(payload: unknown): void {
  const json = JSON.stringify(payload);
  const keys = collectMonetaryKeys(payload);
  if (keys.length > 0) {
    throw new Error(`Vazamento financeiro nas chaves: ${keys.join(", ")}`);
  }
  const forbiddenSnippets = [
    '"salary"',
    '"previousAmount"',
    '"newAmount"',
    '"differenceAmount"',
    '"bonusAmount"',
    '"totalMonthlyCost"',
    '"costPerProductiveHour"',
    '"baseSalary"',
  ];
  for (const snippet of forbiddenSnippets) {
    if (json.includes(snippet)) {
      throw new Error(`Vazamento financeiro no JSON bruto: ${snippet}`);
    }
  }
}

export function roundMoney(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}
