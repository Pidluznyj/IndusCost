/**
 * Ordenação determinística e mapeamento de eventos da timeline.
 */

import {
  PEOPLE_PROFILE_HISTORY_PAGE_SIZE,
  type PeopleHistoryCursor,
  type PeopleHistoryEventDto,
} from "./peopleProfileTypes.js";
import { historyEventLabel, parseIsoDate } from "./peopleProfileKpis.js";

export type HistorySortable = {
  id: string;
  effectiveDate: Date | string;
  createdAt: Date | string;
};

export function compareHistoryDesc(a: HistorySortable, b: HistorySortable): number {
  const ae = parseIsoDate(a.effectiveDate)?.getTime() ?? 0;
  const be = parseIsoDate(b.effectiveDate)?.getTime() ?? 0;
  if (be !== ae) return be - ae;
  const ac = parseIsoDate(a.createdAt)?.getTime() ?? 0;
  const bc = parseIsoDate(b.createdAt)?.getTime() ?? 0;
  if (bc !== ac) return bc - ac;
  return b.id.localeCompare(a.id);
}

export function paginateHistory<T extends HistorySortable>(
  rows: readonly T[],
  opts?: { cursor?: PeopleHistoryCursor | null; limit?: number }
): { items: T[]; nextCursor: PeopleHistoryCursor | null } {
  const limit = Math.min(Math.max(opts?.limit ?? PEOPLE_PROFILE_HISTORY_PAGE_SIZE, 1), 200);
  const sorted = [...rows].sort(compareHistoryDesc);
  let start = 0;
  if (opts?.cursor) {
    start = sorted.findIndex((row) => {
      const cmp = compareHistoryDesc(row, {
        id: opts.cursor!.id,
        effectiveDate: opts.cursor!.effectiveDate,
        createdAt: opts.cursor!.createdAt,
      });
      return cmp > 0;
    });
    if (start < 0) start = sorted.length;
    else {
      const cursorIdx = sorted.findIndex((row) => row.id === opts.cursor!.id);
      start = cursorIdx >= 0 ? cursorIdx + 1 : start;
    }
  }
  const slice = sorted.slice(start, start + limit);
  const last = slice[slice.length - 1];
  const hasMore = start + slice.length < sorted.length;
  return {
    items: slice,
    nextCursor:
      hasMore && last
        ? {
            id: last.id,
            effectiveDate: new Date(last.effectiveDate).toISOString(),
            createdAt: new Date(last.createdAt).toISOString(),
          }
        : null,
  };
}

export function buildHistorySummary(input: {
  eventType: string;
  previousRoleName?: string | null;
  newRoleName?: string | null;
  previousDepartment?: string | null;
  newDepartment?: string | null;
  previousCostCenter?: string | null;
  newCostCenter?: string | null;
  previousManagerName?: string | null;
  newManagerName?: string | null;
  previousContractType?: string | null;
  newContractType?: string | null;
  previousWorkSchedule?: string | null;
  newWorkSchedule?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  percentage?: number | null;
  includeAmounts?: boolean;
  previousAmount?: number | null;
  newAmount?: number | null;
}): { summary: string; fromLabel: string | null; toLabel: string | null } {
  const arrow = (from?: string | null, to?: string | null) => {
    const a = (from ?? "").trim();
    const b = (to ?? "").trim();
    if (a && b && a !== b) return { summary: `${a} → ${b}`, fromLabel: a, toLabel: b };
    if (b) return { summary: b, fromLabel: a || null, toLabel: b };
    if (a) return { summary: a, fromLabel: a, toLabel: null };
    return null;
  };

  switch (input.eventType) {
    case "PROMOTION":
    case "ROLE_CHANGE":
    case "INITIAL_STATE": {
      const hit = arrow(input.previousRoleName, input.newRoleName);
      if (hit) return hit;
      break;
    }
    case "DEPARTMENT_CHANGE": {
      const hit = arrow(input.previousDepartment, input.newDepartment);
      if (hit) return hit;
      break;
    }
    case "COST_CENTER_CHANGE": {
      const hit = arrow(input.previousCostCenter, input.newCostCenter);
      if (hit) return hit;
      break;
    }
    case "MANAGER_CHANGE": {
      const hit = arrow(input.previousManagerName, input.newManagerName);
      if (hit) return hit;
      break;
    }
    case "CONTRACT_CHANGE": {
      const hit = arrow(input.previousContractType, input.newContractType);
      if (hit) return hit;
      break;
    }
    case "WORK_SCHEDULE_CHANGE": {
      const hit = arrow(input.previousWorkSchedule, input.newWorkSchedule);
      if (hit) return hit;
      break;
    }
    case "TERMINATION":
    case "REHIRE": {
      const hit = arrow(input.previousStatus, input.newStatus);
      if (hit) return hit;
      break;
    }
    case "COMPENSATION_ADJUSTMENT": {
      const pct =
        input.percentage != null && Number.isFinite(Number(input.percentage))
          ? `${Number(input.percentage) > 0 ? "+" : ""}${Number(input.percentage).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
          : null;
      if (input.includeAmounts && input.previousAmount != null && input.newAmount != null) {
        const from = input.previousAmount.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        const to = input.newAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        return {
          summary: [pct, `${from} → ${to}`].filter(Boolean).join(" · "),
          fromLabel: from,
          toLabel: to,
        };
      }
      if (pct) return { summary: pct, fromLabel: null, toLabel: pct };
      return { summary: historyEventLabel("COMPENSATION_ADJUSTMENT"), fromLabel: null, toLabel: null };
    }
    default:
      break;
  }
  return { summary: historyEventLabel(input.eventType), fromLabel: null, toLabel: null };
}

export function toHistoryEventDto(
  row: {
    id: string;
    eventType: string;
    effectiveDate: Date | string;
    createdAt: Date | string;
    source: string;
    reason?: string | null;
    notes?: string | null;
    previousRoleName?: string | null;
    newRoleName?: string | null;
    previousDepartment?: string | null;
    newDepartment?: string | null;
    previousCostCenter?: string | null;
    newCostCenter?: string | null;
    previousManagerName?: string | null;
    newManagerName?: string | null;
    previousContractType?: string | null;
    newContractType?: string | null;
    previousWorkSchedule?: string | null;
    newWorkSchedule?: string | null;
    previousStatus?: string | null;
    newStatus?: string | null;
    createdByUserId?: string | null;
    createdByName?: string | null;
    percentage?: number | null;
    previousAmount?: number | null;
    newAmount?: number | null;
    differenceAmount?: number | null;
  },
  opts: { includeAmounts: boolean }
): PeopleHistoryEventDto {
  const mapped = buildHistorySummary({
    eventType: row.eventType,
    previousRoleName: row.previousRoleName,
    newRoleName: row.newRoleName,
    previousDepartment: row.previousDepartment,
    newDepartment: row.newDepartment,
    previousCostCenter: row.previousCostCenter,
    newCostCenter: row.newCostCenter,
    previousManagerName: row.previousManagerName,
    newManagerName: row.newManagerName,
    previousContractType: row.previousContractType,
    newContractType: row.newContractType,
    previousWorkSchedule: row.previousWorkSchedule,
    newWorkSchedule: row.newWorkSchedule,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    percentage: row.percentage,
    includeAmounts: opts.includeAmounts,
    previousAmount: row.previousAmount,
    newAmount: row.newAmount,
  });

  const dto: PeopleHistoryEventDto = {
    id: row.id,
    eventType: row.eventType,
    eventLabel: historyEventLabel(row.eventType),
    effectiveDate: new Date(row.effectiveDate).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    source: row.source,
    reason: row.reason ?? null,
    notes: row.notes ?? null,
    summary: mapped.summary,
    fromLabel: mapped.fromLabel,
    toLabel: mapped.toLabel,
    percentage: row.percentage ?? null,
    previousAmount: null,
    newAmount: null,
    differenceAmount: null,
    createdByUserId: row.createdByUserId ?? null,
    createdByName: row.createdByName ?? null,
  };

  if (opts.includeAmounts && row.eventType === "COMPENSATION_ADJUSTMENT") {
    dto.previousAmount = row.previousAmount ?? null;
    dto.newAmount = row.newAmount ?? null;
    dto.differenceAmount = row.differenceAmount ?? null;
  } else {
    delete (dto as { previousAmount?: number | null }).previousAmount;
    delete (dto as { newAmount?: number | null }).newAmount;
    delete (dto as { differenceAmount?: number | null }).differenceAmount;
  }

  return dto;
}

export type SnapshotForDiff = {
  roleId: string;
  roleName: string | null;
  departmentId: string | null;
  department: string | null;
  costCenterId: string | null;
  costCenter: string | null;
  managerId: string | null;
  managerName: string | null;
  contractType: string | null;
  workSchedule: string | null;
  status: string | null;
  salary: number | null;
  admissionDate: Date | string | null;
  terminationDate: Date | string | null;
};

export type SnapshotDiffEvent = {
  eventType: string;
  previousRoleId?: string | null;
  newRoleId?: string | null;
  previousRoleName?: string | null;
  newRoleName?: string | null;
  previousDepartmentId?: string | null;
  newDepartmentId?: string | null;
  previousDepartment?: string | null;
  newDepartment?: string | null;
  previousCostCenterId?: string | null;
  newCostCenterId?: string | null;
  previousCostCenter?: string | null;
  newCostCenter?: string | null;
  previousManagerId?: string | null;
  newManagerId?: string | null;
  previousManagerName?: string | null;
  newManagerName?: string | null;
  previousContractType?: string | null;
  newContractType?: string | null;
  previousWorkSchedule?: string | null;
  newWorkSchedule?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  salaryChanged?: boolean;
  previousSalary?: number | null;
  newSalary?: number | null;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function idEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

export function diffEmployeeSnapshots(
  previous: SnapshotForDiff,
  next: SnapshotForDiff
): SnapshotDiffEvent[] {
  const events: SnapshotDiffEvent[] = [];

  if (!idEq(previous.roleId, next.roleId)) {
    events.push({
      eventType: "ROLE_CHANGE",
      previousRoleId: previous.roleId,
      newRoleId: next.roleId,
      previousRoleName: previous.roleName,
      newRoleName: next.roleName,
    });
  }
  if (!idEq(previous.departmentId, next.departmentId) || norm(previous.department) !== norm(next.department)) {
    events.push({
      eventType: "DEPARTMENT_CHANGE",
      previousDepartmentId: previous.departmentId,
      newDepartmentId: next.departmentId,
      previousDepartment: previous.department,
      newDepartment: next.department,
    });
  }
  if (!idEq(previous.costCenterId, next.costCenterId) || norm(previous.costCenter) !== norm(next.costCenter)) {
    events.push({
      eventType: "COST_CENTER_CHANGE",
      previousCostCenterId: previous.costCenterId,
      newCostCenterId: next.costCenterId,
      previousCostCenter: previous.costCenter,
      newCostCenter: next.costCenter,
    });
  }
  if (!idEq(previous.managerId, next.managerId)) {
    events.push({
      eventType: "MANAGER_CHANGE",
      previousManagerId: previous.managerId,
      newManagerId: next.managerId,
      previousManagerName: previous.managerName,
      newManagerName: next.managerName,
    });
  }
  if (norm(previous.contractType) !== norm(next.contractType)) {
    events.push({
      eventType: "CONTRACT_CHANGE",
      previousContractType: previous.contractType,
      newContractType: next.contractType,
    });
  }
  if (norm(previous.workSchedule) !== norm(next.workSchedule)) {
    events.push({
      eventType: "WORK_SCHEDULE_CHANGE",
      previousWorkSchedule: previous.workSchedule,
      newWorkSchedule: next.workSchedule,
    });
  }

  const prevStatus = (previous.status ?? "ACTIVE").toUpperCase();
  const nextStatus = (next.status ?? "ACTIVE").toUpperCase();
  if (prevStatus !== nextStatus) {
    const terminated = nextStatus === "TERMINATED" || (nextStatus === "INACTIVE" && Boolean(next.terminationDate));
    const inactivated = nextStatus === "INACTIVE";
    const rehire = (prevStatus === "TERMINATED" || prevStatus === "INACTIVE") && nextStatus === "ACTIVE";
    let eventType = "ROLE_CHANGE";
    if (rehire) eventType = "REHIRE";
    else if (terminated || inactivated) eventType = "TERMINATION";
    else if (nextStatus === "VACATION") eventType = "VACATION_START";
    else if (nextStatus === "ON_LEAVE") eventType = "LEAVE_START";
    else if (prevStatus === "VACATION" && nextStatus === "ACTIVE") eventType = "VACATION_END";
    else if (prevStatus === "ON_LEAVE" && nextStatus === "ACTIVE") eventType = "RETURN_TO_WORK";
    events.push({
      eventType,
      previousStatus: prevStatus,
      newStatus: nextStatus,
    });
  }

  const prevSal = Number(previous.salary);
  const nextSal = Number(next.salary);
  if (Number.isFinite(prevSal) && Number.isFinite(nextSal) && prevSal !== nextSal) {
    events.push({
      eventType: "COMPENSATION_ADJUSTMENT",
      salaryChanged: true,
      previousSalary: prevSal,
      newSalary: nextSal,
    });
  }

  return events;
}

export function encodeHistoryCursor(cursor: PeopleHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeHistoryCursor(raw: unknown): PeopleHistoryCursor | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PeopleHistoryCursor;
    if (!parsed?.id || !parsed.effectiveDate || !parsed.createdAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Keyset para ORDER BY effectiveDate DESC, createdAt DESC, id DESC.
 * Evita cursor Prisma por id global (IDOR / skip duplo).
 */
export function buildHistoryKeysetWhere(cursor: PeopleHistoryCursor | null): {
  OR: Array<Record<string, unknown>>;
} | undefined {
  if (!cursor) return undefined;
  const effectiveDate = new Date(cursor.effectiveDate);
  const createdAt = new Date(cursor.createdAt);
  if (Number.isNaN(effectiveDate.getTime()) || Number.isNaN(createdAt.getTime())) return undefined;
  return {
    OR: [
      { effectiveDate: { lt: effectiveDate } },
      { effectiveDate, createdAt: { lt: createdAt } },
      { effectiveDate, createdAt, id: { lt: cursor.id } },
    ],
  };
}
