/**
 * Catálogo global de EPIs e uniformes (HrEpiItem).
 * Código automático e imutável; item com entrega nunca é excluído (FK Restrict + checagem na transação).
 */
import type { PrismaClient } from "@prisma/client";
import { PeopleProfileAccessError } from "../peopleProfileErrors.js";
import { logEmployeeHrAudit } from "../employeeHrAudit.js";
import { epiItemCode, validateEpiItemInput, type EpiItemInput, type EpiItemType, type EpiUnit } from "./epiRules.js";

export type EpiItemDto = {
  id: string;
  code: string;
  description: string;
  type: EpiItemType;
  caNumber: string | null;
  unit: EpiUnit;
  replacementDays: number | null;
  notes: string | null;
  active: boolean;
  deliveryCount: number;
  /** Só item sem nenhuma entrega pode ser excluído. */
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
};

const ITEM_SELECT = {
  id: true,
  code: true,
  description: true,
  type: true,
  caNumber: true,
  unit: true,
  replacementDays: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { deliveries: true } },
} as const;

type ItemRow = {
  id: string;
  code: string;
  description: string;
  type: string;
  caNumber: string | null;
  unit: string;
  replacementDays: number | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { deliveries: number };
};

function toDto(row: ItemRow): EpiItemDto {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    type: row.type as EpiItemType,
    caNumber: row.caNumber,
    unit: row.unit as EpiUnit,
    replacementDays: row.replacementDays,
    notes: row.notes,
    active: row.active,
    deliveryCount: row._count.deliveries,
    canDelete: row._count.deliveries === 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function invalid(errors: string[]): never {
  throw new PeopleProfileAccessError("INVALID_EPI_ITEM", errors.join(" "), 400);
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return Boolean(e && (e.code === "P2002" || /HrEpiItem_type_description_ca_key|duplicate key/i.test(e.message ?? "")));
}

const DUPLICATE_MESSAGE =
  "Já existe um item com o mesmo tipo, descrição e CA. Use o item existente (ou reative-o) em vez de cadastrar outro.";

export async function listEpiItems(
  prisma: PrismaClient,
  opts: { q?: string | null; includeInactive?: boolean } = {},
): Promise<EpiItemDto[]> {
  const q = opts.q?.trim();
  const rows = await prisma.hrEpiItem.findMany({
    where: {
      ...(opts.includeInactive ? {} : { active: true }),
      ...(q
        ? {
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q, mode: "insensitive" as const } },
              { caNumber: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ active: "desc" }, { description: "asc" }],
    take: 500,
    select: ITEM_SELECT,
  });
  // Ordem alfabética pt-BR (acentos no lugar certo), ativos primeiro.
  return (rows as ItemRow[])
    .map(toDto)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.description.localeCompare(b.description, "pt-BR"));
}

export async function createEpiItem(
  prisma: PrismaClient,
  body: Record<string, unknown>,
  actorUserId: string | null,
): Promise<EpiItemDto> {
  const parsed = validateEpiItemInput(body);
  if (parsed.ok === false) invalid(parsed.errors);
  const input = parsed.value;
  try {
    const row = await prisma.$transaction(async (tx) => {
      // Número da sequência reservado antes: o código nasce junto com o registro e nunca muda.
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT nextval(pg_get_serial_sequence('"HrEpiItem"', 'number'))::int AS n`;
      return tx.hrEpiItem.create({
        data: {
          number: n,
          code: epiItemCode(input.type, n),
          ...input,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
        select: ITEM_SELECT,
      });
    });
    logEmployeeHrAudit({ event: "hr.epi_item.create", actorUserId, details: { itemId: row.id, code: row.code, type: row.type } });
    return toDto(row as ItemRow);
  } catch (error) {
    if (isUniqueViolation(error)) throw new PeopleProfileAccessError("DUPLICATE_EPI_ITEM", DUPLICATE_MESSAGE, 409);
    throw error;
  }
}

async function loadItem(prisma: PrismaClient, id: string): Promise<ItemRow> {
  const row = await prisma.hrEpiItem.findUnique({ where: { id }, select: ITEM_SELECT });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "EPI / uniforme não encontrado.", 404);
  return row as ItemRow;
}

/** Edita o cadastro. Entregas já feitas guardam o retrato do item e não mudam. */
export async function updateEpiItem(
  prisma: PrismaClient,
  id: string,
  body: Record<string, unknown>,
  actorUserId: string | null,
): Promise<EpiItemDto> {
  const current = await loadItem(prisma, id);
  if (Object.prototype.hasOwnProperty.call(body, "type") && body.type !== current.type) {
    throw new PeopleProfileAccessError(
      "EPI_TYPE_IMMUTABLE",
      "O tipo não pode ser alterado: o código do item já identifica o tipo. Cadastre um novo item.",
      400,
    );
  }
  const currentInput: EpiItemInput = {
    description: current.description,
    type: current.type as EpiItemType,
    caNumber: current.caNumber,
    unit: current.unit as EpiUnit,
    replacementDays: current.replacementDays,
    notes: current.notes,
  };
  const parsed = validateEpiItemInput(body, currentInput);
  if (parsed.ok === false) invalid(parsed.errors);
  const { type: _type, ...data } = parsed.value;
  try {
    const row = await prisma.hrEpiItem.update({
      where: { id },
      data: { ...data, updatedByUserId: actorUserId },
      select: ITEM_SELECT,
    });
    logEmployeeHrAudit({
      event: "hr.epi_item.update",
      actorUserId,
      details: {
        itemId: id,
        fields: (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== currentInput[k]),
      },
    });
    return toDto(row as ItemRow);
  } catch (error) {
    if (isUniqueViolation(error)) throw new PeopleProfileAccessError("DUPLICATE_EPI_ITEM", DUPLICATE_MESSAGE, 409);
    throw error;
  }
}

/** Inativo não aparece para novas entregas; histórico e trocas vigentes continuam. */
export async function setEpiItemActive(
  prisma: PrismaClient,
  id: string,
  active: boolean,
  actorUserId: string | null,
): Promise<EpiItemDto> {
  await loadItem(prisma, id);
  try {
    const row = await prisma.hrEpiItem.update({ where: { id }, data: { active, updatedByUserId: actorUserId }, select: ITEM_SELECT });
    logEmployeeHrAudit({ event: "hr.epi_item.status", actorUserId, details: { itemId: id, active } });
    return toDto(row as ItemRow);
  } catch (error) {
    if (isUniqueViolation(error)) throw new PeopleProfileAccessError("DUPLICATE_EPI_ITEM", DUPLICATE_MESSAGE, 409);
    throw error;
  }
}

/** Exclui só item nunca entregue. A FK Restrict protege contra entrega gravada em paralelo. */
export async function deleteEpiItem(prisma: PrismaClient, id: string, actorUserId: string | null): Promise<{ ok: true }> {
  const inUse = () =>
    new PeopleProfileAccessError(
      "EPI_ITEM_IN_USE",
      "Este item já foi entregue a colaboradores e não pode ser excluído. Inative-o para impedir novas entregas.",
      409,
    );
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.hrEpiItem.findUnique({ where: { id }, select: { id: true, _count: { select: { deliveries: true } } } });
      if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "EPI / uniforme não encontrado.", 404);
      if (row._count.deliveries > 0) throw inUse();
      await tx.hrEpiItem.delete({ where: { id } });
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2003" || /foreign key|violates foreign key/i.test((error as Error)?.message ?? "")) throw inUse();
    throw error;
  }
  logEmployeeHrAudit({ event: "hr.epi_item.delete", actorUserId, details: { itemId: id } });
  return { ok: true };
}
