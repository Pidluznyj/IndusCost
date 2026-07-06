import type { FleetDriverStatus, FleetVehicleOrigin, FleetVehicleStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import { normalizeCpf } from "@/src/lib/fleetDriverOps.js";
import {
  assertNonNegativeKm,
  computeCnhStatus,
  normalizePlate,
  parseCnhCategoryRank,
  parseDecimalKm,
} from "@/src/lib/fleetValidation.js";

import {
  FLEET_IMPORT_CONFIRM_TOKEN,
  type FleetImportRowResult,
  type FleetImportSummary,
} from "@/src/lib/fleetCsvImportShared.js";

export { FLEET_IMPORT_CONFIRM_TOKEN, type FleetImportRowResult, type FleetImportSummary };

const VEHICLE_ORIGINS = new Set<FleetVehicleOrigin>([
  "OWNED",
  "RENTED",
  "LEASING",
  "COMODATO",
  "THIRD_PARTY",
]);

const VEHICLE_STATUSES = new Set<FleetVehicleStatus>([
  "AVAILABLE",
  "RESERVED",
  "IN_USE",
  "MAINTENANCE",
  "BLOCKED",
  "CLAIMED",
  "INACTIVE",
  "RETURNED",
  "SOLD",
]);

const DRIVER_STATUSES = new Set<FleetDriverStatus>([
  "AUTHORIZED",
  "PENDING",
  "BLOCKED",
  "INACTIVE",
]);

const VEHICLE_HEADER_ALIASES: Record<string, string> = {
  placa: "plate",
  plate: "plate",
  marca: "brand",
  brand: "brand",
  modelo: "model",
  model: "model",
  renavam: "renavam",
  chassis: "chassis",
  chassi: "chassis",
  ano_modelo: "modelYear",
  modelyear: "modelYear",
  ano_fabricacao: "manufactureYear",
  manufactureyear: "manufactureYear",
  cor: "color",
  color: "color",
  tipo_veiculo: "vehicleType",
  vehicletype: "vehicleType",
  combustivel: "fuelType",
  fueltype: "fuelType",
  origem: "origin",
  origin: "origin",
  status: "status",
  km_atual: "currentKm",
  currentkm: "currentKm",
  km_inicial: "initialKm",
  initialkm: "initialKm",
  unidade: "unit",
  unit: "unit",
  centro_custo: "costCenter",
  costcenter: "costCenter",
  observacoes: "notes",
  notes: "notes",
};

const DRIVER_HEADER_ALIASES: Record<string, string> = {
  nome: "name",
  name: "name",
  cpf: "cpf",
  cnh: "cnhNumber",
  cnh_numero: "cnhNumber",
  cnhnumber: "cnhNumber",
  categoria_cnh: "cnhCategory",
  cnhcategory: "cnhCategory",
  cnh_categoria: "cnhCategory",
  cnh_validade: "cnhExpirationDate",
  cnhexpirationdate: "cnhExpirationDate",
  validade_cnh: "cnhExpirationDate",
  telefone: "phone",
  phone: "phone",
  email: "email",
  unidade: "unit",
  unit: "unit",
  centro_custo: "costCenter",
  costcenter: "costCenter",
  status: "status",
  observacoes: "notes",
  notes: "notes",
};

export function stripCsvBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

export function detectCsvDelimiter(headerLine: string): ";" | "," {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

export function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseFleetCsvTable(
  csvText: string,
  headerAliases: Record<string, string>
): { headers: string[]; records: Record<string, string>[] } | { error: string } {
  const raw = stripCsvBom(csvText).trim();
  if (!raw) return { error: "CSV vazio." };

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { error: "CSV deve conter cabeçalho e ao menos uma linha de dados." };
  }

  const delimiter = detectCsvDelimiter(lines[0]!);
  const headerCells = parseCsvLine(lines[0]!, delimiter);
  const headers = headerCells.map((h) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, "_");
    return headerAliases[key] ?? key;
  });

  if (headers.every((h) => !h)) {
    return { error: "Cabeçalho do CSV inválido." };
  }

  const records: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!, delimiter);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const field = headers[c];
      if (field) row[field] = (cells[c] ?? "").trim();
    }
    if (Object.values(row).every((v) => !v)) continue;
    records.push(row);
  }

  if (records.length === 0) {
    return { error: "Nenhuma linha de dados encontrada no CSV." };
  }

  return { headers, records };
}

function parseOptionalInt(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseOptionalDate(value: string): Date | null {
  if (!value.trim()) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const d = iso ? new Date(`${value.trim()}T12:00:00`) : new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidCnhCategory(category: string | null | undefined): boolean {
  if (!category?.trim()) return true;
  return parseCnhCategoryRank(category) > 0;
}

export function resolveDriverStatusOnImport(input: {
  requestedStatus?: string;
  cnhExpirationDate: Date | null;
  blockExpiredCnh: boolean;
}): { status: FleetDriverStatus; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const cnhExpired =
    input.cnhExpirationDate != null &&
    computeCnhStatus(input.cnhExpirationDate, 0, new Date()) === "EXPIRED";

  let status: FleetDriverStatus = "PENDING";
  if (input.requestedStatus) {
    const up = input.requestedStatus.trim().toUpperCase() as FleetDriverStatus;
    if (!DRIVER_STATUSES.has(up)) {
      errors.push(`Status inválido: ${input.requestedStatus}`);
      return { status: "PENDING", warnings, errors };
    }
    status = up;
  }

  if (cnhExpired) {
    const auto: FleetDriverStatus = input.blockExpiredCnh ? "BLOCKED" : "PENDING";
    if (status === "AUTHORIZED") {
      errors.push("CNH vencida: não é permitido importar como AUTHORIZED.");
    } else if (!input.requestedStatus) {
      status = auto;
      warnings.push(
        `CNH vencida: status definido automaticamente como ${auto}.`
      );
    } else if (status !== auto && status !== "BLOCKED" && status !== "PENDING") {
      warnings.push(`CNH vencida: recomendado status ${auto}.`);
    }
  }

  return { status, warnings, errors };
}

export type VehicleValidationContext = {
  seenPlates: Map<string, number>;
  existingPlates: Map<string, string>;
  allowUpdate: boolean;
};

export function validateVehicleImportRow(
  row: Record<string, string>,
  line: number,
  ctx: VehicleValidationContext
): FleetImportRowResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const brand = row.brand?.trim() ?? "";
  const model = row.model?.trim() ?? "";
  if (!brand) errors.push("Marca é obrigatória.");
  if (!model) errors.push("Modelo é obrigatório.");

  const plate = normalizePlate(row.plate ?? null);
  if (plate) {
    const prevLine = ctx.seenPlates.get(plate);
    if (prevLine != null) {
      errors.push(`Placa duplicada no CSV (linha ${prevLine}).`);
    } else {
      ctx.seenPlates.set(plate, line);
    }
    const existingId = ctx.existingPlates.get(plate);
    if (existingId) {
      if (!ctx.allowUpdate) {
        errors.push("Placa já cadastrada no sistema (use allowUpdate para atualizar).");
      }
    }
  }

  const originRaw = (row.origin?.trim() || "OWNED").toUpperCase() as FleetVehicleOrigin;
  if (!VEHICLE_ORIGINS.has(originRaw)) {
    errors.push(`Origem inválida: ${row.origin ?? ""}`);
  }

  const statusRaw = (row.status?.trim() || "AVAILABLE").toUpperCase() as FleetVehicleStatus;
  if (!VEHICLE_STATUSES.has(statusRaw)) {
    errors.push(`Status inválido: ${row.status ?? ""}`);
  }

  let currentKm = 0;
  let initialKm = 0;
  try {
    if (row.currentKm?.trim()) {
      currentKm = parseDecimalKm(row.currentKm) ?? NaN;
      assertNonNegativeKm(currentKm);
    }
    if (row.initialKm?.trim()) {
      initialKm = parseDecimalKm(row.initialKm) ?? NaN;
      assertNonNegativeKm(initialKm);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Quilometragem inválida.");
  }

  const modelYear = row.modelYear ? parseOptionalInt(row.modelYear) : null;
  if (row.modelYear?.trim() && modelYear == null) errors.push("Ano modelo inválido.");
  const manufactureYear = row.manufactureYear ? parseOptionalInt(row.manufactureYear) : null;
  if (row.manufactureYear?.trim() && manufactureYear == null) {
    errors.push("Ano fabricação inválido.");
  }

  const existingId = plate ? ctx.existingPlates.get(plate) : undefined;
  const action: FleetImportRowResult["action"] = existingId
    ? ctx.allowUpdate
      ? "update"
      : "skip"
    : "create";

  const valid = errors.length === 0;

  return {
    line,
    valid,
    action: valid ? action : "skip",
    errors,
    warnings,
    preview: valid
      ? {
          plate,
          brand,
          model,
          origin: originRaw,
          status: statusRaw,
          currentKm,
          initialKm,
        }
      : undefined,
  };
}

export type DriverValidationContext = {
  seenCpfs: Map<string, number>;
  existingCpfs: Map<string, string>;
  allowUpdate: boolean;
  blockExpiredCnh: boolean;
};

export function validateDriverImportRow(
  row: Record<string, string>,
  line: number,
  ctx: DriverValidationContext
): FleetImportRowResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = row.name?.trim() ?? "";
  const cpfRaw = row.cpf?.trim() ?? "";
  if (!name) errors.push("Nome é obrigatório.");
  if (!cpfRaw) errors.push("CPF é obrigatório.");

  const cpf = normalizeCpf(cpfRaw);
  if (cpf && cpf.length !== 11) errors.push("CPF deve conter 11 dígitos.");

  if (cpf) {
    const prev = ctx.seenCpfs.get(cpf);
    if (prev != null) errors.push(`CPF duplicado no CSV (linha ${prev}).`);
    else ctx.seenCpfs.set(cpf, line);

    if (ctx.existingCpfs.has(cpf) && !ctx.allowUpdate) {
      errors.push("CPF já cadastrado no sistema (use allowUpdate para atualizar).");
    }
  }

  const cnhCategory = row.cnhCategory?.trim() || null;
  if (!isValidCnhCategory(cnhCategory)) {
    errors.push(`Categoria CNH inválida: ${cnhCategory}`);
  }

  const cnhExpirationDate = parseOptionalDate(row.cnhExpirationDate ?? "");
  if (row.cnhExpirationDate?.trim() && !cnhExpirationDate) {
    errors.push("Data de validade da CNH inválida.");
  }

  const statusResolved = resolveDriverStatusOnImport({
    requestedStatus: row.status,
    cnhExpirationDate,
    blockExpiredCnh: ctx.blockExpiredCnh,
  });
  errors.push(...statusResolved.errors);
  warnings.push(...statusResolved.warnings);

  if (cnhExpirationDate) {
    const st = computeCnhStatus(cnhExpirationDate, 30);
    if (st === "EXPIRING") warnings.push("CNH vencendo em breve.");
  }

  const existingId = cpf ? ctx.existingCpfs.get(cpf) : undefined;
  const action: FleetImportRowResult["action"] = existingId
    ? ctx.allowUpdate
      ? "update"
      : "skip"
    : "create";

  const valid = errors.length === 0;

  return {
    line,
    valid,
    action: valid ? action : "skip",
    errors,
    warnings,
    preview: valid
      ? {
          name,
          cpf,
          cnhCategory,
          status: statusResolved.status,
          cnhExpirationDate: cnhExpirationDate?.toISOString().slice(0, 10) ?? null,
        }
      : undefined,
  };
}

function summarizeRows(mode: "preview" | "apply", rows: FleetImportRowResult[]): FleetImportSummary {
  const validRows = rows.filter((r) => r.valid);
  return {
    mode,
    totalRows: rows.length,
    validCount: validRows.length,
    invalidCount: rows.length - validRows.length,
    wouldCreate: validRows.filter((r) => r.action === "create").length,
    wouldUpdate: validRows.filter((r) => r.action === "update").length,
    created: mode === "apply" ? validRows.filter((r) => r.action === "create").length : 0,
    updated: mode === "apply" ? validRows.filter((r) => r.action === "update").length : 0,
    skipped: rows.filter((r) => !r.valid).length,
    rows,
  };
}

async function loadExistingPlates(): Promise<Map<string, string>> {
  const vehicles = await prisma.fleetVehicle.findMany({
    where: { plate: { not: null } },
    select: { id: true, plate: true },
  });
  const map = new Map<string, string>();
  for (const v of vehicles) {
    if (v.plate) map.set(v.plate, v.id);
  }
  return map;
}

async function loadExistingCpfs(): Promise<Map<string, string>> {
  const drivers = await prisma.fleetDriver.findMany({ select: { id: true, cpf: true } });
  const map = new Map<string, string>();
  for (const d of drivers) {
    map.set(normalizeCpf(d.cpf), d.id);
  }
  return map;
}

export async function previewVehicleCsvImport(
  csvText: string,
  options?: { allowUpdate?: boolean }
): Promise<FleetImportSummary | { error: string }> {
  const parsed = parseFleetCsvTable(csvText, VEHICLE_HEADER_ALIASES);
  if ("error" in parsed) return parsed;

  const existingPlates = await loadExistingPlates();
  const ctx: VehicleValidationContext = {
    seenPlates: new Map(),
    existingPlates,
    allowUpdate: Boolean(options?.allowUpdate),
  };

  const rows: FleetImportRowResult[] = [];
  let lineNum = 2;
  for (const record of parsed.records) {
    rows.push(validateVehicleImportRow(record, lineNum, ctx));
    lineNum++;
  }

  return summarizeRows("preview", rows);
}

export async function applyVehicleCsvImport(
  csvText: string,
  options: { allowUpdate?: boolean; userId?: string | null }
): Promise<FleetImportSummary | { error: string }> {
  const preview = await previewVehicleCsvImport(csvText, options);
  if ("error" in preview) return preview;

  const parsed = parseFleetCsvTable(csvText, VEHICLE_HEADER_ALIASES);
  if ("error" in parsed) return parsed;

  const existingPlates = await loadExistingPlates();
  const ctx: VehicleValidationContext = {
    seenPlates: new Map(),
    existingPlates,
    allowUpdate: Boolean(options?.allowUpdate),
  };

  const results: FleetImportRowResult[] = [];
  let lineNum = 2;
  for (const record of parsed.records) {
    const validation = validateVehicleImportRow(record, lineNum, ctx);
    if (!validation.valid) {
      results.push(validation);
      lineNum++;
      continue;
    }

    try {
      const plate = normalizePlate(record.plate ?? null);
      const origin = (record.origin?.trim() || "OWNED").toUpperCase() as FleetVehicleOrigin;
      const status = (record.status?.trim() || "AVAILABLE").toUpperCase() as FleetVehicleStatus;
      const currentKm = record.currentKm?.trim() ? (parseDecimalKm(record.currentKm) ?? 0) : 0;
      const initialKm = record.initialKm?.trim() ? (parseDecimalKm(record.initialKm) ?? 0) : 0;

      const data = {
        plate,
        renavam: record.renavam?.trim() || null,
        chassis: record.chassis?.trim() || null,
        brand: record.brand!.trim(),
        model: record.model!.trim(),
        modelYear: record.modelYear ? parseOptionalInt(record.modelYear) : null,
        manufactureYear: record.manufactureYear ? parseOptionalInt(record.manufactureYear) : null,
        color: record.color?.trim() || null,
        vehicleType: record.vehicleType?.trim() || null,
        fuelType: record.fuelType?.trim() || null,
        origin,
        status,
        currentKm,
        initialKm,
        unit: record.unit?.trim() || null,
        costCenter: record.costCenter?.trim() || null,
        notes: record.notes?.trim() || null,
        createdBy: options.userId ?? null,
        updatedBy: options.userId ?? null,
      };

      const existingId = plate ? existingPlates.get(plate) : undefined;
      if (existingId && options.allowUpdate) {
        await prisma.fleetVehicle.update({ where: { id: existingId }, data });
        await writeFleetAuditLog({
          entityType: "FleetVehicle",
          entityId: existingId,
          action: "IMPORT_UPDATE",
          newValue: plate ?? existingId,
          userId: options.userId ?? null,
        });
        results.push({ ...validation, action: "update" });
      } else {
        const created = await prisma.fleetVehicle.create({ data });
        if (plate) existingPlates.set(plate, created.id);
        await writeFleetAuditLog({
          entityType: "FleetVehicle",
          entityId: created.id,
          action: "IMPORT_CREATE",
          newValue: plate ?? created.id,
          userId: options.userId ?? null,
        });
        results.push({ ...validation, action: "create" });
      }
    } catch (e) {
      results.push({
        ...validation,
        valid: false,
        action: "skip",
        errors: [...validation.errors, e instanceof Error ? e.message : "Erro ao gravar."],
      });
    }
    lineNum++;
  }

  const summary = summarizeRows("apply", results);
  summary.created = results.filter((r) => r.valid && r.action === "create").length;
  summary.updated = results.filter((r) => r.valid && r.action === "update").length;
  return summary;
}

export async function previewDriverCsvImport(
  csvText: string,
  options?: { allowUpdate?: boolean }
): Promise<FleetImportSummary | { error: string }> {
  const parsed = parseFleetCsvTable(csvText, DRIVER_HEADER_ALIASES);
  if ("error" in parsed) return parsed;

  const settings = await loadFleetSettings();
  const blockExpiredCnh = settings.bloquearRetiradaCnhVencida === "true";
  const existingCpfs = await loadExistingCpfs();

  const ctx: DriverValidationContext = {
    seenCpfs: new Map(),
    existingCpfs,
    allowUpdate: Boolean(options?.allowUpdate),
    blockExpiredCnh,
  };

  const rows: FleetImportRowResult[] = [];
  let lineNum = 2;
  for (const record of parsed.records) {
    rows.push(validateDriverImportRow(record, lineNum, ctx));
    lineNum++;
  }

  return summarizeRows("preview", rows);
}

export async function applyDriverCsvImport(
  csvText: string,
  options: { allowUpdate?: boolean; userId?: string | null }
): Promise<FleetImportSummary | { error: string }> {
  const parsed = parseFleetCsvTable(csvText, DRIVER_HEADER_ALIASES);
  if ("error" in parsed) return parsed;

  const settings = await loadFleetSettings();
  const blockExpiredCnh = settings.bloquearRetiradaCnhVencida === "true";
  const existingCpfs = await loadExistingCpfs();

  const ctx: DriverValidationContext = {
    seenCpfs: new Map(),
    existingCpfs,
    allowUpdate: Boolean(options?.allowUpdate),
    blockExpiredCnh,
  };

  const results: FleetImportRowResult[] = [];
  let lineNum = 2;
  for (const record of parsed.records) {
    const validation = validateDriverImportRow(record, lineNum, ctx);
    if (!validation.valid) {
      results.push(validation);
      lineNum++;
      continue;
    }

    try {
      const cpf = normalizeCpf(record.cpf!);
      const cnhExpirationDate = parseOptionalDate(record.cnhExpirationDate ?? "");
      const { status } = resolveDriverStatusOnImport({
        requestedStatus: record.status,
        cnhExpirationDate,
        blockExpiredCnh,
      });

      const data = {
        name: record.name!.trim(),
        cpf,
        cnhNumber: record.cnhNumber?.trim() || null,
        cnhCategory: record.cnhCategory?.trim() || null,
        cnhExpirationDate,
        phone: record.phone?.trim() || null,
        email: record.email?.trim() || null,
        unit: record.unit?.trim() || null,
        costCenter: record.costCenter?.trim() || null,
        status,
        notes: record.notes?.trim() || null,
      };

      const existingId = existingCpfs.get(cpf);
      if (existingId && options.allowUpdate) {
        await prisma.fleetDriver.update({ where: { id: existingId }, data });
        await writeFleetAuditLog({
          entityType: "FleetDriver",
          entityId: existingId,
          action: "IMPORT_UPDATE",
          newValue: cpf,
          userId: options.userId ?? null,
        });
        results.push({ ...validation, action: "update" });
      } else {
        const created = await prisma.fleetDriver.create({ data });
        existingCpfs.set(cpf, created.id);
        await writeFleetAuditLog({
          entityType: "FleetDriver",
          entityId: created.id,
          action: "IMPORT_CREATE",
          newValue: cpf,
          userId: options.userId ?? null,
        });
        results.push({ ...validation, action: "create" });
      }
    } catch (e) {
      results.push({
        ...validation,
        valid: false,
        action: "skip",
        errors: [...validation.errors, e instanceof Error ? e.message : "Erro ao gravar."],
      });
    }
    lineNum++;
  }

  const summary = summarizeRows("apply", results);
  summary.created = results.filter((r) => r.valid && r.action === "create").length;
  summary.updated = results.filter((r) => r.valid && r.action === "update").length;
  return summary;
}

export function vehicleImportCsvTemplate(): string {
  return [
    "placa;marca;modelo;origem;status;km_atual;unidade;centro_custo",
    "ABC1D23;Ford;Ranger;OWNED;AVAILABLE;15000;SP;CC-FROTA",
  ].join("\n");
}

export function driverImportCsvTemplate(): string {
  return [
    "nome;cpf;categoria_cnh;cnh_validade;status;unidade;centro_custo",
    "João Silva;12345678901;B;2027-12-31;PENDING;SP;CC-FROTA",
  ].join("\n");
}
