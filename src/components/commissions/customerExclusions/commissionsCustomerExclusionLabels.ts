import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";

export function formatCustomerExclusionStatus(status: "ACTIVE" | "INACTIVE"): string {
  return status === "ACTIVE" ? "Ativo" : "Inativo";
}

export function customerExclusionStatusBadgeClass(status: "ACTIVE" | "INACTIVE"): string {
  return status === "ACTIVE"
    ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
    : "inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground";
}

export function parseCustomerExternalIdFromSelection(
  selection: EntityAutocompleteSelection | null
): number | null {
  if (!selection?.code) return null;
  const parsed = Number(selection.code);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTaxIdDisplay(taxId: string | null | undefined): string {
  if (!taxId?.trim()) return "—";
  const digits = taxId.replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return taxId.trim();
}

export function formatEffectiveRange(
  effectiveFrom: string,
  effectiveTo: string | null
): string {
  const from = new Date(`${effectiveFrom}T12:00:00`).toLocaleDateString("pt-BR");
  if (!effectiveTo) return `${from} → aberto`;
  const to = new Date(`${effectiveTo}T12:00:00`).toLocaleDateString("pt-BR");
  return `${from} → ${to}`;
}

export const CUSTOMER_EXCLUSION_ALERT_MESSAGE =
  "Esta regra zera a comissão de vendas do cliente dentro da vigência. Não altera pedidos, NFs ou Contas a Receber.";

export type CustomerExclusionFormInput = {
  customerSelection: EntityAutocompleteSelection | null;
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
  notes: string;
};

export function emptyCustomerExclusionForm(): CustomerExclusionFormInput {
  return {
    customerSelection: null,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
    reason: "",
    notes: "",
  };
}

export function validateCustomerExclusionForm(form: CustomerExclusionFormInput): string | null {
  if (!form.customerSelection?.id) {
    return "Selecione um cliente cadastrado.";
  }
  if (!form.reason.trim()) return "Informe o motivo da exclusão.";
  if (!form.effectiveFrom) return "Informe a vigência inicial.";
  if (form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
    return "A vigência final não pode ser anterior à inicial.";
  }
  return null;
}

export function buildCustomerExclusionCreateBody(form: CustomerExclusionFormInput) {
  const selection = form.customerSelection;
  return {
    customerId: selection?.id ?? null,
    customerExternalId: parseCustomerExternalIdFromSelection(selection),
    customerNameSnapshot: selection?.name?.trim() ?? "",
    reason: form.reason.trim(),
    effectiveFrom: form.effectiveFrom,
    effectiveTo: form.effectiveTo || null,
    notes: form.notes.trim() || null,
  };
}

export function buildCustomerExclusionUpdateBody(form: CustomerExclusionFormInput) {
  return buildCustomerExclusionCreateBody(form);
}
