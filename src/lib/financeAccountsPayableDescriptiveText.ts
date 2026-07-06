/**
 * Resolve o texto descritivo mais informativo de um título AP (somente leitura).
 * Prioridade: description → comments → campos equivalentes em rawPayload.
 */

export type AccountsPayableDescriptiveInput = {
  description?: string | null;
  comments?: string | null;
  rawPayload?: unknown;
};

const RAW_PAYLOAD_DESCRIPTIVE_KEYS = [
  "description",
  "descricao",
  "comments",
  "comentarios",
  "comentario",
  "observation",
  "observacao",
  "historico",
  "history",
  "documentDescription",
  "descricaoDocumento",
] as const;

function trimText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && text.length > 0 ? text : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function pickPayloadString(payload: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") {
      const trimmed = trimText(value);
      if (trimmed) return trimmed;
    }
  }
  return null;
}

export function pickDescriptiveTextFromRawPayload(rawPayload: unknown): string | null {
  if (!isJsonObject(rawPayload)) return null;
  return pickPayloadString(rawPayload, RAW_PAYLOAD_DESCRIPTIVE_KEYS);
}

export function resolveAccountsPayableDescriptiveText(
  input: AccountsPayableDescriptiveInput
): string | null {
  const description = trimText(input.description);
  if (description) return description;

  const comments = trimText(input.comments);
  if (comments) return comments;

  const fromPayload = pickDescriptiveTextFromRawPayload(input.rawPayload);
  if (fromPayload) return fromPayload;

  return null;
}

export function formatAccountsPayableDescriptiveText(
  input: AccountsPayableDescriptiveInput
): string {
  return resolveAccountsPayableDescriptiveText(input) ?? "—";
}

export type AccountsPayableDescriptiveTextResult = {
  text: string;
  source: string | null;
};

export function resolveAccountsPayableDescriptiveTextWithSource(
  input: AccountsPayableDescriptiveInput
): AccountsPayableDescriptiveTextResult {
  const description = trimText(input.description);
  if (description) return { text: description, source: "description" };

  const comments = trimText(input.comments);
  if (comments) return { text: comments, source: "comments" };

  if (isJsonObject(input.rawPayload)) {
    for (const key of RAW_PAYLOAD_DESCRIPTIVE_KEYS) {
      const value = input.rawPayload[key];
      if (typeof value === "string") {
        const trimmed = trimText(value);
        if (trimmed) return { text: trimmed, source: `rawPayload.${key}` };
      }
    }
  }

  return { text: "—", source: null };
}
