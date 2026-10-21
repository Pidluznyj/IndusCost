/**
 * Pessoas 360° — "Habilitar motorista": decisão PURA. Nome, CPF e contatos vêm da Pessoa;
 * CNH, unidade, centro de custo e situação são da Frota. Um motorista não-INACTIVE por Pessoa.
 * CPF inválido ou ambíguo (duas Pessoas) nunca é resolvido em silêncio.
 */
import { isValidCpf } from "@/src/lib/fleetCpfUtils.js";

export type DriverCandidate = { id: string; name: string; status: string; personId: string | null; cpf: string };

export type DriverEnableAction = "CREATE" | "LINK" | "REACTIVATE" | "ALREADY_ENABLED" | "CONFLICT" | "BLOCKED";

export type DriverEnablePlan = {
  action: DriverEnableAction;
  /** Motorista afetado por LINK/REACTIVATE/ALREADY_ENABLED/CONFLICT. */
  driverId: string | null;
  blockers: Array<{ code: string; message: string }>;
};

export function planDriverEnable(args: {
  person: { id: string; status: string; cpfNormalized: string | null };
  /** Outras Pessoas não unificadas com o mesmo CPF. */
  duplicatePersonCount: number;
  /** Motoristas com o CPF da Pessoa OU já ligados à Pessoa (todos os status). */
  drivers: DriverCandidate[];
}): DriverEnablePlan {
  const blockers: DriverEnablePlan["blockers"] = [];
  const cpf = args.person.cpfNormalized ?? "";
  if (args.person.status === "MERGED") blockers.push({ code: "PERSON_MERGED", message: "Pessoa unificada em outra: habilite o motorista na pessoa que ficou." });
  if (args.person.status === "INACTIVE") blockers.push({ code: "PERSON_INACTIVE", message: "Pessoa inativa: reative-a (com justificativa) antes de habilitar o motorista." });
  if (!cpf || !isValidCpf(cpf)) blockers.push({ code: "CPF_INVALID", message: "A Pessoa precisa ter um CPF válido (dígitos verificadores) para ser motorista." });
  if (args.duplicatePersonCount > 0) blockers.push({ code: "DUPLICATE_PERSON_CPF", message: "Há outra Pessoa com o mesmo CPF. Unifique as duas antes de habilitar o motorista." });

  const linked = args.drivers.filter((d) => d.personId === args.person.id);
  const activeLinked = linked.find((d) => d.status !== "INACTIVE");
  if (activeLinked) return { action: "ALREADY_ENABLED", driverId: activeLinked.id, blockers };

  const sameCpf = args.drivers.filter((d) => d.cpf.replace(/\D/g, "") === cpf);
  const otherPersonActive = sameCpf.find((d) => d.personId && d.personId !== args.person.id && d.status !== "INACTIVE");
  if (otherPersonActive) {
    blockers.push({ code: "OTHER_PERSON_LINKED", message: "Já existe motorista ativo com este CPF ligado a outra Pessoa. Corrija o vínculo em Pessoas 360°." });
    return { action: "CONFLICT", driverId: otherPersonActive.id, blockers };
  }
  if (blockers.length > 0) return { action: "BLOCKED", driverId: null, blockers };

  const unlinkedActive = sameCpf.find((d) => !d.personId && d.status !== "INACTIVE");
  if (unlinkedActive) return { action: "LINK", driverId: unlinkedActive.id, blockers };
  const inactive = [...linked, ...sameCpf].find((d) => d.status === "INACTIVE");
  if (inactive) return { action: "REACTIVATE", driverId: inactive.id, blockers };
  return { action: "CREATE", driverId: null, blockers };
}

export const CNH_CATEGORIES = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;

export type DriverFleetFields = {
  cnhNumber: string | null;
  cnhCategory: string | null;
  cnhExpirationDate: Date | null;
  unit: string | null;
  costCenter: string | null;
  notes: string | null;
};

/** Só campos da Frota; nome/CPF/contatos NUNCA vêm do corpo (são da Pessoa). */
export function parseDriverFleetFields(raw: unknown): DriverFleetFields {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const cat = text(body.cnhCategory, 3)?.toUpperCase() ?? null;
  if (cat && !(CNH_CATEGORIES as readonly string[]).includes(cat)) {
    throw new Error("Categoria de CNH inválida.");
  }
  let cnhExpirationDate: Date | null = null;
  if (body.cnhExpirationDate) {
    cnhExpirationDate = new Date(String(body.cnhExpirationDate));
    if (Number.isNaN(cnhExpirationDate.getTime())) throw new Error("Data de validade da CNH inválida.");
  }
  return {
    cnhNumber: text(body.cnhNumber, 30),
    cnhCategory: cat,
    cnhExpirationDate,
    unit: text(body.unit),
    costCenter: text(body.costCenter),
    notes: text(body.notes, 1000),
  };
}
