/**
 * Sessão autônoma do Collector por setor (DEVICE).
 *
 * Cria/continua conferência COUNTING sem usuário humano falso; popula linhas
 * via population service; lista cega; finaliza com auto-justificativa DEVICE;
 * aplica ajustes via motor canônico.
 */
import type { PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./../inventoryAudit.server.js";
import {
  approveInventoryCountSession,
  finalizeInventoryCountSession,
  generateInventoryCountAdjustments,
  type CountSessionContext,
} from "./../inventoryCountService.server.js";
import {
  hasEffectiveCountDivergence,
  requiresCountJustification,
  resolveCountAdjustmentBasis,
} from "./../inventoryCountObservation.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  COLLECTOR_SECTORS,
  type CollectorSectorCode,
} from "./collectorSectorContract.js";
import {
  populateRawMaterialCountLines,
  type CollectorSectorPopulationDiagnostics,
} from "./collectorSectorPopulation.server.js";

export const COLLECTOR_NO_WAREHOUSE_FOR_SECTOR = "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR";
export const COLLECTOR_PENDING_ITEMS = "PENDING_ITEMS";
export const COLLECTOR_DEVICE_JUSTIFICATION = "Contagem física Collector";

export type CollectorWarehouseSummary = {
  id: string;
  code: string;
  name: string;
};

export type CollectorBlindItem = {
  lineId: string;
  itemId: string;
  code: string;
  description: string;
  unit: string;
  counted: boolean;
  countedQuantity: number | null;
  version: number;
  status: "pending" | "counted";
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
};

export type CollectorSessionProgress = {
  sessionId: string;
  code: string;
  status: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  totalLines: number;
  countedLines: number;
  pendingLines: number;
};

export type CollectorSessionDivergence = {
  lineId: string;
  itemId: string;
  code: string;
  description: string;
  unit: string;
  countedQuantity: number;
  expectedQuantity: number;
  adjustmentDelta: number;
  justification: string | null;
};

function deviceContext(deviceId: string): CountSessionContext {
  return {
    userId: null,
    deviceId,
    actorType: "DEVICE",
  };
}

async function generateMpSessionCode(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  sector: CollectorSectorCode
): Promise<string> {
  const prefixBase = COLLECTOR_SECTORS[sector].sessionCodePrefix;
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${prefixBase}-${datePart}`;
  const existing = await tx.inventoryCountSession.count({
    where: { code: { startsWith: prefix } },
  });
  return `${prefix}-${String(existing + 1).padStart(3, "0")}`;
}

/**
 * Almoxarifados ACTIVE com saldo RAW_MATERIAL ou itens defaultWarehouse do setor.
 */
export async function resolveWarehousesForSector(
  prisma: PrismaClient,
  sector: CollectorSectorCode
): Promise<CollectorWarehouseSummary[]> {
  if (sector !== "RAW_MATERIAL") {
    throw new InventoryValidationError(
      "Setor de contagem não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }

  const [balanceWarehouses, defaultWarehouses] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: {
        item: {
          status: "ACTIVE",
          itemType: "RAW_MATERIAL",
          materialId: { not: null },
        },
        warehouse: { status: "ACTIVE" },
      },
      select: {
        warehouse: { select: { id: true, code: true, name: true } },
      },
      distinct: ["warehouseId"],
    }),
    prisma.inventoryItem.findMany({
      where: {
        status: "ACTIVE",
        itemType: "RAW_MATERIAL",
        materialId: { not: null },
        defaultWarehouseId: { not: null },
        defaultWarehouse: { status: "ACTIVE" },
      },
      select: {
        defaultWarehouse: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  const byId = new Map<string, CollectorWarehouseSummary>();
  for (const row of balanceWarehouses) {
    if (row.warehouse) byId.set(row.warehouse.id, row.warehouse);
  }
  for (const row of defaultWarehouses) {
    if (row.defaultWarehouse) byId.set(row.defaultWarehouse.id, row.defaultWarehouse);
  }

  const list = [...byId.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "pt-BR")
  );
  if (list.length === 0) {
    throw new InventoryValidationError(
      "Nenhum almoxarifado ativo com matéria-prima logística para contagem.",
      COLLECTOR_NO_WAREHOUSE_FOR_SECTOR
    );
  }
  return list;
}

export async function findActiveCountingSession(
  prisma: PrismaClient,
  warehouseId: string
) {
  return prisma.inventoryCountSession.findFirst({
    where: { warehouseId, status: "COUNTING" },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      lines: { select: { countedQuantity: true } },
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function createAndStartCollectorSectorSession(
  prisma: PrismaClient,
  input: {
    sector: CollectorSectorCode;
    warehouseId: string;
    deviceId: string;
    operationId?: string | null;
  }
): Promise<{
  session: {
    id: string;
    code: string;
    status: string;
    warehouseId: string;
    startedAt: Date | null;
  };
  diagnostics: CollectorSectorPopulationDiagnostics;
  reused: boolean;
}> {
  const warehouses = await resolveWarehousesForSector(prisma, input.sector);
  if (!warehouses.some((w) => w.id === input.warehouseId)) {
    throw new InventoryValidationError(
      "Almoxarifado não elegível para este setor.",
      "WAREHOUSE_NOT_ELIGIBLE"
    );
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryCountSession.findFirst({
      where: { warehouseId: input.warehouseId, status: "COUNTING" },
      orderBy: { startedAt: "desc" },
    });
    if (existing) {
      const lineCount = await tx.inventoryCountLine.count({
        where: { sessionId: existing.id },
      });
      return {
        session: {
          id: existing.id,
          code: existing.code,
          status: existing.status,
          warehouseId: existing.warehouseId,
          startedAt: existing.startedAt,
        },
        diagnostics: {
          materialsTotal: 0,
          materialsLinked: 0,
          materialsMissingInventoryItem: 0,
          inventoryItemsWithoutBalance: 0,
          linesCreated: lineCount,
          skippedExistingLines: true,
        },
        reused: true,
      };
    }

    const code = await generateMpSessionCode(tx, input.sector);
    const session = await tx.inventoryCountSession.create({
      data: {
        code,
        warehouseId: input.warehouseId,
        status: "COUNTING",
        responsibleUserId: null,
        startedAt: new Date(),
        notes: input.operationId
          ? `Collector sector ${input.sector}; operationId=${input.operationId}`
          : `Collector sector ${input.sector}`,
      },
    });

    const diagnostics = await populateRawMaterialCountLines(tx, {
      sessionId: session.id,
      warehouseId: input.warehouseId,
      sector: input.sector,
    });

    if (diagnostics.materialsLinked > 0 && diagnostics.linesCreated === 0) {
      throw new InventoryValidationError(
        "Há matérias-primas vinculadas sem linhas de contagem geradas.",
        "COLLECTOR_POPULATION_EMPTY"
      );
    }
    if (diagnostics.linesCreated === 0) {
      throw new InventoryValidationError(
        "Nenhum item logístico de matéria-prima para este almoxarifado.",
        "COLLECTOR_NO_LINES"
      );
    }

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_CREATED",
      afterJson: {
        code: session.code,
        warehouseId: session.warehouseId,
        sector: input.sector,
        deviceId: input.deviceId,
        diagnostics,
      },
      userId: null,
    });
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "COLLECTOR_COUNT_SESSION_STARTED",
      afterJson: {
        status: "COUNTING",
        lines: diagnostics.linesCreated,
        deviceId: input.deviceId,
        sector: input.sector,
      },
      userId: null,
    });

    return {
      session: {
        id: session.id,
        code: session.code,
        status: session.status,
        warehouseId: session.warehouseId,
        startedAt: session.startedAt,
      },
      diagnostics,
      reused: false,
    };
  });
}

export async function listCollectorSessionItemsBlind(
  prisma: PrismaClient,
  sessionId: string,
  opts?: { q?: string | null; filter?: "all" | "pending" | "counted" }
): Promise<{ items: CollectorBlindItem[]; progress: CollectorSessionProgress }> {
  const session = await prisma.inventoryCountSession.findUnique({
    where: { id: sessionId },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
    },
  });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }

  const lines = await prisma.inventoryCountLine.findMany({
    where: { sessionId },
    select: {
      id: true,
      itemId: true,
      version: true,
      countedQuantity: true,
      locationId: true,
      // systemQuantity / observation NÃO entram no DTO cego
      item: { select: { code: true, description: true, unit: true } },
      location: { select: { code: true, name: true } },
    },
    orderBy: [{ item: { code: "asc" } }],
  });

  let items: CollectorBlindItem[] = lines.map((line) => {
    const counted = line.countedQuantity != null;
    return {
      lineId: line.id,
      itemId: line.itemId,
      code: line.item.code,
      description: line.item.description,
      unit: line.item.unit,
      counted,
      countedQuantity: counted ? Number(line.countedQuantity) : null,
      version: line.version,
      status: counted ? "counted" : "pending",
      locationId: line.locationId,
      locationCode: line.location?.code ?? null,
      locationName: line.location?.name ?? null,
    };
  });

  const q = String(opts?.q ?? "")
    .trim()
    .toLowerCase();
  if (q) {
    items = items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }
  if (opts?.filter === "pending") {
    items = items.filter((item) => !item.counted);
  } else if (opts?.filter === "counted") {
    items = items.filter((item) => item.counted);
  }

  const countedLines = lines.filter((l) => l.countedQuantity != null).length;
  const progress: CollectorSessionProgress = {
    sessionId: session.id,
    code: session.code,
    status: session.status,
    warehouseId: session.warehouseId,
    warehouseCode: session.warehouse?.code ?? null,
    warehouseName: session.warehouse?.name ?? null,
    totalLines: lines.length,
    countedLines,
    pendingLines: lines.length - countedLines,
  };

  return { items, progress };
}

export async function getCollectorSessionSummary(
  prisma: PrismaClient,
  sessionId: string,
  opts?: { revealDivergences?: boolean }
): Promise<{
  progress: CollectorSessionProgress;
  divergences: CollectorSessionDivergence[];
}> {
  const { progress } = await listCollectorSessionItemsBlind(prisma, sessionId);
  const reveal = opts?.revealDivergences === true;

  if (!reveal) {
    return { progress, divergences: [] };
  }

  const lines = await prisma.inventoryCountLine.findMany({
    where: { sessionId, countedQuantity: { not: null } },
    include: {
      item: { select: { code: true, description: true, unit: true } },
      currentObservation: true,
    },
  });

  const divergences: CollectorSessionDivergence[] = [];
  for (const line of lines) {
    if (!hasEffectiveCountDivergence(line)) continue;
    const basis = resolveCountAdjustmentBasis(line);
    const expected =
      line.currentObservation != null
        ? Number(line.currentObservation.expectedQuantity)
        : Number(line.systemQuantity);
    divergences.push({
      lineId: line.id,
      itemId: line.itemId,
      code: line.item.code,
      description: line.item.description,
      unit: line.item.unit,
      countedQuantity: Number(line.countedQuantity),
      expectedQuantity: expected,
      adjustmentDelta: basis.delta,
      justification: line.justification,
    });
  }

  return { progress, divergences };
}

/**
 * Finaliza sessão Collector: allowUncounted deixa pending como null;
 * DEVICE recebe justificativa automática em divergências; auto-aprova.
 */
export async function finalizeCollectorSession(
  prisma: PrismaClient,
  input: {
    sessionId: string;
    deviceId: string;
    allowUncounted?: boolean;
  }
) {
  const allowUncounted = input.allowUncounted === true;
  const session = await prisma.inventoryCountSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (session.status !== "COUNTING") {
    throw new InventoryValidationError(
      "Conferência não está em contagem.",
      "INVALID_STATUS"
    );
  }

  const lines = await prisma.inventoryCountLine.findMany({
    where: { sessionId: input.sessionId },
    include: { currentObservation: true },
  });
  if (lines.length === 0) {
    throw new InventoryValidationError(
      "Conferência sem itens — inicie a contagem primeiro.",
      "NO_LINES"
    );
  }

  const pending = lines.filter((l) => l.countedQuantity == null);
  if (!allowUncounted && pending.length > 0) {
    throw new InventoryValidationError(
      "Existem itens pendentes de contagem.",
      COLLECTOR_PENDING_ITEMS
    );
  }

  // DEVICE: preenche justificativa automática nas divergências contadas.
  for (const line of lines) {
    if (line.countedQuantity == null) continue;
    const { delta } = resolveCountAdjustmentBasis(line);
    if (requiresCountJustification(delta, line.justification)) {
      await prisma.inventoryCountLine.update({
        where: { id: line.id },
        data: { justification: COLLECTOR_DEVICE_JUSTIFICATION },
      });
    }
  }

  const ctx = deviceContext(input.deviceId);

  // Reusa finalize canônico: se allowUncounted, temporariamente só valida linhas
  // contadas — o serviço humano exige todos. Por isso o caminho DEVICE faz a
  // finalização aqui com a mesma semântica de status, sem zerar pendentes.
  if (allowUncounted && pending.length > 0) {
    const refreshed = await prisma.inventoryCountLine.findMany({
      where: { sessionId: input.sessionId },
      include: { currentObservation: true },
    });
    const counted = refreshed.filter((l) => l.countedQuantity != null);
    for (const line of counted) {
      const { delta } = resolveCountAdjustmentBasis(line);
      if (requiresCountJustification(delta, line.justification)) {
        throw new InventoryValidationError(
          "Divergência exige justificativa em todas as linhas.",
          "JUSTIFICATION_REQUIRED"
        );
      }
    }
    const hasDivergence = counted.some((line) => hasEffectiveCountDivergence(line));
    const nextStatus = hasDivergence ? "WAITING_APPROVAL" : "APPROVED";
    const updated = await prisma.inventoryCountSession.update({
      where: { id: input.sessionId },
      data: {
        status: nextStatus,
        finishedAt: new Date(),
        ...(nextStatus === "APPROVED"
          ? { approvedByUserId: null, approvedAt: new Date() }
          : {}),
      },
    });
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: input.sessionId,
      action: "FINALIZE",
      afterJson: {
        status: nextStatus,
        hasDivergence,
        allowUncounted: true,
        deviceId: input.deviceId,
        pendingLeft: pending.length,
      },
      userId: null,
    });

    if (updated.status === "WAITING_APPROVAL") {
      await approveInventoryCountSession(prisma, input.sessionId, ctx);
    }

    return getCollectorSessionSummary(prisma, input.sessionId, {
      revealDivergences: true,
    });
  }

  await finalizeInventoryCountSession(prisma, input.sessionId, ctx);
  const after = await prisma.inventoryCountSession.findUnique({
    where: { id: input.sessionId },
  });
  if (after?.status === "WAITING_APPROVAL") {
    await approveInventoryCountSession(prisma, input.sessionId, ctx);
  }

  return getCollectorSessionSummary(prisma, input.sessionId, {
    revealDivergences: true,
  });
}

/** Aplica ajustes; idempotente se já ADJUSTED. */
export async function applyCollectorSessionAdjustments(
  prisma: PrismaClient,
  input: { sessionId: string; deviceId: string; operationId?: string | null }
) {
  const session = await prisma.inventoryCountSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (session.status === "ADJUSTED") {
    return {
      session,
      movementsCreated: 0,
      alreadyApplied: true,
    };
  }

  const ctx: CountSessionContext = {
    ...deviceContext(input.deviceId),
  };

  if (session.status === "WAITING_APPROVAL") {
    await approveInventoryCountSession(prisma, input.sessionId, ctx);
  }

  const result = await generateInventoryCountAdjustments(prisma, input.sessionId, ctx);
  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryCountSession",
    entityId: input.sessionId,
    action: "COLLECTOR_APPLY_ADJUSTMENTS",
    afterJson: {
      movementsCreated: result.movementsCreated,
      deviceId: input.deviceId,
      operationId: input.operationId ?? null,
    },
    userId: null,
  });
  return { ...result, alreadyApplied: false };
}

export function summarizeActiveSession(
  session: Awaited<ReturnType<typeof findActiveCountingSession>>
): CollectorSessionProgress | null {
  if (!session) return null;
  const countedLines = session.lines.filter((l) => l.countedQuantity != null).length;
  return {
    sessionId: session.id,
    code: session.code,
    status: session.status,
    warehouseId: session.warehouseId,
    warehouseCode: session.warehouse?.code ?? null,
    warehouseName: session.warehouse?.name ?? null,
    totalLines: session.lines.length,
    countedLines,
    pendingLines: session.lines.length - countedLines,
  };
}
