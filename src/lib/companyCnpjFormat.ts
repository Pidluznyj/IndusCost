export function normalizeCnpj(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatCnpj(value: string | null | undefined): string {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return digits || "—";
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function formatCep(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return digits || "—";
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function formatCurrencyBrl(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;

  const calcDigit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, ch, i) => acc + Number(ch) * weights[i]!, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcDigit(cnpj.slice(0, 12), w1);
  const d2 = calcDigit(cnpj.slice(0, 12) + String(d1), w2);
  return cnpj.endsWith(`${d1}${d2}`);
}

export function countFilledJsonFields(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (Array.isArray(value)) {
    return value.reduce<number>((acc, item) => acc + countFilledJsonFields(item), 0);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (acc, item) => acc + countFilledJsonFields(item),
      0
    );
  }
  return 0;
}

export type JsonTreeNode = {
  key: string;
  value: unknown;
  type: "string" | "number" | "boolean" | "null" | "object" | "array" | "date";
  display: string;
  children?: JsonTreeNode[];
};

export function flattenJsonForDynamicRender(
  value: unknown,
  key = "root",
  depth = 0
): JsonTreeNode {
  if (value == null) {
    return { key, value: null, type: "null", display: "—" };
  }
  if (typeof value === "boolean") {
    return { key, value, type: "boolean", display: value ? "Sim" : "Não" };
  }
  if (typeof value === "number") {
    return { key, value, type: "number", display: String(value) };
  }
  if (typeof value === "string") {
    const isoDate = /^\d{4}-\d{2}-\d{2}/.test(value);
    if (isoDate && !Number.isNaN(Date.parse(value))) {
      const d = new Date(value);
      return {
        key,
        value,
        type: "date",
        display: Number.isNaN(d.getTime()) ? value : d.toLocaleString("pt-BR"),
      };
    }
    if (/^\d{14}$/.test(value.replace(/\D/g, "")) && value.replace(/\D/g, "").length === 14) {
      return { key, value, type: "string", display: formatCnpj(value) };
    }
    if (/^\d{8}$/.test(value.replace(/\D/g, "")) && value.replace(/\D/g, "").length === 8) {
      return { key, value, type: "string", display: formatCep(value) };
    }
    return { key, value, type: "string", display: value.trim() || "—" };
  }
  if (Array.isArray(value)) {
    return {
      key,
      value,
      type: "array",
      display: `${value.length} item(ns)`,
      children: value.map((item, i) => flattenJsonForDynamicRender(item, `[${i}]`, depth + 1)),
    };
  }
  return {
    key,
    value,
    type: "object",
    display: `${Object.keys(value as object).length} campo(s)`,
    children: Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      flattenJsonForDynamicRender(v, k, depth + 1)
    ),
  };
}
