import { createHash } from "node:crypto";
import { normalizeComponentCode, normalizeSku, toNumberSafe, chooseEffectiveNomusList } from "@/src/lib/nomusBomComparison";
import { loadNomusStageLinesForParent } from "@/src/lib/nomusBomComparisonLoad";
import type { NomusEffectiveBomLine } from "@/src/lib/nomusBomComparison";

export type NomusStructureLineFingerprint = {
  componentCode: string;
  quantity: number | null;
  opcional: boolean;
  alternativo: boolean;
  preferencial: boolean;
  perdaNormal: number | null;
};

function roundQty(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Linhas estáveis da BOM Nomus efetiva — sem ids voláteis de batch/sync. */
export function buildNomusStructureLineFingerprints(
  lines: NomusEffectiveBomLine[]
): NomusStructureLineFingerprint[] {
  const aggregated = new Map<string, NomusStructureLineFingerprint>();

  for (const line of lines) {
    const key = normalizeComponentCode(line.componentCode);
    const qty = roundQty(line.quantity);
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantity = roundQty((existing.quantity ?? 0) + (qty ?? 0));
      existing.opcional = existing.opcional || line.opcional === true;
      existing.alternativo = existing.alternativo || line.alternativo === true;
      existing.preferencial = existing.preferencial || line.preferencial === true;
      continue;
    }
    aggregated.set(key, {
      componentCode: key,
      quantity: qty,
      opcional: line.opcional === true,
      alternativo: line.alternativo === true,
      preferencial: line.preferencial === true,
      perdaNormal: roundQty(line.lossQuantity),
    });
  }

  return [...aggregated.values()].sort((a, b) =>
    a.componentCode.localeCompare(b.componentCode, "pt-BR")
  );
}

export function buildNomusParentStructureFingerprint(input: {
  parentCode: string;
  listaMateriaisId?: number | null;
  lines: NomusStructureLineFingerprint[];
}): string {
  const payload = {
    parentCode: normalizeSku(input.parentCode),
    listaMateriaisId: input.listaMateriaisId ?? null,
    lines: input.lines.map((line) => ({
      code: line.componentCode,
      qty: line.quantity,
      opcional: line.opcional,
      alternativo: line.alternativo,
      preferencial: line.preferencial,
      perda: line.perdaNormal,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Fingerprint da estrutura Nomus efetiva atual do produto pai. */
export async function computeNomusParentStructureFingerprint(
  parentCode: string
): Promise<string | null> {
  const trimmed = parentCode.trim();
  const stageLines = await loadNomusStageLinesForParent(trimmed);
  if (stageLines.length === 0) return null;

  const listSelection = chooseEffectiveNomusList(stageLines);
  const fingerprints = buildNomusStructureLineFingerprints(listSelection.selectedLines);
  return buildNomusParentStructureFingerprint({
    parentCode: trimmed,
    listaMateriaisId: listSelection.selectedList?.listaMateriaisId ?? null,
    lines: fingerprints,
  });
}

/** Contexto de linha local ainda compatível com decisão salva (mesmo código + quantidade). */
export function localLineMatchesDecisionSnapshot(input: {
  componentCode: string;
  quantity: number | null | undefined;
  decision: {
    componentCode: string;
    quantitySnapshot: number | null;
  };
}): boolean {
  const codeMatch =
    normalizeComponentCode(input.componentCode) ===
    normalizeComponentCode(input.decision.componentCode);
  if (!codeMatch) return false;

  const currentQty = roundQty(toNumberSafe(input.quantity));
  const savedQty = roundQty(input.decision.quantitySnapshot);
  if (savedQty == null && currentQty == null) return true;
  if (savedQty == null || currentQty == null) return false;
  return Math.abs(savedQty - currentQty) < 0.000001;
}
