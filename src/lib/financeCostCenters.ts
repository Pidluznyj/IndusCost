import { prisma } from "@/src/lib/prisma.js";

export type FinancialCostCenterStatus = "ACTIVE" | "INACTIVE";

export class FinanceCostCenterValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceCostCenterValidationError";
    this.code = code;
  }
}

export type FinanceCostCenterRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  status: FinancialCostCenterStatus;
  color: string | null;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FinanceCostCenterDto = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  status: FinancialCostCenterStatus;
  color: string | null;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinanceCostCenterCreateInput = {
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  responsibleUserId?: string | null;
  responsibleName?: string | null;
  status?: FinancialCostCenterStatus;
  color?: string | null;
  icon?: string | null;
};

export type FinanceCostCenterUpdateInput = {
  code?: string;
  name?: string;
  description?: string | null;
  parentId?: string | null;
  responsibleUserId?: string | null;
  responsibleName?: string | null;
  status?: FinancialCostCenterStatus;
  color?: string | null;
  icon?: string | null;
};

export type FinanceCostCentersListQuery = {
  status?: FinancialCostCenterStatus | "all";
};

export type FinanceCostCenterWriteData = {
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  responsibleUserId?: string | null;
  responsibleName?: string | null;
  status?: FinancialCostCenterStatus;
  color?: string | null;
  icon?: string | null;
};

export type FinanceCostCentersDeps = {
  listCenters: (query?: FinanceCostCentersListQuery) => Promise<FinanceCostCenterRecord[]>;
  findCenterById: (id: string) => Promise<FinanceCostCenterRecord | null>;
  findCenterByCode: (code: string) => Promise<FinanceCostCenterRecord | null>;
  createCenter: (data: FinanceCostCenterWriteData) => Promise<FinanceCostCenterRecord>;
  updateCenter: (
    id: string,
    data: Partial<FinanceCostCenterWriteData>
  ) => Promise<FinanceCostCenterRecord>;
  countActiveRulesForCenter: (costCenterId: string) => Promise<number>;
};

const VALID_STATUSES = new Set<FinancialCostCenterStatus>(["ACTIVE", "INACTIVE"]);

export function normalizeFinanceCostCenterCode(code: string): string {
  return code.trim().toUpperCase();
}

export function parseFinanceCostCenterStatus(
  value: unknown,
  options?: { required?: boolean }
): FinancialCostCenterStatus | null {
  if (value == null || value === "") {
    if (options?.required) {
      throw new FinanceCostCenterValidationError("INVALID_STATUS", "Status inválido.");
    }
    return null;
  }
  const normalized = String(value).trim().toUpperCase();
  if (!VALID_STATUSES.has(normalized as FinancialCostCenterStatus)) {
    throw new FinanceCostCenterValidationError(
      "INVALID_STATUS",
      'Status inválido. Use "ACTIVE" ou "INACTIVE".'
    );
  }
  return normalized as FinancialCostCenterStatus;
}

function requireNonEmptyString(
  value: unknown,
  code: string,
  message: string
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new FinanceCostCenterValidationError(code, message);
  return text;
}

function optionalTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

export function serializeFinanceCostCenter(row: FinanceCostCenterRecord): FinanceCostCenterDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    parentId: row.parentId ?? null,
    responsibleUserId: row.responsibleUserId ?? null,
    responsibleName: row.responsibleName ?? null,
    status: row.status,
    color: row.color ?? null,
    icon: row.icon ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function wouldCreateCircularFinanceCostCenterParent(
  centerId: string,
  newParentId: string | null,
  centers: Array<Pick<FinanceCostCenterRecord, "id" | "parentId">>
): boolean {
  if (!newParentId) return false;
  if (newParentId === centerId) return true;

  const byId = new Map(centers.map((center) => [center.id, center]));
  if (!byId.has(newParentId)) return false;

  let current: string | null = newParentId;
  const visited = new Set<string>();
  while (current) {
    if (current === centerId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

async function assertParentIsValid(
  deps: FinanceCostCentersDeps,
  parentId: string | null,
  centerId: string | null,
  allCenters: FinanceCostCenterRecord[]
): Promise<void> {
  if (!parentId) return;

  const parent = allCenters.find((center) => center.id === parentId) ??
    (await deps.findCenterById(parentId));
  if (!parent) {
    throw new FinanceCostCenterValidationError("INVALID_PARENT", "parentId inválido.");
  }
  if (parent.status !== "ACTIVE") {
    throw new FinanceCostCenterValidationError(
      "INACTIVE_PARENT",
      "Não é possível vincular a um centro de custo inativo."
    );
  }
  if (centerId && wouldCreateCircularFinanceCostCenterParent(centerId, parentId, allCenters)) {
    throw new FinanceCostCenterValidationError(
      "CIRCULAR_PARENT",
      "Hierarquia circular não permitida."
    );
  }
}

async function assertCanInactivateCenter(
  deps: FinanceCostCentersDeps,
  costCenterId: string
): Promise<void> {
  const activeRules = await deps.countActiveRulesForCenter(costCenterId);
  if (activeRules > 0) {
    throw new FinanceCostCenterValidationError(
      "ACTIVE_RULES_BLOCK_INACTIVATION",
      `Não é possível inativar: existem ${activeRules} regra(s) ativa(s) vinculada(s) a este centro de custo.`
    );
  }
}

export function parseFinanceCostCenterCreateBody(body: unknown): FinanceCostCenterCreateInput {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceCostCenterValidationError("INVALID_BODY", "Payload inválido.");
  }
  const payload = body as Record<string, unknown>;
  const code = normalizeFinanceCostCenterCode(
    requireNonEmptyString(payload.code, "MISSING_CODE", "code é obrigatório.")
  );
  const name = requireNonEmptyString(payload.name, "MISSING_NAME", "name é obrigatório.");
  const status = parseFinanceCostCenterStatus(payload.status) ?? "ACTIVE";

  return {
    code,
    name,
    description: optionalTrimmedString(payload.description),
    parentId: optionalTrimmedString(payload.parentId),
    responsibleUserId: optionalTrimmedString(payload.responsibleUserId),
    responsibleName: optionalTrimmedString(payload.responsibleName),
    status,
    color: optionalTrimmedString(payload.color),
    icon: optionalTrimmedString(payload.icon),
  };
}

export function parseFinanceCostCenterUpdateBody(body: unknown): FinanceCostCenterUpdateInput {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceCostCenterValidationError("INVALID_BODY", "Payload inválido.");
  }
  const payload = body as Record<string, unknown>;
  const input: FinanceCostCenterUpdateInput = {};

  if (payload.code !== undefined) {
    input.code = normalizeFinanceCostCenterCode(
      requireNonEmptyString(payload.code, "MISSING_CODE", "code é obrigatório.")
    );
  }
  if (payload.name !== undefined) {
    input.name = requireNonEmptyString(payload.name, "MISSING_NAME", "name é obrigatório.");
  }
  if (payload.description !== undefined) input.description = optionalTrimmedString(payload.description);
  if (payload.parentId !== undefined) input.parentId = optionalTrimmedString(payload.parentId);
  if (payload.responsibleUserId !== undefined) {
    input.responsibleUserId = optionalTrimmedString(payload.responsibleUserId);
  }
  if (payload.responsibleName !== undefined) {
    input.responsibleName = optionalTrimmedString(payload.responsibleName);
  }
  if (payload.status !== undefined) input.status = parseFinanceCostCenterStatus(payload.status, { required: true })!;
  if (payload.color !== undefined) input.color = optionalTrimmedString(payload.color);
  if (payload.icon !== undefined) input.icon = optionalTrimmedString(payload.icon);

  return input;
}

export function parseFinanceCostCentersListQuery(
  query: Record<string, unknown>
): FinanceCostCentersListQuery {
  const rawStatus =
    typeof query.status === "string" ? query.status.trim().toUpperCase() : "ALL";
  if (
    !rawStatus ||
    rawStatus === "ALL" ||
    rawStatus === "TODOS" ||
    rawStatus === "TODO"
  ) {
    return { status: "all" };
  }
  const status = parseFinanceCostCenterStatus(rawStatus, { required: true });
  return { status: status! };
}

export async function listFinancialCostCenters(
  deps: FinanceCostCentersDeps,
  query: FinanceCostCentersListQuery = { status: "all" }
): Promise<{ items: FinanceCostCenterDto[] }> {
  const rows = await deps.listCenters(query);
  return { items: rows.map(serializeFinanceCostCenter) };
}

export async function getFinancialCostCenterById(
  deps: FinanceCostCentersDeps,
  id: string
): Promise<FinanceCostCenterDto | null> {
  const row = await deps.findCenterById(id);
  return row ? serializeFinanceCostCenter(row) : null;
}

export async function createFinancialCostCenter(
  deps: FinanceCostCentersDeps,
  input: FinanceCostCenterCreateInput
): Promise<FinanceCostCenterDto> {
  const code = normalizeFinanceCostCenterCode(input.code);
  const existingCode = await deps.findCenterByCode(code);
  if (existingCode) {
    throw new FinanceCostCenterValidationError(
      "DUPLICATE_CODE",
      `Já existe centro de custo com o código "${code}".`
    );
  }

  const allCenters = await deps.listCenters({ status: "all" });
  await assertParentIsValid(deps, input.parentId ?? null, null, allCenters);

  const created = await deps.createCenter({
    code,
    name: input.name.trim(),
    description: input.description,
    parentId: input.parentId,
    responsibleUserId: input.responsibleUserId,
    responsibleName: input.responsibleName,
    status: input.status ?? "ACTIVE",
    color: input.color,
    icon: input.icon,
  });

  return serializeFinanceCostCenter(created);
}

export async function updateFinancialCostCenter(
  deps: FinanceCostCentersDeps,
  id: string,
  input: FinanceCostCenterUpdateInput
): Promise<FinanceCostCenterDto> {
  const current = await deps.findCenterById(id);
  if (!current) {
    throw new FinanceCostCenterValidationError("NOT_FOUND", "Centro de custo não encontrado.");
  }

  if (input.code) {
    const normalizedCode = normalizeFinanceCostCenterCode(input.code);
    if (normalizedCode !== current.code) {
      const duplicate = await deps.findCenterByCode(normalizedCode);
      if (duplicate && duplicate.id !== id) {
        throw new FinanceCostCenterValidationError(
          "DUPLICATE_CODE",
          `Já existe centro de custo com o código "${normalizedCode}".`
        );
      }
    }
    input = { ...input, code: normalizedCode };
  }

  const nextParentId =
    input.parentId !== undefined ? input.parentId : current.parentId;
  const allCenters = await deps.listCenters({ status: "all" });
  await assertParentIsValid(deps, nextParentId, id, allCenters);

  const nextStatus = input.status ?? current.status;
  if (current.status === "ACTIVE" && nextStatus === "INACTIVE") {
    await assertCanInactivateCenter(deps, id);
  }

  const updated = await deps.updateCenter(id, {
    code: input.code,
    name: input.name,
    description: input.description,
    parentId: input.parentId,
    responsibleUserId: input.responsibleUserId,
    responsibleName: input.responsibleName,
    status: input.status,
    color: input.color,
    icon: input.icon,
  });

  return serializeFinanceCostCenter(updated);
}

export function createDefaultFinanceCostCentersDeps(): FinanceCostCentersDeps {
  return {
    listCenters: async (query) => {
      const where =
        query?.status && query.status !== "all" ? { status: query.status } : undefined;
      return prisma.financialCostCenter.findMany({
        where,
        orderBy: [{ code: "asc" }],
      });
    },
    findCenterById: async (id) =>
      prisma.financialCostCenter.findUnique({
        where: { id },
      }),
    findCenterByCode: async (code) =>
      prisma.financialCostCenter.findUnique({
        where: { code },
      }),
    createCenter: async (data) => prisma.financialCostCenter.create({ data }),
    updateCenter: async (id, data) =>
      prisma.financialCostCenter.update({
        where: { id },
        data,
      }),
    countActiveRulesForCenter: async (costCenterId) =>
      prisma.supplierCostCenterRule.count({
        where: { costCenterId, isActive: true },
      }),
  };
}

export async function listFinancialCostCentersDefault(
  query?: FinanceCostCentersListQuery
): Promise<{ items: FinanceCostCenterDto[] }> {
  return listFinancialCostCenters(createDefaultFinanceCostCentersDeps(), query);
}

export async function getFinancialCostCenterByIdDefault(
  id: string
): Promise<FinanceCostCenterDto | null> {
  return getFinancialCostCenterById(createDefaultFinanceCostCentersDeps(), id);
}

export async function createFinancialCostCenterDefault(
  input: FinanceCostCenterCreateInput
): Promise<FinanceCostCenterDto> {
  return createFinancialCostCenter(createDefaultFinanceCostCentersDeps(), input);
}

export async function updateFinancialCostCenterDefault(
  id: string,
  input: FinanceCostCenterUpdateInput
): Promise<FinanceCostCenterDto> {
  return updateFinancialCostCenter(createDefaultFinanceCostCentersDeps(), id, input);
}
