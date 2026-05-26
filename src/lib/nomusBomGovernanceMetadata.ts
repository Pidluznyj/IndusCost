import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";

export const NOMUS_BOM_SOURCE_SYSTEM = "NOMUS";

export type NomusBomLineGovernanceSnapshot = {
  sourceSystem: string | null;
  isNomusControlled: boolean;
  nomusComponentCode: string | null;
  lastNomusSyncAt: Date | null;
  lossPercentage: number | null;
  localException?: boolean;
};

export type NomusBomGovernanceTarget = {
  componentCode: string;
  syncedAt?: Date | null;
};

export function buildNomusControlledBomMetadata(
  target: NomusBomGovernanceTarget,
  appliedAt: Date = new Date()
): {
  sourceSystem: string;
  isNomusControlled: true;
  nomusComponentCode: string;
  lastNomusSyncAt: Date;
  lossPercentage: 0;
} {
  return {
    sourceSystem: NOMUS_BOM_SOURCE_SYSTEM,
    isNomusControlled: true,
    nomusComponentCode: target.componentCode.trim(),
    lastNomusSyncAt: target.syncedAt ?? appliedAt,
    lossPercentage: 0,
  };
}

/** Linha local/exceção não recebe governança Nomus automática. */
export function isNomusGovernanceEligible(row: Pick<NomusBomLineGovernanceSnapshot, "localException">): boolean {
  return row.localException !== true;
}

export function needsNomusBomMetadataUpdate(
  row: NomusBomLineGovernanceSnapshot,
  target: NomusBomGovernanceTarget
): boolean {
  if (!isNomusGovernanceEligible(row)) return false;

  const expectedCode = normalizeComponentCode(target.componentCode);
  const currentCode = normalizeComponentCode(row.nomusComponentCode ?? "");

  if (row.sourceSystem !== NOMUS_BOM_SOURCE_SYSTEM) return true;
  if (row.isNomusControlled !== true) return true;
  if (!currentCode || currentCode !== expectedCode) return true;
  if (row.lastNomusSyncAt == null) return true;

  const loss = row.lossPercentage ?? 0;
  if (Math.abs(loss) > 1e-9) return true;

  return false;
}

export function describeNomusBomMetadataGap(
  row: NomusBomLineGovernanceSnapshot,
  target: NomusBomGovernanceTarget
): string[] {
  if (!isNomusGovernanceEligible(row)) return [];

  const gaps: string[] = [];
  const expectedCode = normalizeComponentCode(target.componentCode);

  if (row.sourceSystem !== NOMUS_BOM_SOURCE_SYSTEM) {
    gaps.push(`sourceSystem=${row.sourceSystem ?? "null"} → NOMUS`);
  }
  if (row.isNomusControlled !== true) {
    gaps.push(`isNomusControlled=${String(row.isNomusControlled)} → true`);
  }
  const currentCode = row.nomusComponentCode ?? "";
  if (normalizeComponentCode(currentCode) !== expectedCode) {
    gaps.push(`nomusComponentCode=${currentCode || "null"} → ${target.componentCode}`);
  }
  if (row.lastNomusSyncAt == null) {
    gaps.push("lastNomusSyncAt=null → (sync/aplicação)");
  }
  const loss = row.lossPercentage ?? 0;
  if (Math.abs(loss) > 1e-9) {
    gaps.push(`lossPercentage=${loss} → 0`);
  }

  return gaps;
}

export const NOMUS_BOM_METADATA_UPDATE_REASON =
  "Linha marcada como controlada pelo Nomus após sincronização automática.";
