/**
 * Ciclo de vida do acesso (missão Pessoas 360°, entregas E1 e E3) — regras puras.
 *
 * E1: desligar um colaborador revoga o acesso da conta ligada a ele de forma confiável
 *     (`AppUser.employeeId`). Nunca por coincidência de nome ou e-mail.
 * E3: conta nunca é apagada fisicamente por padrão; é inativada com auditoria.
 *
 * Sem Prisma aqui: as decisões são testáveis em memória; a execução fica em
 * `userAccessLifecycle.server.ts`.
 */

export type LinkedUserSnapshot = {
  id: string;
  isActive: boolean;
  role: string;
};

export type TerminationRevocationDecision =
  | { action: "DEACTIVATE"; userId: string }
  | { action: "SKIP"; reason: "FLAG_DISABLED" | "NOT_A_TERMINATION" | "NO_LINKED_USER" | "ALREADY_INACTIVE" };

/** A transição ACTIVE → INACTIVE com data de desligamento é um desligamento efetivo. */
export function isEffectiveTermination(args: {
  previousStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  terminationDate: Date | string | null | undefined;
}): boolean {
  const prev = (args.previousStatus ?? "ACTIVE").trim().toUpperCase();
  const next = (args.nextStatus ?? "ACTIVE").trim().toUpperCase();
  return prev !== "INACTIVE" && next === "INACTIVE" && Boolean(args.terminationDate);
}

export function planTerminationAccessRevocation(args: {
  enabled: boolean;
  previousStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  terminationDate: Date | string | null | undefined;
  /** Conta ligada por `AppUser.employeeId` — a única referência confiável. */
  linkedUser: LinkedUserSnapshot | null;
}): TerminationRevocationDecision {
  if (!isEffectiveTermination(args)) return { action: "SKIP", reason: "NOT_A_TERMINATION" };
  if (!args.enabled) return { action: "SKIP", reason: "FLAG_DISABLED" };
  if (!args.linkedUser) return { action: "SKIP", reason: "NO_LINKED_USER" };
  if (!args.linkedUser.isActive) return { action: "SKIP", reason: "ALREADY_INACTIVE" };
  return { action: "DEACTIVATE", userId: args.linkedUser.id };
}

/** Flag de homologação: `HR_TERMINATION_REVOKES_ACCESS=1|true|yes`. Desligada por padrão. */
export function parseTerminationRevokesAccessFlag(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** Snapshot do ator/alvo que vai ao metadata da auditoria (nunca credenciais). */
export function userAuditSnapshot(user: { id: string; name: string; email: string; role: string }) {
  return { userId: user.id, userName: user.name, userEmail: user.email, userRole: user.role };
}
