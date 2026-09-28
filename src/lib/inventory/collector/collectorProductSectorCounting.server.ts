/**
 * Contagem Collector dos setores Componentes (COMPONENT) e Produto acabado
 * (FINISHED_PRODUCT).
 *
 * Irmão do fluxo de Matéria-prima — não o generaliza nem o altera. Identidade:
 * Product → productId → InventoryItem.itemType; nunca materialId.
 *
 * - Não cria Product, Material, BOM, InventoryItem nem InventoryBalance: só
 *   conta InventoryItem já existente (ACTIVE, itemType do setor, productId,
 *   controlsStock).
 * - Almoxarifado só por presença logística: InventoryBalance de item elegível
 *   no almoxarifado ou item elegível com defaultWarehouseId nele. Sem fallback
 *   para todos os almoxarifados ACTIVE e sem código de almoxarifado fixo.
 * - Saldo sistêmico da linha = InventoryBalance.physicalQuantity (exato); item
 *   só com almoxarifado padrão entra com 0 — o motor canônico trata ausência de
 *   saldo como physicalQuantity 0. Nada aqui cria ou atualiza saldo.
 * - Ajustes: motor canônico (finalize → generateInventoryCountAdjustments →
 *   InventoryMovement → InventoryBalance), o mesmo da Matéria-prima.
 */
import type { PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./../inventoryAudit.server.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import { COLLECTOR_NO_WAREHOUSE_FOR_SECTOR } from "./collectorAutonomousSession.server.js";
import { COLLECTOR_SECTORS, type CollectorSectorCode } from "./collectorSectorContract.js";
import {
  COMPONENT_STOCK_CONTROLLED_ITEM_WHERE,
  FINISHED_PRODUCT_STOCK_CONTROLLED_ITEM_WHERE,
} from "./collectorSectorEligibility.js";
import type {
  CollectorOperationalState,
  CollectorWarehouseSummary,
} from "./collectorSectorPrepare.server.js";
import {
  findCollectorSectorActiveSession,
  lockCollectorWarehouseSessions,
} from "./collectorSessionCompatibility.server.js";

export type CollectorProductSectorCode = "COMPONENT" | "FINISHED_PRODUCT";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const PRODUCT_SECTOR_NOUN: Record<CollectorProductSectorCode, { singular: string; plural: string }> = {
  COMPONENT: { singular: "componente", plural: "componentes" },
  FINISHED_PRODUCT: { singular: "produto acabado", plural: "produtos acabados" },
};

export function isCollectorProductSector(
  sector: CollectorSectorCode
): sector is CollectorProductSectorCode {
  return sector === "COMPONENT" || sector === "FINISHED_PRODUCT";
}

/** Predicado do item elegível do setor (ACTIVE + itemType + productId + controlsStock). */
export function productSectorStockControlledItemWhere(sector: CollectorProductSectorCode) {
  return sector === "COMPONENT"
    ? COMPONENT_STOCK_CONTROLLED_ITEM_WHERE
    : FINISHED_PRODUCT_STOCK_CONTROLLED_ITEM_WHERE;
}

function assertProductSector(
  actual: CollectorSectorCode | undefined,
  expected: CollectorProductSectorCode,
  step: "preparação" | "população"
): void {
  if ((actual ?? expected) !== expected) {
    throw new InventoryValidationError(`Setor de ${step} não suportado.`, "COLLECTOR_INVALID_SECTOR");
  }
}

function sortWarehouses(list: CollectorWarehouseSummary[]): CollectorWarehouseSummary[] {
  return [...list].sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));
}

export function collectorProductSectorNoWarehouseMessage(sector: CollectorProductSectorCode): string {
  return `Nenhum almoxarifado com ${PRODUCT_SECTOR_NOUN[sector].plural} elegíveis (saldo ou almoxarifado padrão). Verifique o estoque.`;
}

// ---------------------------------------------------------------------------
// Contexto operacional (GET context): almoxarifados por presença logística.
// ---------------------------------------------------------------------------

export type CollectorProductSectorContextDiagnostics = {
  sector: CollectorProductSectorCode;
  activeWarehouses: number;
  warehousesWithPresence: number;
  /** InventoryItem do itemType do setor, qualquer status. */
  itemsTotal: number;
  /** ACTIVE + itemType + productId + controlsStock. */
  itemsEligible: number;
  /** Elegíveis com InventoryBalance em almoxarifado ACTIVE. */
  itemsWithBalance: number;
  /** Elegíveis sem InventoryBalance em almoxarifado ACTIVE. */
  itemsWithoutBalance: number;
  /** Elegíveis sem saldo e sem almoxarifado padrão ACTIVE — invisíveis ao Collector. */
  itemsWithoutPresence: number;
};

export type CollectorProductSectorContextResolution = {
  warehouses: CollectorWarehouseSummary[];
  operationalState: CollectorOperationalState;
  diagnostics: CollectorProductSectorContextDiagnostics;
};

/**
 * 1 almoxarifado com presença → READY; mais de 1 → NEEDS_WAREHOUSE_SELECTION;
 * nenhum → CONFIGURATION_REQUIRED. Sem fallback para todos os ACTIVE.
 */
export async function resolveCollectorProductSectorOperationalContext(
  prisma: PrismaClient,
  sector: CollectorSectorCode
): Promise<CollectorProductSectorContextResolution> {
  if (!isCollectorProductSector(sector)) {
    throw new InventoryValidationError(
      "Setor de contagem não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }
  const where = productSectorStockControlledItemWhere(sector);

  const [activeWarehouses, balanceRows, defaultRows, itemsTotal, itemsEligible] =
    await Promise.all([
      prisma.inventoryWarehouse.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, code: true, name: true },
      }),
      prisma.inventoryBalance.findMany({
        where: { item: where, warehouse: { status: "ACTIVE" } },
        select: { itemId: true, warehouseId: true },
        distinct: ["itemId", "warehouseId"],
      }),
      prisma.inventoryItem.findMany({
        where: {
          ...where,
          defaultWarehouseId: { not: null },
          defaultWarehouse: { status: "ACTIVE" },
        },
        select: { id: true, defaultWarehouseId: true },
      }),
      prisma.inventoryItem.count({ where: { itemType: sector } }),
      prisma.inventoryItem.count({ where }),
    ]);

  const activeById = new Map(activeWarehouses.map((warehouse) => [warehouse.id, warehouse]));
  const presenceIds = new Set<string>();
  const itemsWithBalance = new Set<string>();
  const itemsWithPresence = new Set<string>();
  for (const row of balanceRows) {
    presenceIds.add(row.warehouseId);
    itemsWithBalance.add(row.itemId);
    itemsWithPresence.add(row.itemId);
  }
  for (const row of defaultRows) {
    if (!row.defaultWarehouseId) continue;
    presenceIds.add(row.defaultWarehouseId);
    itemsWithPresence.add(row.id);
  }

  const warehouses = sortWarehouses(
    [...presenceIds]
      .map((id) => activeById.get(id))
      .filter((warehouse): warehouse is CollectorWarehouseSummary => warehouse != null)
  );
  const operationalState: CollectorOperationalState =
    warehouses.length === 0
      ? "CONFIGURATION_REQUIRED"
      : warehouses.length === 1
        ? "READY"
        : "NEEDS_WAREHOUSE_SELECTION";

  return {
    warehouses,
    operationalState,
    diagnostics: {
      sector,
      activeWarehouses: activeWarehouses.length,
      warehousesWithPresence: warehouses.length,
      itemsTotal,
      itemsEligible,
      itemsWithBalance: itemsWithBalance.size,
      itemsWithoutBalance: Math.max(0, itemsEligible - itemsWithBalance.size),
      itemsWithoutPresence: Math.max(0, itemsEligible - itemsWithPresence.size),
    },
  };
}

/** Almoxarifados do setor; lança COLLECTOR_NO_WAREHOUSE_FOR_SECTOR se exigida e vazia. */
export async function resolveCollectorProductSectorWarehouses(
  prisma: PrismaClient,
  sector: CollectorProductSectorCode,
  opts?: { requireNonEmpty?: boolean }
): Promise<CollectorWarehouseSummary[]> {
  const resolved = await resolveCollectorProductSectorOperationalContext(prisma, sector);
  if (opts?.requireNonEmpty !== false && resolved.warehouses.length === 0) {
    throw new InventoryValidationError(
      collectorProductSectorNoWarehouseMessage(sector),
      COLLECTOR_NO_WAREHOUSE_FOR_SECTOR
    );
  }
  return resolved.warehouses;
}

// ---------------------------------------------------------------------------
// Preparação: só leitura + diagnóstico. Nada é criado (item, produto, saldo).
// ---------------------------------------------------------------------------

export type CollectorProductSectorPrepareDiagnostics = {
  sector: CollectorProductSectorCode;
  warehouseId: string;
  itemsTotal: number;
  itemsEligible: number;
  /** ACTIVE do itemType sem productId — fora do Collector de produto. */
  itemsWithoutProductId: number;
  /** ACTIVE do itemType com productId, mas sem controle de estoque. */
  itemsWithoutStockControl: number;
};

type ProductSectorPrepareInput = {
  warehouseId: string;
  deviceId: string;
  deviceName?: string | null;
  sector?: CollectorSectorCode;
};

async function prepareProductSectorForCounting(
  prisma: PrismaClient,
  sector: CollectorProductSectorCode,
  input: ProductSectorPrepareInput
): Promise<CollectorProductSectorPrepareDiagnostics> {
  const warehouse = await prisma.inventoryWarehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, status: true, code: true },
  });
  if (!warehouse) {
    throw new InventoryValidationError("Almoxarifado não encontrado.", "WAREHOUSE_NOT_FOUND");
  }
  if (warehouse.status !== "ACTIVE") {
    throw new InventoryValidationError("Almoxarifado precisa estar ativo.", "WAREHOUSE_INACTIVE");
  }

  const [itemsTotal, itemsEligible, itemsWithoutProductId, itemsWithoutStockControl] =
    await Promise.all([
      prisma.inventoryItem.count({ where: { itemType: sector } }),
      prisma.inventoryItem.count({ where: productSectorStockControlledItemWhere(sector) }),
      prisma.inventoryItem.count({
        where: { status: "ACTIVE", itemType: sector, productId: null },
      }),
      prisma.inventoryItem.count({
        where: {
          status: "ACTIVE",
          itemType: sector,
          productId: { not: null },
          controlsStock: false,
        },
      }),
    ]);

  const diagnostics: CollectorProductSectorPrepareDiagnostics = {
    sector,
    warehouseId: input.warehouseId,
    itemsTotal,
    itemsEligible,
    itemsWithoutProductId,
    itemsWithoutStockControl,
  };

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryWarehouse",
    entityId: input.warehouseId,
    action: "COLLECTOR_SECTOR_PREPARED",
    afterJson: {
      ...diagnostics,
      warehouseCode: warehouse.code,
      readOnly: true,
      deviceId: input.deviceId,
    },
    userId: null,
    userName: input.deviceName ?? null,
  });

  return diagnostics;
}

export async function prepareComponentSectorForCounting(
  prisma: PrismaClient,
  input: ProductSectorPrepareInput
): Promise<CollectorProductSectorPrepareDiagnostics> {
  assertProductSector(input.sector, "COMPONENT", "preparação");
  return prepareProductSectorForCounting(prisma, "COMPONENT", input);
}

export async function prepareFinishedProductSectorForCounting(
  prisma: PrismaClient,
  input: ProductSectorPrepareInput
): Promise<CollectorProductSectorPrepareDiagnostics> {
  assertProductSector(input.sector, "FINISHED_PRODUCT", "preparação");
  return prepareProductSectorForCounting(prisma, "FINISHED_PRODUCT", input);
}

// ---------------------------------------------------------------------------
// População: uma linha por InventoryBalance (item × endereço) do almoxarifado +
// uma linha (endereço vazio, saldo 0) por item só com almoxarifado padrão.
// Lote: 2 leituras + 1 createMany. Nunca cria saldo, nunca duplica linha.
// ---------------------------------------------------------------------------

export type CollectorProductSectorPopulationDiagnostics = {
  sector: CollectorProductSectorCode;
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

type ProductSectorPopulateInput = {
  sessionId: string;
  warehouseId: string;
  sector: CollectorSectorCode;
};

async function populateProductSectorCountLines(
  tx: Tx,
  sector: CollectorProductSectorCode,
  input: ProductSectorPopulateInput
): Promise<CollectorProductSectorPopulationDiagnostics> {
  const empty = {
    sector,
    warehouseId: input.warehouseId,
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

  const where = productSectorStockControlledItemWhere(sector);
  const [balanceRows, defaultItems] = await Promise.all([
    tx.inventoryBalance.findMany({
      where: { warehouseId: input.warehouseId, item: where },
      select: { itemId: true, locationId: true, physicalQuantity: true },
    }),
    tx.inventoryItem.findMany({
      where: { ...where, defaultWarehouseId: input.warehouseId },
      select: { id: true },
    }),
  ]);

  type LineSeed = {
    itemId: string;
    locationId: string | null;
    systemQuantity: (typeof balanceRows)[number]["physicalQuantity"] | number;
  };
  const seeds: LineSeed[] = [];
  const seedKeys = new Set<string>();
  const pushSeed = (seed: LineSeed) => {
    const key = `${seed.itemId}|${seed.locationId ?? ""}`;
    if (seedKeys.has(key)) return;
    seedKeys.add(key);
    seeds.push(seed);
  };

  const balancesPerItem = new Map<string, number>();
  for (const balance of balanceRows) {
    balancesPerItem.set(balance.itemId, (balancesPerItem.get(balance.itemId) ?? 0) + 1);
    pushSeed({
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
    pushSeed({ itemId: item.id, locationId: null, systemQuantity: 0 });
  }

  if (seeds.length > 0) {
    await tx.inventoryCountLine.createMany({
      data: seeds.map((seed) => ({
        sessionId: input.sessionId,
        itemId: seed.itemId,
        warehouseId: input.warehouseId,
        locationId: seed.locationId,
        systemQuantity: seed.systemQuantity,
      })),
    });
  }

  return {
    ...empty,
    itemsEligibleInWarehouse: balancesPerItem.size + itemsWithoutBalance,
    itemsWithBalance: balancesPerItem.size,
    itemsWithoutBalance,
    itemsWithMultipleLocations: [...balancesPerItem.values()].filter((n) => n > 1).length,
    balancesRead: balanceRows.length,
    linesCreated: seeds.length,
    existingLines: 0,
    skippedExistingLines: false,
  };
}

export async function populateComponentCountLines(
  tx: Tx,
  input: ProductSectorPopulateInput
): Promise<CollectorProductSectorPopulationDiagnostics> {
  assertProductSector(input.sector, "COMPONENT", "população");
  return populateProductSectorCountLines(tx, "COMPONENT", input);
}

export async function populateFinishedProductCountLines(
  tx: Tx,
  input: ProductSectorPopulateInput
): Promise<CollectorProductSectorPopulationDiagnostics> {
  assertProductSector(input.sector, "FINISHED_PRODUCT", "população");
  return populateProductSectorCountLines(tx, "FINISHED_PRODUCT", input);
}

// ---------------------------------------------------------------------------
// Criar / continuar conferência COUNTING do setor (DEVICE).
// ---------------------------------------------------------------------------

export type CollectorProductSectorSessionResult = {
  session: {
    id: string;
    code: string;
    status: string;
    warehouseId: string;
    startedAt: Date | null;
  };
  diagnostics: CollectorProductSectorPopulationDiagnostics;
  prepare: CollectorProductSectorPrepareDiagnostics;
  reused: boolean;
};

async function generateProductSectorSessionCode(
  tx: Tx,
  sector: CollectorProductSectorCode
): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${COLLECTOR_SECTORS[sector].sessionCodePrefix}-${datePart}`;
  const existing = await tx.inventoryCountSession.count({
    where: { code: { startsWith: prefix } },
  });
  return `${prefix}-${String(existing + 1).padStart(3, "0")}`;
}

function noLinesError(
  sector: CollectorProductSectorCode,
  prepare: CollectorProductSectorPrepareDiagnostics
): InventoryValidationError {
  const noun = PRODUCT_SECTOR_NOUN[sector].singular;
  return prepare.itemsEligible === 0
    ? new InventoryValidationError(
        `Nenhum ${noun} elegível para inventário neste setor.`,
        "COLLECTOR_NO_ELIGIBLE_ITEMS"
      )
    : new InventoryValidationError(
        `Nenhum ${noun} com saldo ou almoxarifado padrão neste almoxarifado.`,
        "COLLECTOR_NO_LINES"
      );
}

/**
 * Continua a COUNTING compatível do almoxarifado ou abre uma nova (CP-/PA-).
 *
 * Todas as COUNTING do almoxarifado são avaliadas: qualquer uma incompatível
 * (linhas de outro itemType, prefixo de outro setor, vazia sem prefixo do
 * setor) → COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE, sem abrir sessão concorrente.
 * O advisory lock por almoxarifado serializa dois toques simultâneos.
 * Zero linhas → erro e rollback: nunca sobra sessão vazia criada aqui.
 */
export async function createAndStartCollectorProductSectorSession(
  prisma: PrismaClient,
  input: {
    sector: CollectorProductSectorCode;
    warehouseId: string;
    deviceId: string;
    deviceName?: string | null;
    operationId?: string | null;
  }
): Promise<CollectorProductSectorSessionResult> {
  if (!isCollectorProductSector(input.sector)) {
    throw new InventoryValidationError(
      "Setor de contagem não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }
  const sector = input.sector;
  const warehouse = await prisma.inventoryWarehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, status: true },
  });
  if (!warehouse || warehouse.status !== "ACTIVE") {
    throw new InventoryValidationError(
      "Almoxarifado não elegível para este setor.",
      "WAREHOUSE_NOT_ELIGIBLE"
    );
  }

  const prepareInput = {
    warehouseId: input.warehouseId,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    sector,
  };
  const prepare =
    sector === "COMPONENT"
      ? await prepareComponentSectorForCounting(prisma, prepareInput)
      : await prepareFinishedProductSectorForCounting(prisma, prepareInput);
  const populate =
    sector === "COMPONENT" ? populateComponentCountLines : populateFinishedProductCountLines;

  const outcome = await prisma.$transaction(async (tx) => {
    await lockCollectorWarehouseSessions(tx, input.warehouseId);
    const active = await findCollectorSectorActiveSession(tx, {
      sector,
      warehouseId: input.warehouseId,
      scope: "all",
    });
    if (active) {
      // Compatível: com linhas só continua; vazia (prefixo do setor) é populada.
      const diagnostics = await populate(tx, {
        sessionId: active.id,
        warehouseId: input.warehouseId,
        sector,
      });
      if (!diagnostics.skippedExistingLines && diagnostics.linesCreated === 0) {
        throw noLinesError(sector, prepare);
      }
      return { session: active, diagnostics, reused: true };
    }

    const code = await generateProductSectorSessionCode(tx, sector);
    const session = await tx.inventoryCountSession.create({
      data: {
        code,
        warehouseId: input.warehouseId,
        status: "COUNTING",
        responsibleUserId: null,
        startedAt: new Date(),
        notes: input.operationId
          ? `Collector sector ${sector}; operationId=${input.operationId}`
          : `Collector sector ${sector}`,
      },
    });
    const diagnostics = await populate(tx, {
      sessionId: session.id,
      warehouseId: input.warehouseId,
      sector,
    });
    if (diagnostics.linesCreated === 0) {
      throw noLinesError(sector, prepare);
    }
    return { session, diagnostics, reused: false };
  });

  const { session, diagnostics, reused } = outcome;
  const lines = reused && diagnostics.skippedExistingLines
    ? diagnostics.existingLines
    : diagnostics.linesCreated;

  // Auditoria após o commit: sessão revertida não deixa rastro de criação.
  if (reused) {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_REUSED",
      afterJson: {
        code: session.code,
        warehouseId: session.warehouseId,
        sector,
        deviceId: input.deviceId,
        lines,
        linesCreated: diagnostics.linesCreated,
        reused: true,
      },
      userId: null,
    });
  } else {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_CREATED",
      afterJson: {
        code: session.code,
        warehouseId: session.warehouseId,
        sector,
        deviceId: input.deviceId,
        reused: false,
        diagnostics,
        prepare,
      },
      userId: null,
    });
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_STARTED",
      afterJson: {
        status: "COUNTING",
        lines,
        deviceId: input.deviceId,
        sector,
      },
      userId: null,
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
    diagnostics,
    prepare,
    reused,
  };
}
