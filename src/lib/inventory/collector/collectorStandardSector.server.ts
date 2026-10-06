/**
 * Motor genérico do Collector para setores configuráveis (strategy = STANDARD).
 *
 * Irmão dos fluxos de Matéria-prima e de Componentes/Produto acabado — não os
 * generaliza nem os altera. O setor vem de InventoryStockSector, já resolvido e
 * validado em collectorSectorResolve.server.ts; aqui nada é específico de um
 * setor (nenhum código, slug ou itemType fixo).
 *
 * - Elegibilidade: InventoryItem ACTIVE + controlsStock + itemType do setor.
 *   Não exige materialId nem productId.
 * - Pertencimento: defaultWarehouseId = almoxarifado do setor, ou
 *   InventoryBalance já existente nesse almoxarifado (fato histórico já
 *   movimentado continua contável mesmo se o padrão do item mudou).
 * - Almoxarifado: fixo no setor. O cliente não escolhe.
 * - Não cria InventoryItem, InventoryBalance nem InventoryMovement, e não
 *   escreve saldo: só InventoryCountSession / InventoryCountLine. O saldo muda
 *   apenas pelo motor canônico (finalize → ajustes → movimento → saldo).
 * - Identidade da sessão: itemType + sessionCodePrefix do setor.
 */
import type { PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./../inventoryAudit.server.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import type {
  CollectorOperationalState,
  CollectorWarehouseSummary,
} from "./collectorSectorPrepare.server.js";
import { standardSectorStockControlledItemWhere } from "./collectorStandardEligibility.js";
import {
  assertCollectorCountingAllowed,
  COLLECTOR_COUNTING_DENIED,
  COLLECTOR_SECTOR_INACTIVE,
  type CollectorStandardSectorRef,
} from "./collectorSectorResolve.server.js";
import {
  COLLECTOR_LEGACY_SESSION_CODE_PREFIXES,
  collectorSessionCodePrefix,
  findCollectorStandardSectorActiveSession,
  lockCollectorWarehouseSessions,
} from "./collectorSessionCompatibility.server.js";

export { standardSectorStockControlledItemWhere };

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type ReadDb = PrismaClient | Tx;

export const COLLECTOR_STANDARD_NO_ELIGIBLE_ITEMS = "COLLECTOR_NO_ELIGIBLE_ITEMS";
export const COLLECTOR_STANDARD_WAREHOUSE_NOT_ELIGIBLE = "WAREHOUSE_NOT_ELIGIBLE";

/** Linhas por createMany — folga larga sob o limite de parâmetros do PostgreSQL. */
const COUNT_LINE_INSERT_CHUNK = 1000;

/**
 * O almoxarifado do setor é fixo. warehouseId vindo do cliente é opcional e só
 * é aceito quando coincide — nunca redireciona a operação.
 */
export function assertStandardSectorWarehouse(
  sector: Pick<CollectorStandardSectorRef, "warehouseId">,
  requestedWarehouseId: string | null | undefined
): string {
  const requested = String(requestedWarehouseId ?? "").trim();
  if (requested && requested !== sector.warehouseId) {
    throw new InventoryValidationError(
      "Almoxarifado não elegível para este setor.",
      COLLECTOR_STANDARD_WAREHOUSE_NOT_ELIGIBLE
    );
  }
  return sector.warehouseId;
}

/** Resumo do setor devolvido ao aparelho — capacidades decididas no servidor. */
export function serializeStandardSector(sector: CollectorStandardSectorRef) {
  return {
    code: sector.code,
    label: sector.label,
    slug: sector.slug,
    strategy: sector.strategy,
    itemType: sector.itemType,
    allowsCounting: sector.allowsCounting,
    allowsWithdrawal: sector.allowsWithdrawal,
  };
}

// ---------------------------------------------------------------------------
// Sementes de linha: 2 leituras em lote, sem consulta por item.
// ---------------------------------------------------------------------------

type StandardLineSeed = {
  itemId: string;
  locationId: string | null;
  /** Decimal do saldo (exato) ou 0 quando o item não tem saldo no almoxarifado. */
  systemQuantity: unknown;
};

async function loadStandardSectorLineSeeds(
  db: ReadDb,
  sector: Pick<CollectorStandardSectorRef, "itemType" | "warehouseId">
) {
  const where = standardSectorStockControlledItemWhere(sector);
  const [balanceRows, defaultItems] = await Promise.all([
    db.inventoryBalance.findMany({
      where: { warehouseId: sector.warehouseId, item: where },
      select: { itemId: true, locationId: true, physicalQuantity: true },
    }),
    db.inventoryItem.findMany({
      where: { ...where, defaultWarehouseId: sector.warehouseId },
      select: { id: true },
    }),
  ]);

  const seeds: StandardLineSeed[] = [];
  const seedKeys = new Set<string>();
  const balancesPerItem = new Map<string, number>();
  for (const balance of balanceRows) {
    const key = `${balance.itemId}|${balance.locationId ?? ""}`;
    if (seedKeys.has(key)) continue;
    seedKeys.add(key);
    balancesPerItem.set(balance.itemId, (balancesPerItem.get(balance.itemId) ?? 0) + 1);
    seeds.push({
      itemId: balance.itemId,
      locationId: balance.locationId,
      systemQuantity: balance.physicalQuantity,
    });
  }

  let itemsWithoutBalance = 0;
  for (const item of defaultItems) {
    // Já tem saldo neste almoxarifado: as linhas por endereço bastam.
    if (balancesPerItem.has(item.id)) continue;
    itemsWithoutBalance += 1;
    seeds.push({ itemId: item.id, locationId: null, systemQuantity: 0 });
  }

  return {
    seeds,
    balancesRead: balanceRows.length,
    itemsWithBalance: balancesPerItem.size,
    itemsWithoutBalance,
    itemsWithMultipleLocations: [...balancesPerItem.values()].filter((n) => n > 1).length,
  };
}

// ---------------------------------------------------------------------------
// Contexto operacional (GET context).
// ---------------------------------------------------------------------------

export type CollectorStandardSectorContextDiagnostics = {
  sector: string;
  strategy: "STANDARD";
  itemType: string;
  warehouseId: string;
  itemsEligibleInWarehouse: number;
  itemsWithBalance: number;
  itemsWithoutBalance: number;
};

export async function resolveCollectorStandardSectorOperationalContext(
  prisma: PrismaClient,
  sector: CollectorStandardSectorRef
): Promise<{
  warehouses: CollectorWarehouseSummary[];
  operationalState: CollectorOperationalState;
  diagnostics: CollectorStandardSectorContextDiagnostics;
}> {
  const loaded = await loadStandardSectorLineSeeds(prisma, sector);
  const itemsEligibleInWarehouse = loaded.itemsWithBalance + loaded.itemsWithoutBalance;
  return {
    warehouses: [
      { id: sector.warehouse.id, code: sector.warehouse.code, name: sector.warehouse.name },
    ],
    operationalState: itemsEligibleInWarehouse > 0 ? "READY" : "NO_ELIGIBLE_ITEMS",
    diagnostics: {
      sector: sector.code,
      strategy: "STANDARD",
      itemType: sector.itemType,
      warehouseId: sector.warehouseId,
      itemsEligibleInWarehouse,
      itemsWithBalance: loaded.itemsWithBalance,
      itemsWithoutBalance: loaded.itemsWithoutBalance,
    },
  };
}

// ---------------------------------------------------------------------------
// População: uma linha por InventoryBalance (item × endereço) do almoxarifado +
// uma linha (sem endereço, saldo 0) por item só com almoxarifado padrão.
// 1 count + 2 leituras + createMany em blocos. Nunca cria saldo nem movimento.
// ---------------------------------------------------------------------------

export type CollectorStandardSectorPopulationDiagnostics = {
  sector: string;
  itemType: string;
  warehouseId: string;
  itemsEligibleInWarehouse: number;
  itemsWithBalance: number;
  itemsWithoutBalance: number;
  /** Itens com saldo em mais de um endereço — uma linha por endereço. */
  itemsWithMultipleLocations: number;
  balancesRead: number;
  linesCreated: number;
  existingLines: number;
  skippedExistingLines: boolean;
};

/** Idempotente: sessão que já tem linhas não é repopulada nem duplicada. */
export async function populateStandardSectorCountLines(
  tx: Tx,
  input: {
    sessionId: string;
    sector: Pick<CollectorStandardSectorRef, "code" | "itemType" | "warehouseId">;
    /** Opcional; quando informado precisa ser o almoxarifado do setor. */
    warehouseId?: string | null;
  }
): Promise<CollectorStandardSectorPopulationDiagnostics> {
  const warehouseId = assertStandardSectorWarehouse(input.sector, input.warehouseId);
  const empty = {
    sector: input.sector.code,
    itemType: input.sector.itemType,
    warehouseId,
    itemsEligibleInWarehouse: 0,
    itemsWithBalance: 0,
    itemsWithoutBalance: 0,
    itemsWithMultipleLocations: 0,
    balancesRead: 0,
    linesCreated: 0,
  };
  const existingLines = await tx.inventoryCountLine.count({
    where: { sessionId: input.sessionId },
  });
  if (existingLines > 0) {
    return { ...empty, existingLines, skippedExistingLines: true };
  }

  const loaded = await loadStandardSectorLineSeeds(tx, input.sector);
  for (let start = 0; start < loaded.seeds.length; start += COUNT_LINE_INSERT_CHUNK) {
    await tx.inventoryCountLine.createMany({
      data: loaded.seeds.slice(start, start + COUNT_LINE_INSERT_CHUNK).map((seed) => ({
        sessionId: input.sessionId,
        itemId: seed.itemId,
        warehouseId,
        locationId: seed.locationId,
        systemQuantity: seed.systemQuantity as number,
      })),
    });
  }

  return {
    ...empty,
    itemsEligibleInWarehouse: loaded.itemsWithBalance + loaded.itemsWithoutBalance,
    itemsWithBalance: loaded.itemsWithBalance,
    itemsWithoutBalance: loaded.itemsWithoutBalance,
    itemsWithMultipleLocations: loaded.itemsWithMultipleLocations,
    balancesRead: loaded.balancesRead,
    linesCreated: loaded.seeds.length,
    existingLines: 0,
    skippedExistingLines: false,
  };
}

// ---------------------------------------------------------------------------
// Sessão: identidade = itemType + sessionCodePrefix do setor.
// ---------------------------------------------------------------------------

/** Prefixos dos demais setores configurados — 1 consulta. */
async function loadOtherStandardSectorPrefixes(
  db: ReadDb,
  sector: Pick<CollectorStandardSectorRef, "sectorId">
): Promise<string[]> {
  const rows = await db.inventoryStockSector.findMany({
    where: { id: { not: sector.sectorId } },
    select: { sessionCodePrefix: true },
  });
  return rows.map((row) => row.sessionCodePrefix);
}

/**
 * COUNTING que o setor pode continuar no seu almoxarifado — ou null. Avalia
 * todas as COUNTING: qualquer incompatível → COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE.
 */
export async function findStandardSectorActiveSession(
  db: ReadDb,
  sector: CollectorStandardSectorRef
) {
  const knownSectorPrefixes = await loadOtherStandardSectorPrefixes(db, sector);
  return findCollectorStandardSectorActiveSession(db, {
    label: sector.label,
    expectedItemType: sector.itemType,
    expectedSessionCodePrefix: sector.sessionCodePrefix,
    knownSectorPrefixes,
    warehouseId: sector.warehouseId,
  });
}

async function generateStandardSectorSessionCode(
  tx: Tx,
  sector: Pick<CollectorStandardSectorRef, "sessionCodePrefix">
): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${sector.sessionCodePrefix}-${datePart}`;
  const existing = await tx.inventoryCountSession.count({
    where: { code: { startsWith: `${prefix}-` } },
  });
  return `${prefix}-${String(existing + 1).padStart(3, "0")}`;
}

function noEligibleItemsError(sector: Pick<CollectorStandardSectorRef, "label">) {
  return new InventoryValidationError(
    `Nenhum item elegível para contagem no setor ${sector.label}.`,
    COLLECTOR_STANDARD_NO_ELIGIBLE_ITEMS
  );
}

export type CollectorStandardSectorSessionResult = {
  session: {
    id: string;
    code: string;
    status: string;
    warehouseId: string;
    startedAt: Date | null;
  };
  sector: ReturnType<typeof serializeStandardSector>;
  diagnostics: CollectorStandardSectorPopulationDiagnostics;
  reused: boolean;
};

/**
 * Continua a COUNTING compatível do almoxarifado do setor ou abre uma nova
 * (<prefixo>-AAAAMMDD-NNN). O advisory lock por almoxarifado serializa dois
 * toques simultâneos. Zero linhas → erro e rollback: nunca sobra sessão vazia.
 */
export async function createAndStartCollectorStandardSectorSession(
  prisma: PrismaClient,
  input: {
    sector: CollectorStandardSectorRef;
    warehouseId?: string | null;
    deviceId: string;
    deviceName?: string | null;
    operationId?: string | null;
  }
): Promise<CollectorStandardSectorSessionResult> {
  const sector = input.sector;
  assertCollectorCountingAllowed(sector);
  const warehouseId = assertStandardSectorWarehouse(sector, input.warehouseId);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockCollectorWarehouseSessions(tx, warehouseId);
    const active = await findStandardSectorActiveSession(tx, sector);
    if (active) {
      // Compatível: com linhas só continua; vazia (prefixo do setor) é populada.
      const diagnostics = await populateStandardSectorCountLines(tx, {
        sessionId: active.id,
        sector,
      });
      if (!diagnostics.skippedExistingLines && diagnostics.linesCreated === 0) {
        throw noEligibleItemsError(sector);
      }
      return { session: active, diagnostics, reused: true };
    }

    const code = await generateStandardSectorSessionCode(tx, sector);
    const session = await tx.inventoryCountSession.create({
      data: {
        code,
        warehouseId,
        status: "COUNTING",
        responsibleUserId: null,
        startedAt: new Date(),
        notes: input.operationId
          ? `Collector sector ${sector.code}; operationId=${input.operationId}`
          : `Collector sector ${sector.code}`,
      },
    });
    const diagnostics = await populateStandardSectorCountLines(tx, {
      sessionId: session.id,
      sector,
    });
    if (diagnostics.linesCreated === 0) {
      throw noEligibleItemsError(sector);
    }
    return { session, diagnostics, reused: false };
  });

  const { session, diagnostics, reused } = outcome;
  const lines =
    reused && diagnostics.skippedExistingLines
      ? diagnostics.existingLines
      : diagnostics.linesCreated;
  const auditBase = {
    code: session.code,
    warehouseId: session.warehouseId,
    sector: sector.code,
    sectorId: sector.sectorId,
    strategy: sector.strategy,
    deviceId: input.deviceId,
  };

  // Auditoria após o commit: sessão revertida não deixa rastro de criação.
  if (reused) {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_REUSED",
      afterJson: { ...auditBase, lines, linesCreated: diagnostics.linesCreated, reused: true },
      userId: null,
      userName: input.deviceName ?? null,
    });
  } else {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_CREATED",
      afterJson: { ...auditBase, reused: false, diagnostics },
      userId: null,
      userName: input.deviceName ?? null,
    });
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_STARTED",
      afterJson: { ...auditBase, status: "COUNTING", lines },
      userId: null,
      userName: input.deviceName ?? null,
    });
  }

  return {
    session: {
      id: session.id,
      code: session.code,
      status: session.status,
      warehouseId: session.warehouseId,
      startedAt: session.startedAt,
    },
    sector: serializeStandardSector(sector),
    diagnostics,
    reused,
  };
}

// ---------------------------------------------------------------------------
// Capacidade de contagem por sessão (contar / finalizar / aplicar ajustes).
//
// Essas rotas recebem só o sessionId. O setor é reconhecido pelo prefixo do
// código: legado (MP/CP/PA) e códigos fora do formato Collector saem sem
// consultar nada; prefixo de InventoryStockSector que não permite contagem (ou
// está inativo) bloqueia no servidor — não basta a tela esconder o botão.
// ---------------------------------------------------------------------------

type SessionCapabilityDb = {
  inventoryCountSession: { findUnique: (args: any) => Promise<{ code: string } | null> };
  inventoryStockSector?: {
    findUnique: (
      args: any
    ) => Promise<{ status: string; allowsCounting: boolean } | null>;
  };
};

export async function assertCollectorSessionCountingAllowed(
  db: SessionCapabilityDb,
  sessionId: string
): Promise<void> {
  const session = await db.inventoryCountSession.findUnique({
    where: { id: sessionId },
    select: { code: true },
  });
  // Sessão inexistente: o motor de contagem responde SESSION_NOT_FOUND.
  if (!session) return;
  const prefix = collectorSessionCodePrefix(session.code);
  if (!prefix || COLLECTOR_LEGACY_SESSION_CODE_PREFIXES.has(prefix)) return;
  // Prisma falso de teste sem o modelo: não há setor configurável a consultar.
  if (typeof db.inventoryStockSector?.findUnique !== "function") return;
  const sector = await db.inventoryStockSector.findUnique({
    where: { sessionCodePrefix: prefix },
    select: { status: true, allowsCounting: true },
  });
  if (!sector) return;
  if (sector.status !== "ACTIVE") {
    throw new InventoryValidationError("Setor de estoque inativo.", COLLECTOR_SECTOR_INACTIVE);
  }
  if (!sector.allowsCounting) {
    throw new InventoryValidationError(
      "Este setor não permite contagem.",
      COLLECTOR_COUNTING_DENIED
    );
  }
}

// ---------------------------------------------------------------------------
// Centro de custo dos ajustes negativos de uma conferência.
//
// Saída de alguns tipos de item (inclusive NEGATIVE_ADJUSTMENT) exige centro de
// custo no motor de movimentos. Quem o informa é a configuração do setor dono
// da conferência, reconhecido pelo prefixo do código. Legado (MP/CP/PA) e
// códigos fora do formato Collector saem sem consultar nada.
// ---------------------------------------------------------------------------

type SectorCostCenterDb = {
  inventoryStockSector?: {
    findUnique: (args: any) => Promise<{ defaultCostCenterId: string | null } | null>;
  };
};

export async function resolveCountSessionAdjustmentCostCenterId(
  db: SectorCostCenterDb,
  sessionCode: string | null | undefined
): Promise<string | null> {
  const prefix = collectorSessionCodePrefix(sessionCode);
  if (!prefix || COLLECTOR_LEGACY_SESSION_CODE_PREFIXES.has(prefix)) return null;
  if (typeof db.inventoryStockSector?.findUnique !== "function") return null;
  const sector = await db.inventoryStockSector.findUnique({
    where: { sessionCodePrefix: prefix },
    select: { defaultCostCenterId: true },
  });
  return sector?.defaultCostCenterId ?? null;
}
