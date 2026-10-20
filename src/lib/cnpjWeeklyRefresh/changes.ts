import { createHash } from "node:crypto";
import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import type { CommercialRiskResult } from "@/src/lib/companyCommercialRiskScore.js";

export type CnpjCadastreChangeDraft = {
  field: string;
  previousValue: string | null;
  nextValue: string | null;
};

const EMPTY = new Set(["", "—", "-"]);

function blank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return EMPTY.has(value.trim());
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function text(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function partnerFingerprint(summary: NormalizedCnpjSummary): string {
  const rows = summary.partners
    .map((partner) => `${text(partner.role)}`)
    .sort();
  const hash = createHash("sha256")
    .update(summary.partners.map((partner) => text(partner.name)).sort().join("|"))
    .digest("hex")
    .slice(0, 12);
  return `quantidade=${summary.partners.length};papeis=${rows.join(",") || "nenhum"};ref=${hash}`;
}

/**
 * Mantém valor já confiável quando a consulta nova veio incompleta.
 * Uma resposta vazia por falha não apaga situação, razão social, CNAE ou quadro já gravados.
 */
export function retainTrustedCadastralFields(
  previous: NormalizedCnpjSummary | null,
  incoming: NormalizedCnpjSummary,
  partial: boolean
): NormalizedCnpjSummary {
  if (!previous || !partial) return incoming;
  const next: NormalizedCnpjSummary = { ...incoming, partners: [...incoming.partners], secondaryCnaes: [...incoming.secondaryCnaes] };
  const scalars: (keyof NormalizedCnpjSummary)[] = [
    "companyName",
    "tradeName",
    "registrationStatus",
    "registrationStatusNormalized",
    "openedAt",
    "companySize",
    "legalNature",
    "shareCapital",
    "address",
    "addressNumber",
    "addressComplement",
    "district",
    "city",
    "state",
    "zipCode",
    "establishmentType",
    "sourceUpdatedAt",
  ];
  for (const key of scalars) {
    if (blank(next[key]) && !blank(previous[key])) {
      (next as unknown as Record<string, unknown>)[key] = previous[key];
    }
  }
  if (next.partners.length === 0 && previous.partners.length > 0) next.partners = previous.partners;
  if (next.secondaryCnaes.length === 0 && previous.secondaryCnaes.length > 0) {
    next.secondaryCnaes = previous.secondaryCnaes;
  }
  if (blank(next.mainCnae?.code) && previous.mainCnae) next.mainCnae = previous.mainCnae;
  next.hasPartners = next.partners.length > 0;
  return next;
}

function pushChange(
  changes: CnpjCadastreChangeDraft[],
  field: string,
  previousValue: string | null,
  nextValue: string | null
) {
  if ((previousValue ?? "") === (nextValue ?? "")) return;
  changes.push({ field, previousValue, nextValue });
}

export function detectRelevantCadastralChanges(input: {
  previous: NormalizedCnpjSummary | null;
  next: NormalizedCnpjSummary;
  previousScore: number | null;
  nextScore: number;
  previousVerdict: string | null;
  nextVerdict: string;
}): CnpjCadastreChangeDraft[] {
  const changes: CnpjCadastreChangeDraft[] = [];
  const previous = input.previous;
  if (!previous) {
    pushChange(changes, "registrationStatus", null, input.next.registrationStatusNormalized);
    return changes.filter((change) => change.nextValue);
  }

  pushChange(
    changes,
    "registrationStatus",
    previous.registrationStatusNormalized,
    input.next.registrationStatusNormalized
  );
  if (text(previous.companyName) !== text(input.next.companyName)) {
    pushChange(changes, "companyName", previous.companyName, input.next.companyName);
  }
  if (partnerFingerprint(previous) !== partnerFingerprint(input.next)) {
    pushChange(changes, "partners", partnerFingerprint(previous), partnerFingerprint(input.next));
  }
  if ((previous.mainCnae?.code ?? "") !== (input.next.mainCnae?.code ?? "")) {
    pushChange(changes, "mainCnae", previous.mainCnae?.code ?? null, input.next.mainCnae?.code ?? null);
  }
  if (text(previous.companySize) !== text(input.next.companySize)) {
    pushChange(changes, "companySize", previous.companySize, input.next.companySize);
  }
  if (previous.establishmentType !== input.next.establishmentType) {
    pushChange(changes, "establishmentType", previous.establishmentType, input.next.establishmentType);
  }
  const previousCapital = previous.shareCapital;
  const nextCapital = input.next.shareCapital;
  if (previousCapital != null && nextCapital != null && previousCapital !== nextCapital) {
    const base = Math.max(Math.abs(previousCapital), 1);
    if (Math.abs(nextCapital - previousCapital) / base >= 0.1) {
      pushChange(changes, "shareCapital", String(previousCapital), String(nextCapital));
    }
  } else if ((previousCapital == null) !== (nextCapital == null)) {
    pushChange(
      changes,
      "shareCapital",
      previousCapital == null ? null : String(previousCapital),
      nextCapital == null ? null : String(nextCapital)
    );
  }
  const scoreDelta = Math.abs(input.nextScore - (input.previousScore ?? input.nextScore));
  if (scoreDelta >= 10 || (input.previousVerdict != null && input.previousVerdict !== input.nextVerdict)) {
    pushChange(
      changes,
      "cadastralScore",
      input.previousScore == null ? null : `${input.previousScore} ${input.previousVerdict ?? ""}`.trim(),
      `${input.nextScore} ${input.nextVerdict}`
    );
  }
  return changes;
}

export function scoreLabel(risk: CommercialRiskResult): string {
  return `${risk.score} ${risk.verdict}`;
}
