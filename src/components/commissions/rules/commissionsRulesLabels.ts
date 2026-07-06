import type { CommissionsRuleFormInput, CommissionsRuleItem } from "@/src/components/commissions/commissionsTypes";

export const COMMISSION_RULE_BENEFICIARY_OPTIONS = [
  { value: "SELLER", label: "Vendedor do pedido" },
  { value: "REPRESENTATIVE", label: "Representante do pedido" },
  { value: "FIXED_PERSON", label: "Pessoa fixa" },
] as const;

export const COMMISSION_RULE_BASE_OPTIONS = [
  { value: "SALES_ORDER_ITEM_NET", label: "Valor líquido do item do Pedido" },
  { value: "OUTPUT_DOCUMENT_ITEM_NET", label: "Valor líquido do item do Documento de Saída" },
  { value: "RECEIVABLE_AMOUNT", label: "Valor recebido" },
] as const;

export const COMMISSION_RULE_RELEASE_OPTIONS = [
  { value: "SALES_ORDER_CREATED", label: "Na criação do Pedido" },
  { value: "OUTPUT_DOCUMENT_CREATED", label: "Na emissão do Documento de Saída" },
  { value: "FIRST_RECEIVABLE_PAID", label: "Após pagamento da primeira Conta a Receber" },
  { value: "EACH_RECEIVABLE_PAID", label: "Proporcional a cada Conta a Receber paga" },
] as const;

export const COMMISSION_RULE_CALCULATION_OPTIONS = [
  { value: "FIXED_PERCENT", label: "Percentual fixo" },
  {
    value: "COMMERCIAL_PRICE_TIER",
    label: "Por faixa da tabela comercial (Atacado / Varejo 1–3)",
  },
] as const;

const BENEFICIARY_LABELS: Record<string, string> = {
  SELLER: "Vendedor do pedido",
  REPRESENTATIVE: "Representante do pedido",
  FIXED_PERSON: "Pessoa fixa",
};

const BASE_LABELS: Record<string, string> = {
  SALES_ORDER_ITEM_NET: "valor líquido do item do pedido",
  OUTPUT_DOCUMENT_ITEM_NET: "valor líquido do item do documento de saída",
  RECEIVABLE_AMOUNT: "valor recebido",
};

const RELEASE_LABELS: Record<string, string> = {
  SALES_ORDER_CREATED: "liberado na criação do pedido",
  OUTPUT_DOCUMENT_CREATED: "liberado na emissão do documento de saída",
  FIRST_RECEIVABLE_PAID: "liberado após pagamento da primeira conta a receber",
  EACH_RECEIVABLE_PAID: "liberado proporcionalmente a cada conta recebida",
};

export function formatCommissionRuleBeneficiary(
  type: string,
  fixedName?: string | null
): string {
  if (type === "FIXED_PERSON" && fixedName) return fixedName;
  return BENEFICIARY_LABELS[type] ?? type;
}

export function formatCommissionRuleBase(type: string): string {
  return BASE_LABELS[type] ?? type;
}

export function formatCommissionRuleRelease(type: string): string {
  return RELEASE_LABELS[type] ?? type;
}

export function buildCommissionRuleSummary(
  rule: Pick<
    CommissionsRuleItem | CommissionsRuleFormInput,
    | "beneficiaryType"
    | "calculationType"
    | "fixedCommissionPersonId"
    | "ratePercent"
    | "baseType"
    | "releaseRule"
  > & { fixedCommissionPersonName?: string | null }
): string {
  const beneficiary =
    rule.beneficiaryType === "FIXED_PERSON" && rule.fixedCommissionPersonName
      ? rule.fixedCommissionPersonName
      : formatCommissionRuleBeneficiary(rule.beneficiaryType);
  const base = formatCommissionRuleBase(rule.baseType);
  const release = formatCommissionRuleRelease(rule.releaseRule);
  if (rule.calculationType === "COMMERCIAL_PRICE_TIER") {
    return `${beneficiary} recebe comissão conforme a faixa comercial (Atacado, Varejo 1, Varejo 2 ou Varejo 3) sobre ${base}, ${release}.`;
  }
  return `${beneficiary} recebe ${rule.ratePercent}% sobre ${base}, ${release}.`;
}

export function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  try {
    return iso.slice(0, 10);
  } catch {
    return "";
  }
}

export function dateInputToIsoStart(date: string | null): string | null {
  if (!date?.trim()) return null;
  return new Date(`${date.trim()}T00:00:00`).toISOString();
}

export function dateInputToIsoEnd(date: string | null): string | null {
  if (!date?.trim()) return null;
  return new Date(`${date.trim()}T23:59:59`).toISOString();
}
