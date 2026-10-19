/**
 * EPIs e uniformes — regras puras (catálogo, entregas, vencimentos).
 *
 * Conceitos que NÃO se confundem aqui:
 * - CA (Certificado de Aprovação): identifica o EPI aprovado pelo MTE; não é validade nem vida útil.
 * - Prazo de troca: periodicidade de substituição definida pela empresa (não é imposição legal).
 * - Registro de entrega: lançamento administrativo do RH. A comprovação de recebimento
 *   pelo trabalhador (NR-6) é o documento assinado anexado em Documentos.
 */
import { addDaysIso, formatDateBr, isIsoDate } from "../employeeLifecycle.js";

export const EPI_ITEM_TYPES = ["EPI", "UNIFORM"] as const;
export type EpiItemType = (typeof EPI_ITEM_TYPES)[number];
export const EPI_ITEM_TYPE_LABELS: Record<EpiItemType, string> = { EPI: "EPI", UNIFORM: "Uniforme" };

export const EPI_UNITS = ["UNIT", "PAIR", "KIT"] as const;
export type EpiUnit = (typeof EPI_UNITS)[number];
export const EPI_UNIT_LABELS: Record<EpiUnit, string> = { UNIT: "Unidade", PAIR: "Par", KIT: "Kit" };

export const EPI_DELIVERY_STATUSES = ["ACTIVE", "REPLACED", "CLOSED", "CANCELLED"] as const;
export type EpiDeliveryStatus = (typeof EPI_DELIVERY_STATUSES)[number];
export const EPI_DELIVERY_STATUS_LABELS: Record<EpiDeliveryStatus, string> = {
  ACTIVE: "Vigente",
  REPLACED: "Substituído",
  CLOSED: "Encerrado",
  CANCELLED: "Cancelado",
};

/** Faixas do controle de vencimentos (mutuamente exclusivas). */
export const EPI_DUE_BANDS = ["OVERDUE", "DUE_30", "DUE_60"] as const;
export type EpiDueBand = (typeof EPI_DUE_BANDS)[number];
export const EPI_DUE_BAND_LABELS: Record<EpiDueBand, string> = {
  OVERDUE: "Vencido",
  DUE_30: "Até 30 dias",
  DUE_60: "31 a 60 dias",
};
export const EPI_DUE_WINDOW_DAYS = 60;

export const EPI_LIMITS = {
  description: 200,
  caNumber: 20,
  notes: 2000,
  reason: 500,
  reasonMin: 10,
  replacementDaysMax: 3650,
  quantityMax: 9999,
} as const;

export function isEpiItemType(v: unknown): v is EpiItemType {
  return typeof v === "string" && (EPI_ITEM_TYPES as readonly string[]).includes(v);
}
export function isEpiUnit(v: unknown): v is EpiUnit {
  return typeof v === "string" && (EPI_UNITS as readonly string[]).includes(v);
}
export function isEpiDeliveryStatus(v: unknown): v is EpiDeliveryStatus {
  return typeof v === "string" && (EPI_DELIVERY_STATUSES as readonly string[]).includes(v);
}

/** Código imutável gravado na criação: EPI-0001 / UNI-0001 (número sequencial global). */
export function epiItemCode(type: EpiItemType, number: number): string {
  return `${type === "EPI" ? "EPI" : "UNI"}-${String(number).padStart(4, "0")}`;
}

export type EpiItemInput = {
  description: string;
  type: EpiItemType;
  caNumber: string | null;
  unit: EpiUnit;
  replacementDays: number | null;
  notes: string | null;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);

export function parseReplacementDays(v: unknown, errors: string[]): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n <= 0 || n > EPI_LIMITS.replacementDaysMax) {
    errors.push(`Prazo de troca deve ser um número inteiro de dias entre 1 e ${EPI_LIMITS.replacementDaysMax}.`);
    return null;
  }
  return n;
}

/** Valida o cadastro (criação completa ou edição parcial sobre o registro atual). */
export function validateEpiItemInput(body: Record<string, unknown>, current?: EpiItemInput): ValidationResult<EpiItemInput> {
  const errors: string[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const description = has("description") ? text(body.description) : current?.description ?? null;
  if (!description) errors.push("Descrição é obrigatória.");
  else if (description.length > EPI_LIMITS.description) errors.push(`Descrição com no máximo ${EPI_LIMITS.description} caracteres.`);
  const type = has("type") ? body.type : current?.type;
  if (!isEpiItemType(type)) errors.push("Tipo deve ser EPI ou Uniforme.");
  const unit = has("unit") ? body.unit ?? "UNIT" : current?.unit ?? "UNIT";
  if (!isEpiUnit(unit)) errors.push("Unidade deve ser unidade, par ou kit.");
  const caRaw = has("caNumber") ? text(body.caNumber) : current?.caNumber ?? null;
  const caNumber = caRaw ? caRaw.replace(/^CA\s*/i, "") : null;
  if (caNumber && !/^[0-9A-Za-z./-]{1,20}$/.test(caNumber)) errors.push("Número do CA inválido (até 20 letras/números).");
  const replacementDays = has("replacementDays") ? parseReplacementDays(body.replacementDays, errors) : current?.replacementDays ?? null;
  const notes = has("notes") ? text(body.notes) : current?.notes ?? null;
  if (notes && notes.length > EPI_LIMITS.notes) errors.push(`Observações com no máximo ${EPI_LIMITS.notes} caracteres.`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { description: description!, type: type as EpiItemType, caNumber, unit: unit as EpiUnit, replacementDays, notes },
  };
}

/** Data prevista = data da entrega + prazo (dias corridos, datas de calendário). */
export function computeReplacementDueDate(deliveredIso: string, replacementDays: number | null): string | null {
  if (!replacementDays || !isIsoDate(deliveredIso)) return null;
  return addDaysIso(deliveredIso, replacementDays);
}

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00.000Z`) / 86_400_000);
}

export function daysUntil(dueIso: string, todayIso: string): number {
  return dayNumber(dueIso) - dayNumber(todayIso);
}

/** Faixa do vencimento: vencido (< hoje), 0–30, 31–60; fora da janela = null. */
export function epiDueBand(dueIso: string | null, todayIso: string): EpiDueBand | null {
  if (!dueIso) return null;
  const d = daysUntil(dueIso, todayIso);
  if (d < 0) return "OVERDUE";
  if (d <= 30) return "DUE_30";
  if (d <= EPI_DUE_WINDOW_DAYS) return "DUE_60";
  return null;
}

export function describeDue(dueIso: string | null, todayIso: string): string {
  if (!dueIso) return "Sem troca programada";
  const d = daysUntil(dueIso, todayIso);
  if (d < 0) return `Vencido há ${-d} dia(s) (${formatDateBr(dueIso)})`;
  if (d === 0) return `Vence hoje (${formatDateBr(dueIso)})`;
  return `${formatDateBr(dueIso)} (em ${d} dia(s))`;
}

export type EpiDeliveryInput = {
  itemId: string;
  deliveredOn: string;
  quantity: number;
  size: string | null;
  notes: string | null;
  replacementDays: number | null;
  replacementDueDate: string | null;
  adjustReason: string | null;
};

/**
 * Valida a entrega. O prazo vem do cadastro do item; mudar prazo ou data prevista
 * exige justificativa. Prazo vazio no cadastro = sem troca programada (entrega válida).
 */
export function validateEpiDeliveryInput(
  body: Record<string, unknown>,
  ctx: { todayIso: string; catalogReplacementDays: number | null },
): ValidationResult<EpiDeliveryInput> {
  const errors: string[] = [];
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!itemId) errors.push("Selecione o EPI / uniforme.");
  const deliveredOn = typeof body.deliveredOn === "string" ? body.deliveredOn.slice(0, 10) : "";
  if (!isIsoDate(deliveredOn)) errors.push("Data da entrega é obrigatória.");
  else if (deliveredOn > ctx.todayIso) errors.push("A data da entrega não pode ser futura.");
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > EPI_LIMITS.quantityMax) {
    errors.push("Quantidade deve ser um número inteiro maior que zero.");
  }
  const size = text(body.size);
  if (size && size.length > 40) errors.push("Tamanho com no máximo 40 caracteres.");
  const notes = text(body.notes);
  if (notes && notes.length > EPI_LIMITS.notes) errors.push(`Observações com no máximo ${EPI_LIMITS.notes} caracteres.`);

  const hasDays = Object.prototype.hasOwnProperty.call(body, "replacementDays");
  const replacementDays = hasDays ? parseReplacementDays(body.replacementDays, errors) : ctx.catalogReplacementDays;
  const computed = isIsoDate(deliveredOn) ? computeReplacementDueDate(deliveredOn, replacementDays) : null;
  const dueRaw = typeof body.replacementDueDate === "string" && body.replacementDueDate ? body.replacementDueDate.slice(0, 10) : null;
  if (dueRaw && !isIsoDate(dueRaw)) errors.push("Data prevista de substituição inválida.");
  if (dueRaw && isIsoDate(deliveredOn) && dueRaw <= deliveredOn) errors.push("A data prevista de substituição deve ser posterior à entrega.");
  const replacementDueDate = dueRaw ?? computed;
  const adjusted = replacementDays !== ctx.catalogReplacementDays || (dueRaw != null && dueRaw !== computed);
  const adjustReason = text(body.adjustReason);
  if (adjusted && (!adjustReason || adjustReason.length < EPI_LIMITS.reasonMin)) {
    errors.push(`Prazo ou data de troca diferente do cadastro do item: informe a justificativa (mín. ${EPI_LIMITS.reasonMin} caracteres).`);
  }
  if (adjustReason && adjustReason.length > EPI_LIMITS.reason) errors.push(`Justificativa com no máximo ${EPI_LIMITS.reason} caracteres.`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      itemId,
      deliveredOn,
      quantity,
      size,
      notes,
      replacementDays,
      replacementDueDate,
      adjustReason: adjusted ? adjustReason : null,
    },
  };
}

/** Motivo obrigatório para cancelar/encerrar (mín. 10 caracteres). */
export function validateStatusReason(v: unknown): ValidationResult<string> {
  const reason = text(v);
  if (!reason || reason.length < EPI_LIMITS.reasonMin) {
    return { ok: false, errors: [`Informe o motivo (mín. ${EPI_LIMITS.reasonMin} caracteres).`] };
  }
  if (reason.length > EPI_LIMITS.reason) return { ok: false, errors: [`Motivo com no máximo ${EPI_LIMITS.reason} caracteres.`] };
  return { ok: true, value: reason };
}

export type EpiReplacementRow = {
  deliveryId: string;
  employeeId: string;
  employeeName: string;
  departmentName: string | null;
  departmentId: string | null;
  itemCode: string | null;
  itemDescription: string;
  itemType: string | null;
  quantity: number;
  deliveredOn: string;
  replacementDueDate: string;
  daysLeft: number;
  band: EpiDueBand;
};

/** Ordenação: mais atrasados primeiro, depois vencimentos mais próximos. */
export function sortReplacementRows<T extends { daysLeft: number; employeeName: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.daysLeft - b.daysLeft || a.employeeName.localeCompare(b.employeeName, "pt-BR"));
}

export function countByBand(rows: readonly { band: EpiDueBand }[]): Record<EpiDueBand, number> {
  const out: Record<EpiDueBand, number> = { OVERDUE: 0, DUE_30: 0, DUE_60: 0 };
  for (const r of rows) out[r.band] += 1;
  return out;
}
