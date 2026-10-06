/**
 * Retirada pelo Collector em setor STANDARD (InventoryStockSector).
 *
 * Mesmo núcleo, mesmo tipo de movimento e mesmo motor da retirada de
 * Matéria-prima (executeCollectorWithdrawal → createInventoryMovementInTx): a
 * decisão de "pode ou não pode" e o bloqueio de saldo continuam no motor.
 *
 * O que é próprio do STANDARD:
 *  - o SERVIDOR deriva almoxarifado, tipo de movimento e centro de custo do
 *    setor; o corpo da requisição não escolhe nenhum deles;
 *  - o item precisa ser elegível e pertencer ao setor;
 *  - a busca é paginada no servidor (catálogo de 1.000+ itens);
 *  - o saldo disponível aparece na retirada — EXCETO enquanto houver
 *    conferência em contagem no almoxarifado do setor: o mesmo aparelho conta
 *    às cegas, e mostrar o saldo durante a contagem a contaminaria.
 */
import type { PrismaClient } from "@prisma/client";
import { InventoryValidationError } from "./../inventoryTypes.js";
import type { InventoryTx } from "./../inventoryRepository.server.js";
import {
  assertCollectorWithdrawalAllowed,
  type CollectorStandardSectorRef,
} from "./collectorSectorResolve.server.js";
import {
  standardSectorMemberItemWhere,
  standardSectorStockControlledItemWhere,
} from "./collectorStandardEligibility.js";
import { assertStandardSectorWarehouse } from "./collectorStandardSector.server.js";
import {
  COLLECTOR_ITEM_NOT_ELIGIBLE,
  executeCollectorWithdrawal,
  type CollectorWithdrawableItem,
  type CollectorWithdrawalResult,
  type CollectorWithdrawItemDto,
} from "./collectorWithdrawal.server.js";

export const COLLECTOR_STANDARD_WITHDRAW_PAGE_SIZE = 50;
export const COLLECTOR_STANDARD_WITHDRAW_PAGE_MAX = 100;
export const COLLECTOR_WITHDRAWAL_DESTINATION_MAX = 120;

export type CollectorStandardWithdrawItemDto = CollectorWithdrawItemDto & {
  /** Disponível no par item × endereço; null enquanto o saldo está oculto. */
  availableQuantity: number | null;
};

export type CollectorStandardWithdrawItemsPage = {
  items: CollectorStandardWithdrawItemDto[];
  /** false durante conferência em contagem no almoxarifado do setor. */
  balanceVisible: boolean;
  hasMore: boolean;
  nextOffset: number | null;
};

export type CollectorStandardWithdrawalResult = CollectorWithdrawalResult & {
  /** Disponível após a retirada, lido do servidor; null enquanto oculto. */
  remainingQuantity: number | null;
};

type StandardWithdrawalReadDb = Pick<
  PrismaClient,
  "inventoryBalance" | "inventoryItem" | "inventoryCountSession"
>;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clampPage(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** Saldo só é revelado fora de conferência em contagem no almoxarifado do setor. */
async function isSectorBalanceVisible(
  db: Pick<PrismaClient, "inventoryCountSession">,
  sector: Pick<CollectorStandardSectorRef, "warehouseId">
): Promise<boolean> {
  const counting = await db.inventoryCountSession.count({
    where: { warehouseId: sector.warehouseId, status: "COUNTING" },
  });
  return counting === 0;
}

/**
 * Página de itens retiráveis do setor, com busca por código/descrição no
 * servidor. 3 consultas por página, qualquer que seja o tamanho do catálogo:
 * itens da página, saldos desses itens no almoxarifado e visibilidade do saldo.
 * Item em mais de um endereço vira uma linha por endereço.
 */
export async function listCollectorStandardWithdrawItems(
  prisma: StandardWithdrawalReadDb,
  input: {
    sector: CollectorStandardSectorRef;
    q?: string | null;
    limit?: unknown;
    offset?: unknown;
  }
): Promise<CollectorStandardWithdrawItemsPage> {
  assertCollectorWithdrawalAllowed(input.sector);
  const warehouseId = input.sector.warehouseId;
  const term = typeof input.q === "string" ? input.q.trim() : "";
  const limit = clampPage(
    input.limit,
    COLLECTOR_STANDARD_WITHDRAW_PAGE_SIZE,
    COLLECTOR_STANDARD_WITHDRAW_PAGE_MAX
  );
  const offset = Math.max(0, Number.parseInt(String(input.offset ?? "0"), 10) || 0);

  const [pageItems, balanceVisible] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        AND: [
          standardSectorMemberItemWhere(input.sector),
          ...(term
            ? [
                {
                  OR: [
                    { code: { contains: term, mode: "insensitive" as const } },
                    { description: { contains: term, mode: "insensitive" as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: { id: true, code: true, description: true, unit: true },
      orderBy: [{ code: "asc" }],
      skip: offset,
      take: limit + 1,
    }),
    isSectorBalanceVisible(prisma, input.sector),
  ]);

  const hasMore = pageItems.length > limit;
  const items = hasMore ? pageItems.slice(0, limit) : pageItems;
  const balanceRows =
    items.length === 0
      ? []
      : await prisma.inventoryBalance.findMany({
          where: { warehouseId, itemId: { in: items.map((item) => item.id) } },
          select: {
            itemId: true,
            locationId: true,
            availableQuantity: true,
            location: { select: { code: true, name: true } },
          },
        });

  const balancesByItem = new Map<string, typeof balanceRows>();
  for (const row of balanceRows) {
    const list = balancesByItem.get(row.itemId);
    if (list) list.push(row);
    else balancesByItem.set(row.itemId, [row]);
  }

  const rows: CollectorStandardWithdrawItemDto[] = [];
  for (const item of items) {
    const base = {
      itemId: item.id,
      code: item.code,
      description: item.description,
      unit: item.unit,
    };
    const balances = balancesByItem.get(item.id);
    if (!balances) {
      // Pertence pelo almoxarifado padrão e ainda não tem saldo: disponível 0.
      rows.push({
        ...base,
        locationId: null,
        locationCode: null,
        locationName: null,
        availableQuantity: balanceVisible ? 0 : null,
      });
      continue;
    }
    for (const balance of balances) {
      rows.push({
        ...base,
        locationId: balance.locationId,
        locationCode: balance.location?.code ?? null,
        locationName: balance.location?.name ?? null,
        availableQuantity: balanceVisible ? toNumber(balance.availableQuantity) : null,
      });
    }
  }

  return {
    items: rows,
    balanceVisible,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

export function parseWithdrawalDestination(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text ? text.slice(0, COLLECTOR_WITHDRAWAL_DESTINATION_MAX) : null;
}

/**
 * Executa a retirada do setor STANDARD. Só acontece se o setor permite
 * retirada; almoxarifado e centro de custo vêm do setor. Saldo insuficiente
 * continua barrado pelo motor; o mesmo operationId nunca debita duas vezes.
 */
export async function withdrawCollectorStandardItem(
  prisma: PrismaClient,
  input: {
    sector: CollectorStandardSectorRef;
    operationId: string;
    itemId: string;
    /** Opcional; quando informado precisa ser o almoxarifado do setor. */
    warehouseId?: string | null;
    locationId: string | null;
    quantity: number;
    person: string;
    /** Destino / motivo informado pelo operador — vai para as observações. */
    destination?: unknown;
  },
  device: { id: string }
): Promise<CollectorStandardWithdrawalResult> {
  const sector = input.sector;
  assertCollectorWithdrawalAllowed(sector);
  const warehouseId = assertStandardSectorWarehouse(sector, input.warehouseId);
  const destination = parseWithdrawalDestination(input.destination);

  const result = await executeCollectorWithdrawal(
    prisma,
    {
      operationId: input.operationId,
      itemId: input.itemId,
      warehouseId,
      locationId: input.locationId,
      quantity: input.quantity,
      person: input.person,
      sectorCode: sector.code,
      sectorLabel: sector.label,
      costCenterId: sector.defaultCostCenterId,
      notesSuffix: destination ? `destino: ${destination}` : null,
      assertItem: (tx) =>
        assertStandardWithdrawableItem(tx, {
          sector,
          itemId: input.itemId,
          locationId: input.locationId,
        }),
    },
    device
  );

  // Saldo resultante vem do servidor, depois do commit — a tela não calcula.
  let remainingQuantity: number | null = null;
  if (await isSectorBalanceVisible(prisma, sector)) {
    const balance = await prisma.inventoryBalance.findFirst({
      where: { itemId: input.itemId, warehouseId, locationId: input.locationId },
      select: { availableQuantity: true },
    });
    remainingQuantity = balance ? toNumber(balance.availableQuantity) : 0;
  }
  return { ...result, remainingQuantity };
}

/**
 * O item precisa passar o predicado do setor (ACTIVE, itemType do setor,
 * controla estoque) E pertencer ao almoxarifado do setor — saldo no par
 * almoxarifado/endereço pedido, ou almoxarifado padrão quando não há endereço.
 * Item de outro tipo, inativo ou de outro almoxarifado some aqui, antes de
 * qualquer débito. No máximo 2 leituras.
 */
async function assertStandardWithdrawableItem(
  tx: InventoryTx,
  input: {
    sector: Pick<CollectorStandardSectorRef, "itemType" | "warehouseId">;
    itemId: string;
    locationId: string | null;
  }
): Promise<CollectorWithdrawableItem> {
  const notEligible = () =>
    new InventoryValidationError(
      "Item não disponível para retirada neste setor.",
      COLLECTOR_ITEM_NOT_ELIGIBLE
    );
  const item = await tx.inventoryItem.findFirst({
    where: { id: input.itemId, ...standardSectorStockControlledItemWhere(input.sector) },
    select: { code: true, description: true, unit: true, defaultWarehouseId: true },
  });
  if (!item) throw notEligible();
  const balance = await tx.inventoryBalance.findFirst({
    where: {
      itemId: input.itemId,
      warehouseId: input.sector.warehouseId,
      locationId: input.locationId,
    },
    select: { id: true },
  });
  if (!balance) {
    const belongsByDefault =
      input.locationId == null && item.defaultWarehouseId === input.sector.warehouseId;
    if (!belongsByDefault) throw notEligible();
  }
  return { code: item.code, description: item.description, unit: item.unit };
}
