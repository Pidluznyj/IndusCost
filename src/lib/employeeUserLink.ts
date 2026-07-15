/**
 * Estados e mensagens do vínculo Employee ↔ AppUser (puro, sem Prisma).
 */

export type EmployeeUserAccessState =
  | "none"
  | "available_match"
  | "linked"
  | "linked_inactive"
  | "conflict"
  | "email_mismatch";

export type UserLinkStatusBase = "linked" | "available_match" | "none" | "conflict";

export function mapToAccessState(input: {
  linkStatus: UserLinkStatusBase;
  linkedIsActive?: boolean | null;
  emailMismatch?: boolean;
}): EmployeeUserAccessState {
  if (input.emailMismatch && input.linkStatus === "linked") {
    return "email_mismatch";
  }
  if (input.linkStatus === "linked") {
    return input.linkedIsActive === false ? "linked_inactive" : "linked";
  }
  return input.linkStatus;
}

export function accessStateMessage(state: EmployeeUserAccessState): string {
  switch (state) {
    case "none":
      return "Sem usuário de acesso";
    case "available_match":
      return "Usuário disponível para vínculo";
    case "linked":
      return "Usuário vinculado";
    case "linked_inactive":
      return "Usuário vinculado (inativo)";
    case "conflict":
      return "Usuário vinculado a outra pessoa";
    case "email_mismatch":
      return "Conflito de e-mail: login diferente do e-mail corporativo";
    default:
      return state;
  }
}

export function accessStateBadgeClass(state: EmployeeUserAccessState): string {
  switch (state) {
    case "linked":
      return "bg-emerald-500/10 text-emerald-700";
    case "available_match":
      return "bg-sky-500/10 text-sky-800";
    case "linked_inactive":
    case "email_mismatch":
    case "conflict":
      return "bg-amber-500/10 text-amber-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}
