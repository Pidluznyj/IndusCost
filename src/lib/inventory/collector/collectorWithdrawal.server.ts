/**
 * Retirada de material pelo tablet do Stock Collector.
 *
 * O operador escolhe o material, digita a quantidade e o próprio nome. O saldo
 * é debitado na hora — e é justamente por isso que este arquivo é curto e
 * chato: ele NÃO reimplementa regra de estoque. Toda a decisão de "pode ou não
 * pode" continua em createInventoryMovement / validateMovementRequest, que já
 * barram saída acima do disponível (INSUFFICIENT_AVAILABLE).
 *
 * O que este módulo faz é garantir três coisas que o motor não tem como saber:
 *
 *  1. O DISPOSITIVO NÃO ESCOLHE O TIPO DE MOVIMENTO. `assertMovementAuthorized`
 *     pula a checagem de permissão sempre que há deviceId — ou seja, o motor
 *     aceitaria qualquer movementType vindo daqui. O tipo é constante.
 *
 *  2. O CONTEXTO NÃO CARREGA VÁLVULA DE ESCAPE. Nada de permissions,
 *     allowNegativeStock ou allowOverReservation: é a ausência deles que faz o
 *     bloqueio de saldo valer para o tablet.
 *
 *  3. O SALDO NUNCA VOLTA PARA A TELA. O mesmo aparelho faz contagem cega no
 *     mesmo setor; revelar quanto existe contaminaria a contagem. Nem no
 *     sucesso, nem no erro de saldo insuficiente.
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createInventoryMovementInTx } from "./../inventoryService.server.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import type { InventoryTx } from "./../inventoryRepository.server.js";
import {
  COLLECTOR_SECTORS,
  type CollectorSectorCode,
} from "./collectorSectorContract.js";
import { RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE } from "./collectorSectorEligibility.js";

export const COLLECTOR_ITEM_NOT_ELIGIBLE = "COLLECTOR_ITEM_NOT_ELIGIBLE";
export const COLLECTOR_WITHDRAWAL_PERSON_MAX = 120;

/**
 * Tipo fixo da retirada. REQUISITION_EXIT tem rótulo de exibição ("Requisição")
 * mas NÃO é oferecido no formulário humano — então todo movimento desse tipo no
 * ledger é, sem ambiguidade, uma retirada feita pelo Coletor.
 */
export const COLLECTOR_WITHDRAWAL_MOVEMENT_TYPE = "REQUISITION_EXIT" as const;

/** Mensagem única de saldo insuficiente — deliberadamente sem número. */
export const COLLECTOR_INSUFFICIENT_STOCK_MESSAGE =
  "Não há material suficiente para essa retirada. Confira a quantidade ou acione o supervisor.";

const INSUFFICIENT_CODES = new Set(["INSUFFICIENT_AVAILABLE", "INSUFFICIENT_PHYSICAL"]);

/** Item retirável, na mesma pobreza de informação da lista cega de contagem. */
export type CollectorWithdrawItemDto = {
  itemId: string;
  code: string;
  description: string;
  unit: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
};

export type CollectorWithdrawalResult = {
  ok: true;
  idempotent: boolean;
  item: { code: string; description: string; unit: string };
  quantity: number;
  withdrawnBy: string;
};

type WithdrawalPrisma = Pick<
  PrismaClient,
  "inventoryBalance" | "inventoryCollectorWithdrawal" | "$transaction"
>;

/** Mesmo arredondamento do Inventory — Decimal(20,6). */
function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function parseWithdrawalPerson(raw: unknown): string {
  const person = typeof raw === "string" ? raw.trim() : "";
  if (!person) {
    throw new InventoryValidationError(
      "Informe o nome de quem está retirando.",
      "FIELD_REQUIRED"
    );
  }
  return person.slice(0, COLLECTOR_WITHDRAWAL_PERSON_MAX);
}

export function parseWithdrawalQuantity(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    throw new InventoryValidationError("Quantidade inválida.", "INVALID_QUANTITY");
  }
  return roundQuantity(value);
}

/**
 * Motivo gravado no ledger. O operador não digita motivo (a tela do Coletor não
 * pode ter textarea), então o servidor compõe um que satisfaz REASON_REQUIRED e
 * deixa o nome de quem retirou legível na trilha.
 */
export function buildWithdrawalReason(person: string): string {
  return `Retirada Collector — ${person}`;
}

export function buildWithdrawalNotes(sector: CollectorSectorCode, person: string): string {
  return `Setor ${COLLECTOR_SECTORS[sector].label} · retirado por ${person}`;
}

/** Traduz erro do motor para a tela, sem jamais revelar quanto existe. */
export function toCollectorWithdrawalError(e: unknown): unknown {
  if (e instanceof InventoryValidationError && INSUFFICIENT_CODES.has(e.code)) {
    return new InventoryValidationError(
      COLLECTOR_INSUFFICIENT_STOCK_MESSAGE,
      "COLLECTOR_INSUFFICIENT_STOCK"
    );
  }
  return e;
}

/**
 * Itens que o setor pode retirar naquele almoxarifado.
 *
 * Mesmo predicado da população da contagem — um item guardado em dois endereços
 * aparece como duas linhas, e escolher a linha escolhe o par item+endereço.
 * O DTO não carrega quantidade alguma.
 */
export async function listCollectorWithdrawItems(
  prisma: WithdrawalPrisma,
  input: { warehouseId: string; sector: CollectorSectorCode; q?: string | null }
): Promise<CollectorWithdrawItemDto[]> {
  if (input.sector !== "RAW_MATERIAL") {
    throw new InventoryValidationError(
      "Setor de retirada não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }
  const term = typeof input.q === "string" ? input.q.trim() : "";
  const rows = await prisma.inventoryBalance.findMany({
    where: {
      warehouseId: input.warehouseId,
      item: {
        ...RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
        ...(term
          ? {
              OR: [
                { code: { contains: term, mode: "insensitive" as const } },
                { description: { contains: term, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    },
    select: {
      itemId: true,
      locationId: true,
      item: { select: { code: true, description: true, unit: true } },
      location: { select: { code: true, name: true } },
    },
    orderBy: [{ item: { code: "asc" } }],
    take: 500,
  });

  return rows.map((row) => ({
    itemId: row.itemId,
    code: row.item.code,
    description: row.item.description,
    unit: row.item.unit,
    locationId: row.locationId,
    locationCode: row.location?.code ?? null,
    locationName: row.location?.name ?? null,
  }));
}

/**
 * Executa a retirada.
 *
 * Movimento e registro da operação vão na MESMA transação: se o mesmo
 * operationId chegar duas vezes (dois toques, retry de rede), o UNIQUE derruba
 * a transação inteira e o saldo não é debitado de novo — aí devolvemos o
 * resultado da primeira, marcado como idempotente.
 */
export async function withdrawCollectorMaterial(
  prisma: PrismaClient,
  input: {
    operationId: string;
    itemId: string;
    warehouseId: string;
    locationId: string | null;
    quantity: number;
    person: string;
    sector: CollectorSectorCode;
  },
  device: { id: string }
): Promise<CollectorWithdrawalResult> {
  const person = parseWithdrawalPerson(input.person);
  const quantity = parseWithdrawalQuantity(input.quantity);
  const operationId = String(input.operationId ?? "").trim();
  if (!operationId) {
    throw new InventoryValidationError(
      "Operação sem identificador.",
      "COLLECTOR_OPERATION_ID_REQUIRED"
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const item = await assertWithdrawableItem(tx as InventoryTx, {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
      });

      const result = await createInventoryMovementInTx(
        tx as InventoryTx,
        prisma,
        {
          itemId: input.itemId,
          movementType: COLLECTOR_WITHDRAWAL_MOVEMENT_TYPE,
          quantity,
          unit: item.unit,
          reason: buildWithdrawalReason(person),
          notes: buildWithdrawalNotes(input.sector, person),
          sourceWarehouseId: input.warehouseId,
          sourceLocationId: input.locationId,
          originType: "OTHER",
          originId: operationId,
        },
        // Sem permissions / allowNegativeStock / allowOverReservation: é a
        // ausência deles que mantém o bloqueio de saldo valendo aqui.
        { userId: null, deviceId: device.id }
      );

      await tx.inventoryCollectorWithdrawal.create({
        data: {
          operationId,
          deviceId: device.id,
          sector: input.sector,
          itemId: input.itemId,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          quantity,
          withdrawnBy: person,
          movementId: result.movement.id,
        },
      });

      return {
        ok: true as const,
        idempotent: false,
        item: { code: item.code, description: item.description, unit: item.unit },
        quantity,
        withdrawnBy: person,
      };
    });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const previous = await loadWithdrawalByOperationId(prisma, operationId);
      if (previous) return previous;
    }
    throw toCollectorWithdrawalError(e);
  }
}

/** Resposta da retirada já executada — nunca refaz o débito. */
async function loadWithdrawalByOperationId(
  prisma: PrismaClient,
  operationId: string
): Promise<CollectorWithdrawalResult | null> {
  const row = await prisma.inventoryCollectorWithdrawal.findUnique({
    where: { operationId },
  });
  if (!row) return null;
  const item = await prisma.inventoryItem.findUnique({
    where: { id: row.itemId },
    select: { code: true, description: true, unit: true },
  });
  return {
    ok: true,
    idempotent: true,
    item: {
      code: item?.code ?? "",
      description: item?.description ?? "",
      unit: item?.unit ?? "",
    },
    quantity: Number(row.quantity),
    withdrawnBy: row.withdrawnBy,
  };
}

/**
 * O item precisa ter saldo NAQUELE almoxarifado/endereço e passar o predicado
 * do setor. Sem isso, o cliente poderia apontar para um item de outro setor
 * apenas trocando o id no corpo da requisição.
 */
async function assertWithdrawableItem(
  tx: InventoryTx,
  input: { itemId: string; warehouseId: string; locationId: string | null }
): Promise<{ code: string; description: string; unit: string }> {
  const row = await tx.inventoryBalance.findFirst({
    where: {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      item: RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
    },
    select: { item: { select: { code: true, description: true, unit: true } } },
  });
  if (!row) {
    throw new InventoryValidationError(
      "Material não disponível para retirada neste setor.",
      COLLECTOR_ITEM_NOT_ELIGIBLE
    );
  }
  return row.item;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
