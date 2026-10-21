/**
 * Pessoas 360° v1.1 — regras puras das operações de escrita (vincular, corrigir, desvincular,
 * unificar). Sem Prisma: testável em memória; a execução transacional fica em
 * `personLinkOps.server.ts`.
 *
 * Princípios (auditoria §11–§12): nunca unificar por nome ou só por e-mail; CPF validado
 * divergente bloqueia; nada operacional muda — só `personId` dos vínculos.
 */

export type LinkEntityKind = "employee" | "app_user" | "fleet_driver" | "commission_person";

export type IdentityForMerge = {
  id: string;
  displayName: string;
  status: string;
  cpfNormalized: string | null;
  corporateEmail: string | null;
  employeeIds: string[];
  activeUserIds: string[];
  inactiveUserIds: string[];
  fleetDriverIds: string[];
  commissionPersonIds: string[];
  customerIdentityIds: string[];
  customerContactIds: string[];
};

export type MergeEvidence = "CPF_EXACT" | "EMAIL_EXACT" | "MANUAL";

export type MergeBlocker = {
  code: "CPF_DIVERGENT" | "SAME_PERSON" | "LOSER_MERGED" | "WINNER_MERGED" | "TWO_EMPLOYEES" | "TWO_ACTIVE_USERS" | "TWO_USERS";
  message: string;
};

export type MergePlan = {
  winnerId: string;
  loserId: string;
  evidence: MergeEvidence;
  blockers: MergeBlocker[];
  moves: Array<{ entityKind: LinkEntityKind | "customer_identity" | "customer_contact"; entityId: string }>;
  fillFromLoser: Array<"cpfNormalized" | "corporateEmail">;
  unchanged: string[];
};

export function mergeEvidence(a: IdentityForMerge, b: IdentityForMerge): MergeEvidence {
  if (a.cpfNormalized && b.cpfNormalized && a.cpfNormalized === b.cpfNormalized) return "CPF_EXACT";
  const ea = (a.corporateEmail ?? "").toLowerCase();
  const eb = (b.corporateEmail ?? "").toLowerCase();
  if (ea && eb && ea === eb) return "EMAIL_EXACT";
  return "MANUAL";
}

/** Plano de unificação: tudo que será religado e tudo que bloqueia. Puro. */
export function planPersonMerge(winner: IdentityForMerge, loser: IdentityForMerge): MergePlan {
  const blockers: MergeBlocker[] = [];
  if (winner.id === loser.id) blockers.push({ code: "SAME_PERSON", message: "Escolha duas pessoas diferentes." });
  if (loser.status === "MERGED") blockers.push({ code: "LOSER_MERGED", message: "A pessoa absorvida já foi unificada." });
  if (winner.status === "MERGED") blockers.push({ code: "WINNER_MERGED", message: "A pessoa que fica já foi unificada em outra; escolha a pessoa final." });
  if (winner.cpfNormalized && loser.cpfNormalized && winner.cpfNormalized !== loser.cpfNormalized) {
    blockers.push({ code: "CPF_DIVERGENT", message: "As duas pessoas têm CPFs validados diferentes: não são a mesma pessoa física." });
  }
  if (winner.employeeIds.length > 0 && loser.employeeIds.length > 0) {
    blockers.push({ code: "TWO_EMPLOYEES", message: "As duas pessoas têm colaborador. Uma pessoa só pode ter um colaborador; corrija o cadastro de RH antes." });
  }
  if (winner.activeUserIds.length > 0 && loser.activeUserIds.length > 0) {
    blockers.push({ code: "TWO_ACTIVE_USERS", message: "As duas pessoas têm conta ativa. Inative uma delas em Configurações › Usuários antes de unificar." });
  }
  if (winner.activeUserIds.length + winner.inactiveUserIds.length > 0 && loser.activeUserIds.length + loser.inactiveUserIds.length > 0) {
    blockers.push({ code: "TWO_USERS", message: "As duas pessoas têm conta de acesso. Uma pessoa só pode ter uma conta; resolva pela correção de vínculo do usuário." });
  }
  const moves: MergePlan["moves"] = [
    ...loser.employeeIds.map((id) => ({ entityKind: "employee" as const, entityId: id })),
    ...[...loser.activeUserIds, ...loser.inactiveUserIds].map((id) => ({ entityKind: "app_user" as const, entityId: id })),
    ...loser.fleetDriverIds.map((id) => ({ entityKind: "fleet_driver" as const, entityId: id })),
    ...loser.commissionPersonIds.map((id) => ({ entityKind: "commission_person" as const, entityId: id })),
    ...loser.customerIdentityIds.map((id) => ({ entityKind: "customer_identity" as const, entityId: id })),
    ...loser.customerContactIds.map((id) => ({ entityKind: "customer_contact" as const, entityId: id })),
  ];
  const fillFromLoser: MergePlan["fillFromLoser"] = [];
  if (!winner.cpfNormalized && loser.cpfNormalized) fillFromLoser.push("cpfNormalized");
  if (!winner.corporateEmail && loser.corporateEmail) fillFromLoser.push("corporateEmail");
  return {
    winnerId: winner.id,
    loserId: loser.id,
    evidence: mergeEvidence(winner, loser),
    blockers,
    moves,
    fillFromLoser,
    unchanged: [
      "IDs de colaborador, usuário, motorista, comissionável e cliente",
      "Permissões, sessões e senha da conta",
      "Comissões, lotes, aliases e ids Nomus",
      "Documentos, avaliações, EPIs e históricos (continuam por colaborador)",
      "Auditorias e eventos já gravados",
    ],
  };
}

export type RelinkDecision =
  | { ok: true; kind: "LINK" | "RELINK"; fromPersonId: string | null }
  | { ok: false; code: "STALE" | "SAME" | "TARGET_MERGED" | "TARGET_INACTIVE" | "TARGET_HAS_EMPLOYEE" | "TARGET_HAS_USER" | "UNAUTHORIZED_USER_RELINK"; message: string; status: 403 | 409 };

/** Decisão de vínculo/correção de um registro para uma Pessoa-alvo. Puro. */
export function decideRelink(args: {
  entityKind: LinkEntityKind;
  currentPersonId: string | null;
  expectedCurrentPersonId: string | null | undefined;
  targetPersonId: string;
  targetStatus: string;
  targetHasEmployee: boolean;
  targetHasUser: boolean;
}): RelinkDecision {
  if (args.expectedCurrentPersonId !== undefined && args.expectedCurrentPersonId !== args.currentPersonId) {
    return { ok: false, code: "STALE", status: 409, message: "O registro mudou desde a prévia. Recarregue e confira antes de confirmar." };
  }
  if (args.currentPersonId === args.targetPersonId) {
    return { ok: false, code: "SAME", status: 409, message: "O registro já aponta para esta pessoa." };
  }
  if (args.targetStatus === "MERGED") {
    return { ok: false, code: "TARGET_MERGED", status: 409, message: "A pessoa escolhida foi unificada em outra. Selecione a pessoa final." };
  }
  if (args.targetStatus === "INACTIVE") {
    return { ok: false, code: "TARGET_INACTIVE", status: 409, message: "A pessoa escolhida está inativa. Reative a Pessoa (com justificativa) antes de vincular cadastros a ela." };
  }
  if (args.entityKind === "employee" && args.targetHasEmployee) {
    return { ok: false, code: "TARGET_HAS_EMPLOYEE", status: 409, message: "Esta pessoa já tem um colaborador vinculado." };
  }
  if (args.entityKind === "app_user" && args.targetHasUser) {
    return { ok: false, code: "TARGET_HAS_USER", status: 409, message: "Esta pessoa já tem uma conta de acesso vinculada." };
  }
  return { ok: true, kind: args.currentPersonId ? "RELINK" : "LINK", fromPersonId: args.currentPersonId };
}

export function isValidLinkEntityKind(value: unknown): value is LinkEntityKind {
  return value === "employee" || value === "app_user" || value === "fleet_driver" || value === "commission_person";
}
