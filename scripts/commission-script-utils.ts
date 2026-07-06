import type { Prisma } from "@prisma/client";
import {
  activeCommissionRecordWhere,
  INACTIVE_COMMISSION_RECORD_STATUSES,
} from "../src/lib/commissions/commission-record-status.ts";
import { hasFlag, parseArg, parseYearPeriod } from "./commission-audit-args.ts";

export { parseArg, hasFlag, parseYearPeriod, requireDatabaseUrl } from "./commission-audit-args.ts";
export {
  activeCommissionRecordWhere,
  INACTIVE_COMMISSION_RECORD_STATUSES,
} from "../src/lib/commissions/commission-record-status.ts";

export type ScriptMode = "preview" | "apply";

export function parseScriptMode(): ScriptMode {
  const preview = hasFlag("preview") || hasFlag("dry-run");
  const apply = hasFlag("apply");
  if (!preview && !apply) {
    throw new Error("Informe --preview (ou --dry-run) ou --apply.");
  }
  if (preview && apply) {
    throw new Error("Use apenas um modo: --preview/--dry-run ou --apply.");
  }
  return preview ? "preview" : "apply";
}

export function fmtBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function fmtPct(part: number, total: number): string {
  if (total <= 0) return "0,0%";
  return `${((part / total) * 100).toFixed(1).replace(".", ",")}%`;
}

export function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type ReadinessLevel = "OK" | "ALERTA" | "BLOQUEANTE";

export type ReadinessFinding = {
  level: ReadinessLevel;
  code: string;
  message: string;
};

export function printFindings(findings: ReadinessFinding[]): void {
  const order: ReadinessLevel[] = ["BLOQUEANTE", "ALERTA", "OK"];
  for (const level of order) {
    const items = findings.filter((f) => f.level === level);
    if (items.length === 0) continue;
    console.log(`\n[${level}]`);
    for (const item of items) {
      console.log(`  • ${item.code}: ${item.message}`);
    }
  }
}

export function hasBlockingFindings(findings: ReadinessFinding[]): boolean {
  return findings.some((f) => f.level === "BLOQUEANTE");
}

export function periodWhere(
  period: { from: Date; to: Date }
): Prisma.CommissionRecordWhereInput {
  return activeCommissionRecordWhere(period);
}

export function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(cols: unknown[]): string {
  return cols.map(escapeCsv).join(",");
}
