/**
 * Projetos — condições comerciais estruturadas (regra pura, browser-safe).
 *
 * - Vocabulário igual ao da Proposta comercial (frete CIF/FOB, prazos em dias) e ao da ficha
 *   (prioridade Baixa/Média/Alta/Urgente).
 * - Nada é preenchido automaticamente: campo não definido fica null e o documento mostra
 *   "A definir".
 * - Observações INTERNAS (`notes`) nunca entram nos termos destinados ao cliente; o cliente vê
 *   apenas `clientNotes`.
 */

export const PROJECT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const PROJECT_FREIGHT_CONDITIONS = ["CIF", "FOB"] as const;
export type ProjectFreightCondition = (typeof PROJECT_FREIGHT_CONDITIONS)[number];
/** Mesmos rótulos do documento da Proposta comercial (ProposalClientDocument). */
export const PROJECT_FREIGHT_LABELS: Record<ProjectFreightCondition, string> = {
  CIF: "CIF (frete por conta do emitente)",
  FOB: "FOB (frete por conta do destinatário)",
};

export const COMMERCIAL_TERM_UNDEFINED = "A definir";
export const PROJECT_TEXT_MAX = 2000;
export const PROJECT_DAYS_MAX = 3650;

export type ProjectCommercialFields = {
  proposalValidityDays: number | null;
  paymentTerms: string | null;
  deliveryTimeDays: number | null;
  deliveryLocation: string | null;
  freightCondition: ProjectFreightCondition | null;
  desiredDeadline: string | null; // AAAA-MM-DD
  priority: ProjectPriority | null;
  application: string | null;
  clientNotes: string | null;
};

export const PROJECT_COMMERCIAL_FIELD_KEYS = [
  "proposalValidityDays",
  "paymentTerms",
  "deliveryTimeDays",
  "deliveryLocation",
  "freightCondition",
  "desiredDeadline",
  "priority",
  "application",
  "clientNotes",
] as const satisfies readonly (keyof ProjectCommercialFields)[];

export const isProjectPriority = (v: unknown): v is ProjectPriority =>
  typeof v === "string" && (PROJECT_PRIORITIES as readonly string[]).includes(v);
export const isProjectFreightCondition = (v: unknown): v is ProjectFreightCondition =>
  typeof v === "string" && (PROJECT_FREIGHT_CONDITIONS as readonly string[]).includes(v);

type Fail = { ok: false; code: string; message: string };
export type CommercialPatchResult = { ok: true; value: Partial<ProjectCommercialFields> } | Fail;

function isoDate(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 ? v.trim() : undefined;
}

/**
 * Lê só as chaves de condições comerciais presentes no corpo (PATCH parcial).
 * `null` ou "" limpam o campo. Valores fora do vocabulário → 400.
 */
export function parseProjectCommercialPatch(body: Record<string, unknown>): CommercialPatchResult {
  const out: Partial<ProjectCommercialFields> = {};
  const text = (key: "paymentTerms" | "deliveryLocation" | "application" | "clientNotes", label: string): Fail | null => {
    if (!(key in body)) return null;
    const v = body[key];
    if (v === null || v === "") {
      out[key] = null;
      return null;
    }
    if (typeof v !== "string") return { ok: false, code: "INVALID_FIELD", message: `${label} inválido.` };
    const t = v.trim();
    if (t.length > PROJECT_TEXT_MAX) return { ok: false, code: "FIELD_TOO_LONG", message: `${label} muito longo.` };
    out[key] = t.length ? t : null;
    return null;
  };
  const days = (key: "proposalValidityDays" | "deliveryTimeDays", label: string): Fail | null => {
    if (!(key in body)) return null;
    const v = body[key];
    if (v === null || v === "") {
      out[key] = null;
      return null;
    }
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > PROJECT_DAYS_MAX) {
      return { ok: false, code: "INVALID_DAYS", message: `${label}: informe um número inteiro de dias.` };
    }
    out[key] = n;
    return null;
  };
  const fails = [
    text("paymentTerms", "Condição de pagamento"),
    text("deliveryLocation", "Local de entrega"),
    text("application", "Aplicação"),
    text("clientNotes", "Observações ao cliente"),
    days("proposalValidityDays", "Validade da proposta"),
    days("deliveryTimeDays", "Prazo de entrega"),
  ].filter((f): f is Fail => f !== null);
  if (fails.length) return fails[0];
  if ("freightCondition" in body) {
    const v = body.freightCondition;
    if (v === null || v === "") out.freightCondition = null;
    else if (isProjectFreightCondition(v)) out.freightCondition = v;
    else return { ok: false, code: "INVALID_FREIGHT", message: "Frete deve ser CIF ou FOB." };
  }
  if ("priority" in body) {
    const v = body.priority;
    if (v === null || v === "") out.priority = null;
    else if (isProjectPriority(v)) out.priority = v;
    else return { ok: false, code: "INVALID_PRIORITY", message: "Prioridade inválida." };
  }
  if ("desiredDeadline" in body) {
    const v = isoDate(body.desiredDeadline);
    if (v === undefined) return { ok: false, code: "INVALID_DATE", message: "Prazo desejado inválido (AAAA-MM-DD)." };
    out.desiredDeadline = v;
  }
  return { ok: true, value: out };
}

/** Termos exibidos ao CLIENTE. Nunca usa `notes` (interno). Indefinido → null ("A definir"). */
export type ClientCommercialTerms = {
  proposalValidity: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  freightTerms: string | null;
  clientNotes: string | null;
};

export function buildClientCommercialTerms(p: Partial<ProjectCommercialFields>): ClientCommercialTerms {
  const plural = (n: number, s: string, pl: string) => `${n} ${n === 1 ? s : pl}`;
  const delivery = [
    p.deliveryTimeDays != null ? plural(p.deliveryTimeDays, "dia", "dias") : null,
    p.deliveryLocation?.trim() || null,
  ].filter(Boolean);
  return {
    proposalValidity: p.proposalValidityDays != null ? plural(p.proposalValidityDays, "dia", "dias") : null,
    paymentTerms: p.paymentTerms?.trim() || null,
    deliveryTerms: delivery.length ? delivery.join(" · ") : null,
    freightTerms: p.freightCondition ? PROJECT_FREIGHT_LABELS[p.freightCondition] : null,
    clientNotes: p.clientNotes?.trim() || null,
  };
}

export function projectPriorityLabel(p: string | null | undefined): string | null {
  return isProjectPriority(p) ? PROJECT_PRIORITY_LABELS[p] : null;
}

/** Validade em data: emissão + dias (AAAA-MM-DD, UTC). */
export function proposalValidUntil(issuedAtIso: string, validityDays: number | null): string | null {
  if (validityDays == null) return null;
  const d = new Date(issuedAtIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + validityDays);
  return d.toISOString().slice(0, 10);
}

/** Dados prontos para o Prisma (prazo desejado vira Date à meia-noite UTC). */
export type ProjectCommercialData = {
  proposalValidityDays?: number | null;
  paymentTerms?: string | null;
  deliveryTimeDays?: number | null;
  deliveryLocation?: string | null;
  freightCondition?: string | null;
  desiredDeadline?: Date | null;
  priority?: string | null;
  application?: string | null;
  clientNotes?: string | null;
};

export function toProjectCommercialData(value: Partial<ProjectCommercialFields>): ProjectCommercialData {
  const { desiredDeadline, ...rest } = value;
  const out: ProjectCommercialData = { ...rest };
  if (desiredDeadline !== undefined) {
    out.desiredDeadline = desiredDeadline === null ? null : new Date(`${desiredDeadline}T00:00:00.000Z`);
  }
  return out;
}

/** Valores neutros dos campos de cliente/condições do ProjectDetail (projeto sem nada definido). */
export const EMPTY_PROJECT_DOCUMENT_FIELDS = {
  customerId: null,
  customerLinkedAt: null,
  customerLinkSource: null,
  customer: null,
  proposalValidityDays: null,
  paymentTerms: null,
  deliveryTimeDays: null,
  deliveryLocation: null,
  freightCondition: null,
  desiredDeadline: null,
  priority: null,
  application: null,
  clientNotes: null,
} as const;
