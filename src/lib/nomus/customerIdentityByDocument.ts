/**
 * Identidade de cliente para os syncs do Nomus (pedidos e propostas) — regra única.
 *
 * Ordem de evidência:
 *   1. SALES_ORDER_HISTORY — cliente já usado pelos pedidos daquele idPessoa (preserva o que está gravado);
 *   2. NOMUS_PERSON_ID     — Customer.nomusExternalPersonId (id estável da pessoa no Nomus);
 *   3. DOCUMENT_DIGITS     — CPF/CNPJ comparado só pelos dígitos (com ou sem máscara).
 *
 * Mais de um cliente numa etapa é CONFLITO: a etapa seguinte só resolve se, entre os conflitantes, restar um
 * único cliente também apontado por ela (interseção das evidências). Cliente já ligado a OUTRA pessoa do Nomus é
 * excluído da etapa de documento pelo chamador. Nunca escolhe arbitrariamente e nunca cria cliente.
 */

export type CustomerIdentityVia = "SALES_ORDER_HISTORY" | "NOMUS_PERSON_ID" | "DOCUMENT_DIGITS";

export type CustomerIdentityResolution =
  | { status: "RESOLVED"; customerId: string; via: CustomerIdentityVia }
  | { status: "CONFLICT"; via: CustomerIdentityVia; candidateCustomerIds: string[] }
  | { status: "NOT_FOUND" };

export type CustomerIdentityRow = {
  id: string;
  taxId: string | null;
  nomusExternalPersonId?: number | null;
};

/**
 * Documento só com dígitos (CPF = 11, CNPJ = 14; 12–13 aceitos para não perder cadastros legados sem zero à
 * esquerda, que só casam com o mesmo texto de dígitos). Menos de 11 dígitos não identifica cliente.
 */
export function documentDigits(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 11 && digits.length <= 14 ? digits : null;
}

export type CustomerIdentityIndexes = {
  byDocument: CustomerDocumentIndex;
  byPersonId: Map<number, string[]>;
  /** Customer.id → nomusExternalPersonId (null = nunca veio do Nomus). */
  personIdByCustomerId: Map<string, number | null>;
};

/** Índices a partir de todos os clientes (uma consulta; comparação por dígitos não usa índice de texto). */
export function buildCustomerIdentityIndexes(rows: Iterable<CustomerIdentityRow>): CustomerIdentityIndexes {
  const list = [...rows];
  return {
    byDocument: buildCustomerDocumentIndex(list),
    byPersonId: buildCustomerPersonIdIndex(list),
    personIdByCustomerId: new Map(list.map((row) => [row.id, row.nomusExternalPersonId ?? null] as const)),
  };
}

export type CustomerDocumentIndex = Map<string, string[]>;

export function buildCustomerDocumentIndex(rows: Iterable<CustomerIdentityRow>): CustomerDocumentIndex {
  const index: CustomerDocumentIndex = new Map();
  for (const row of rows) {
    const digits = documentDigits(row.taxId);
    if (!digits) continue;
    const list = index.get(digits) ?? [];
    if (!list.includes(row.id)) list.push(row.id);
    index.set(digits, list);
  }
  for (const list of index.values()) list.sort();
  return index;
}

export function buildCustomerPersonIdIndex(rows: Iterable<CustomerIdentityRow>): Map<number, string[]> {
  const index = new Map<number, string[]>();
  for (const row of rows) {
    const personId = row.nomusExternalPersonId;
    if (personId == null || personId <= 0) continue;
    const list = index.get(personId) ?? [];
    if (!list.includes(row.id)) list.push(row.id);
    index.set(personId, list);
  }
  for (const list of index.values()) list.sort();
  return index;
}

export function decideCustomerIdentity(steps: {
  salesOrderHistoryCustomerIds?: readonly string[];
  personIdCustomerIds?: readonly string[];
  documentCustomerIds?: readonly string[];
}): CustomerIdentityResolution {
  const ordered: Array<[CustomerIdentityVia, readonly string[] | undefined]> = [
    ["SALES_ORDER_HISTORY", steps.salesOrderHistoryCustomerIds],
    ["NOMUS_PERSON_ID", steps.personIdCustomerIds],
    ["DOCUMENT_DIGITS", steps.documentCustomerIds],
  ];
  let conflict: { via: CustomerIdentityVia; ids: string[] } | null = null;

  for (const [via, raw] of ordered) {
    const ids = [...new Set(raw ?? [])].sort();
    if (ids.length === 0) continue;
    if (conflict) {
      // Etapa posterior só desempata DENTRO do conjunto conflitante: um único cliente presente nas duas evidências.
      const narrowed = ids.filter((id) => conflict!.ids.includes(id));
      if (narrowed.length === 1) return { status: "RESOLVED", customerId: narrowed[0]!, via };
      if (narrowed.length > 1) conflict = { via: conflict.via, ids: narrowed };
      continue;
    }
    if (ids.length === 1) return { status: "RESOLVED", customerId: ids[0]!, via };
    conflict = { via, ids };
  }

  if (conflict) return { status: "CONFLICT", via: conflict.via, candidateCustomerIds: conflict.ids };
  return { status: "NOT_FOUND" };
}
