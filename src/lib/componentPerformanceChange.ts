/**
 * Regras puras — performance operacional de componentes (ciclo, cavidades, etc.).
 */

export const COMPONENT_PERFORMANCE_CHANGE_SOURCE = "OPERATIONS_PERFORMANCE" as const;

export const COMPONENT_PERFORMANCE_TRACKED_FIELDS = [
  "cycleTimeSeconds",
  "cavities",
  "setupTimeMin",
  "efficiencyExpected",
] as const;

export type ComponentPerformanceTrackedField =
  (typeof COMPONENT_PERFORMANCE_TRACKED_FIELDS)[number];

export type ComponentPerformanceProcessSnapshot = {
  cycleTimeSeconds: number | null;
  cavities: number | null;
  setupTimeMin: number | null;
  efficiencyExpected: number | null;
};

export type ComponentPerformancePatchBody = {
  cycleTimeSeconds?: number | null;
  cavities?: number | null;
  setupTimeMin?: number | null;
  efficiencyExpected?: number | null;
  responsiblePersonName: string;
  note?: string | null;
};

export type ComponentPerformancePatchInput = ComponentPerformancePatchBody & {
  /** Campos explicitamente enviados no payload (presença de chave). */
  presentFields: ReadonlySet<ComponentPerformanceTrackedField>;
};

export class ComponentPerformanceValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ComponentPerformanceValidationError";
    this.code = code;
  }
}

function parseOptionalNumber(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

function parseOptionalInt(raw: unknown): number | null | undefined {
  const value = parseOptionalNumber(raw);
  if (value === undefined || value === null) return value;
  if (!Number.isInteger(value)) return NaN;
  return value;
}

export function parseComponentPerformancePatchBody(
  body: unknown
): ComponentPerformancePatchInput {
  if (!body || typeof body !== "object") {
    throw new ComponentPerformanceValidationError(
      "INVALID_BODY",
      "Corpo da requisição inválido."
    );
  }

  const record = body as Record<string, unknown>;
  const presentFields = new Set<ComponentPerformanceTrackedField>();

  let cycleTimeSeconds: number | null | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "cycleTimeSeconds")) {
    presentFields.add("cycleTimeSeconds");
    cycleTimeSeconds = parseOptionalNumber(record.cycleTimeSeconds);
    if (cycleTimeSeconds !== undefined && cycleTimeSeconds !== null && Number.isNaN(cycleTimeSeconds)) {
      throw new ComponentPerformanceValidationError(
        "INVALID_CYCLE",
        "Ciclo (segundos) inválido."
      );
    }
  }

  let cavities: number | null | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "cavities")) {
    presentFields.add("cavities");
    cavities = parseOptionalInt(record.cavities);
    if (cavities !== undefined && cavities !== null && Number.isNaN(cavities)) {
      throw new ComponentPerformanceValidationError(
        "INVALID_CAVITIES",
        "Cavidades inválidas."
      );
    }
  }

  let setupTimeMin: number | null | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "setupTimeMin")) {
    presentFields.add("setupTimeMin");
    setupTimeMin = parseOptionalNumber(record.setupTimeMin);
    if (setupTimeMin !== undefined && setupTimeMin !== null && Number.isNaN(setupTimeMin)) {
      throw new ComponentPerformanceValidationError(
        "INVALID_SETUP",
        "Setup (minutos) inválido."
      );
    }
  }

  let efficiencyExpected: number | null | undefined;
  if (Object.prototype.hasOwnProperty.call(record, "efficiencyExpected")) {
    presentFields.add("efficiencyExpected");
    efficiencyExpected = parseOptionalNumber(record.efficiencyExpected);
    if (
      efficiencyExpected !== undefined &&
      efficiencyExpected !== null &&
      Number.isNaN(efficiencyExpected)
    ) {
      throw new ComponentPerformanceValidationError(
        "INVALID_EFFICIENCY",
        "Eficiência (%) inválida."
      );
    }
  }

  if (presentFields.size === 0) {
    throw new ComponentPerformanceValidationError(
      "NO_FIELDS",
      "Informe ao menos um campo produtivo para alterar (cycleTimeSeconds, cavities, setupTimeMin, efficiencyExpected)."
    );
  }

  const responsiblePersonName =
    typeof record.responsiblePersonName === "string"
      ? record.responsiblePersonName.trim()
      : "";
  validateResponsiblePersonName(responsiblePersonName);

  const note =
    record.note === undefined || record.note === null
      ? null
      : String(record.note).trim() || null;

  return {
    cycleTimeSeconds,
    cavities,
    setupTimeMin,
    efficiencyExpected,
    responsiblePersonName,
    note,
    presentFields,
  };
}

export function validateResponsiblePersonName(value: string): void {
  if (!value || value.length < 2) {
    throw new ComponentPerformanceValidationError(
      "RESPONSIBLE_REQUIRED",
      "Informe o nome da pessoa responsável pela alteração operacional (mínimo 2 caracteres)."
    );
  }
}

export function snapshotFromProduct(input: {
  cycleTimeSeconds?: unknown;
  cavities?: unknown;
  setupTimeMin?: unknown;
  efficiencyExpected?: unknown;
}): ComponentPerformanceProcessSnapshot {
  return {
    cycleTimeSeconds: decimalOrNull(input.cycleTimeSeconds),
    cavities: intOrNull(input.cavities),
    setupTimeMin: decimalOrNull(input.setupTimeMin),
    efficiencyExpected: decimalOrNull(input.efficiencyExpected),
  };
}

function decimalOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function mergeProcessSnapshot(
  current: ComponentPerformanceProcessSnapshot,
  patch: ComponentPerformancePatchInput
): ComponentPerformanceProcessSnapshot {
  return {
    cycleTimeSeconds: patch.presentFields.has("cycleTimeSeconds")
      ? (patch.cycleTimeSeconds ?? null)
      : current.cycleTimeSeconds,
    cavities: patch.presentFields.has("cavities") ? (patch.cavities ?? null) : current.cavities,
    setupTimeMin: patch.presentFields.has("setupTimeMin")
      ? (patch.setupTimeMin ?? null)
      : current.setupTimeMin,
    efficiencyExpected: patch.presentFields.has("efficiencyExpected")
      ? (patch.efficiencyExpected ?? null)
      : current.efficiencyExpected,
  };
}

export function diffProcessSnapshots(
  before: ComponentPerformanceProcessSnapshot,
  after: ComponentPerformanceProcessSnapshot
): ComponentPerformanceTrackedField[] {
  const changed: ComponentPerformanceTrackedField[] = [];
  for (const field of COMPONENT_PERFORMANCE_TRACKED_FIELDS) {
    const a = before[field];
    const b = after[field];
    if (a === b) continue;
    if (a != null && b != null && Math.abs(a - b) < 1e-9) continue;
    changed.push(field);
  }
  return changed;
}

export function validatePositiveFieldsWhenPresent(
  patch: ComponentPerformancePatchInput
): void {
  if (patch.presentFields.has("cycleTimeSeconds")) {
    const cycle = patch.cycleTimeSeconds;
    if (cycle == null || !Number.isFinite(cycle) || cycle <= 0) {
      throw new ComponentPerformanceValidationError(
        "INVALID_CYCLE",
        "Ciclo (segundos) deve ser maior que zero."
      );
    }
  }

  if (patch.presentFields.has("cavities")) {
    const cav = patch.cavities;
    if (cav == null || !Number.isFinite(cav) || cav < 1) {
      throw new ComponentPerformanceValidationError(
        "INVALID_CAVITIES",
        "Cavidades deve ser maior ou igual a 1."
      );
    }
  }

  if (patch.presentFields.has("setupTimeMin")) {
    const setup = patch.setupTimeMin;
    if (setup == null || !Number.isFinite(setup) || setup < 0) {
      throw new ComponentPerformanceValidationError(
        "INVALID_SETUP",
        "Setup (minutos) deve ser maior ou igual a zero."
      );
    }
  }

  if (patch.presentFields.has("efficiencyExpected")) {
    const eff = patch.efficiencyExpected;
    if (eff == null || !Number.isFinite(eff) || eff <= 0 || eff > 100) {
      throw new ComponentPerformanceValidationError(
        "INVALID_EFFICIENCY",
        "Eficiência (%) deve ser maior que 0 e menor ou igual a 100."
      );
    }
  }
}

/** Após merge: se qualquer campo de processo estiver preenchido, todos devem ser válidos (cadastro). */
export function validateMergedProcessSnapshot(
  snapshot: ComponentPerformanceProcessSnapshot
): void {
  const hasAny =
    snapshot.cycleTimeSeconds != null ||
    snapshot.cavities != null ||
    snapshot.setupTimeMin != null ||
    snapshot.efficiencyExpected != null;

  if (!hasAny) return;

  if (
    snapshot.cycleTimeSeconds == null ||
    !Number.isFinite(snapshot.cycleTimeSeconds) ||
    snapshot.cycleTimeSeconds <= 0
  ) {
    throw new ComponentPerformanceValidationError(
      "PROCESS_INCOMPLETE",
      "Processo padrão incompleto: ciclo (segundos) é obrigatório e deve ser > 0."
    );
  }
  if (snapshot.cavities == null || !Number.isFinite(snapshot.cavities) || snapshot.cavities < 1) {
    throw new ComponentPerformanceValidationError(
      "PROCESS_INCOMPLETE",
      "Processo padrão incompleto: cavidades é obrigatório e deve ser >= 1."
    );
  }
  if (
    snapshot.setupTimeMin == null ||
    !Number.isFinite(snapshot.setupTimeMin) ||
    snapshot.setupTimeMin < 0
  ) {
    throw new ComponentPerformanceValidationError(
      "PROCESS_INCOMPLETE",
      "Processo padrão incompleto: setup (minutos) é obrigatório e deve ser >= 0."
    );
  }
  if (
    snapshot.efficiencyExpected == null ||
    !Number.isFinite(snapshot.efficiencyExpected) ||
    snapshot.efficiencyExpected <= 0 ||
    snapshot.efficiencyExpected > 100
  ) {
    throw new ComponentPerformanceValidationError(
      "PROCESS_INCOMPLETE",
      "Processo padrão incompleto: eficiência (%) é obrigatória e deve estar entre 0 e 100."
    );
  }
}

export function serializeProcessSnapshot(snapshot: ComponentPerformanceProcessSnapshot) {
  return { ...snapshot };
}

export type ComponentPerformanceListFilters = {
  sku?: string;
  name?: string;
  status?: string;
  soldOnly?: boolean;
  missingProcessOnly?: boolean;
  missingCycleOnly?: boolean;
  missingCavitiesOnly?: boolean;
  soldMissingOnly?: boolean;
  pendingOnly?: boolean;
  recentlyChangedOnly?: boolean;
  recentDays?: number;
  limit?: number;
  offset?: number;
};

export function parseComponentPerformanceListQuery(
  query: Record<string, unknown>
): ComponentPerformanceListFilters {
  const sku = typeof query.sku === "string" && query.sku.trim() ? query.sku.trim() : undefined;
  const name = typeof query.name === "string" && query.name.trim() ? query.name.trim() : undefined;
  const status =
    typeof query.status === "string" && query.status.trim() ? query.status.trim().toUpperCase() : undefined;
  const soldOnly = query.soldOnly === "1" || query.soldOnly === "true";
  const missingProcessOnly =
    query.missingProcessOnly === "1" || query.missingProcessOnly === "true";
  const missingCycleOnly =
    query.missingCycleOnly === "1" || query.missingCycleOnly === "true";
  const missingCavitiesOnly =
    query.missingCavitiesOnly === "1" || query.missingCavitiesOnly === "true";
  const soldMissingOnly = query.soldMissingOnly === "1" || query.soldMissingOnly === "true";
  const pendingOnly = query.pendingOnly === "1" || query.pendingOnly === "true";
  const recentlyChangedOnly =
    query.recentlyChangedOnly === "1" || query.recentlyChangedOnly === "true";
  const recentDaysRaw = query.recentDays != null ? Number(query.recentDays) : 30;
  const recentDays = Number.isFinite(recentDaysRaw)
    ? Math.min(Math.max(Math.floor(recentDaysRaw), 1), 365)
    : 30;

  const limitRaw = query.limit != null ? Number(query.limit) : 100;
  const offsetRaw = query.offset != null ? Number(query.offset) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

  return {
    sku,
    name,
    status,
    soldOnly,
    missingProcessOnly,
    missingCycleOnly,
    missingCavitiesOnly,
    soldMissingOnly,
    pendingOnly,
    recentlyChangedOnly,
    recentDays,
    limit,
    offset,
  };
}

export function estimateTheoreticalPiecesPerHour(
  process: ComponentPerformanceProcessSnapshot
): number | null {
  const cycle = process.cycleTimeSeconds;
  const cav = process.cavities;
  const eff = process.efficiencyExpected ?? 100;
  if (cycle == null || cycle <= 0 || cav == null || cav < 1 || eff <= 0) return null;
  const value = (3600 / cycle) * cav * (eff / 100);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isMissingComponentProcess(snapshot: ComponentPerformanceProcessSnapshot): boolean {
  return (
    snapshot.cycleTimeSeconds == null ||
    snapshot.cavities == null ||
    snapshot.setupTimeMin == null ||
    snapshot.efficiencyExpected == null
  );
}
