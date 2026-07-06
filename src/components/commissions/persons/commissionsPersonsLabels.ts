export const COMMISSION_PERSON_TYPE_OPTIONS = [
  { value: "SELLER", label: "Vendedor" },
  { value: "REPRESENTATIVE", label: "Representante" },
  { value: "MANAGER", label: "Gerente" },
  { value: "OTHER", label: "Outro" },
] as const;

export const COMMISSION_PERSON_SOURCE_OPTIONS = [
  { value: "MANUAL", label: "Manual" },
  { value: "NOMUS", label: "Nomus" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  SELLER: "Vendedor",
  REPRESENTATIVE: "Representante",
  MANAGER: "Gerente",
  OTHER: "Outro",
};

const SOURCE_LABELS: Record<string, string> = {
  NOMUS: "Nomus",
  MANUAL: "Manual",
};

export function formatCommissionPersonType(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function formatCommissionPersonSource(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
