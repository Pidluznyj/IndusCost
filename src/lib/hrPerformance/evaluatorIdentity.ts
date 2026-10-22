/**
 * Identidade operacional do avaliador (Desempenho e Cultura).
 *
 * Regra do módulo: quem responde avaliações é a conta ATIVA ligada ao colaborador por
 * `AppUser.employeeId`. É o mesmo vínculo que `loadScope` usa para montar "Minha equipe" e que
 * as rotas de respostas comparam com `evaluatorEmployeeId` — uma única identidade operacional.
 *
 * Esta classificação NÃO concede acesso: a Pessoa canônica serve só para explicar POR QUE um
 * avaliador não está apto e qual regularização resolve (conta existente da mesma Pessoa sem
 * `employeeId`, conta inativa, conflito). Nome e e-mail nunca entram na decisão.
 */

export type EvaluatorIdentityStatus =
  /** Conta ativa ligada ao colaborador: responde avaliações. */
  | "LINKED"
  /** Conta ativa da MESMA Pessoa canônica, sem `employeeId`: regularizar em Pessoas 360° (auditado). */
  | "ACCOUNT_NOT_LINKED"
  /** A única conta encontrada está inativa: reativar em Usuários (e regularizar se faltar o vínculo). */
  | "ACCOUNT_INACTIVE"
  /** Conta da Pessoa ligada a OUTRO colaborador, ou Pessoa com mais de um colaborador: revisão humana. */
  | "IDENTITY_CONFLICT"
  /** Pessoa do colaborador inativa ou unificada: resolver a identidade antes. */
  | "PERSON_NOT_ACTIVE"
  /** Nenhuma conta para o colaborador nem para a Pessoa dele. Nunca se cria conta automaticamente. */
  | "NO_ACCOUNT";

export type EvaluatorIdentity = {
  employeeId: string;
  status: EvaluatorIdentityStatus;
  /** Conta envolvida (a ligada, a da mesma Pessoa ou a inativa); null quando não há. */
  accountId: string | null;
  /** Pessoa canônica do colaborador (para abrir a ficha em Pessoas 360°). */
  personId: string | null;
  /** Explicação curta, sem dados pessoais. */
  reason: string;
};

export type EvaluatorIdentityInput = {
  employeeId: string;
  employee: { id: string; personId: string | null } | null;
  /** Contas com `employeeId` = este colaborador (o campo é único: 0 ou 1). */
  directAccount: { id: string; isActive: boolean } | null;
  person: { id: string; status: string; employeeIds: string[] } | null;
  /** Conta com `personId` = Pessoa do colaborador (o campo é único: 0 ou 1). */
  personAccount: { id: string; isActive: boolean; employeeId: string | null } | null;
};

export function classifyEvaluatorIdentity(input: EvaluatorIdentityInput): EvaluatorIdentity {
  const base = { employeeId: input.employeeId, personId: input.employee?.personId ?? null };
  if (input.directAccount) {
    return input.directAccount.isActive
      ? { ...base, status: "LINKED", accountId: input.directAccount.id, reason: "Conta ativa ligada ao colaborador." }
      : { ...base, status: "ACCOUNT_INACTIVE", accountId: input.directAccount.id, reason: "A conta ligada ao colaborador está inativa." };
  }
  if (!input.employee) {
    return { ...base, status: "NO_ACCOUNT", accountId: null, reason: "Colaborador não encontrado no cadastro." };
  }
  if (!input.employee.personId || !input.person) {
    return { ...base, status: "NO_ACCOUNT", accountId: null, reason: "Sem conta ligada ao colaborador e sem Pessoa canônica para procurar uma conta existente." };
  }
  if (input.person.status !== "ACTIVE") {
    return {
      ...base,
      status: "PERSON_NOT_ACTIVE",
      accountId: input.personAccount?.id ?? null,
      reason:
        input.person.status === "MERGED"
          ? "A Pessoa do colaborador foi unificada em outra; corrija o vínculo do colaborador."
          : input.person.status === "NEEDS_REVIEW"
            ? "A identidade da Pessoa do colaborador está em revisão; conclua a revisão antes de regularizar a conta."
            : "A Pessoa do colaborador está inativa; reative-a (com justificativa) antes.",
    };
  }
  if (!input.personAccount) {
    return { ...base, status: "NO_ACCOUNT", accountId: null, reason: "A Pessoa não tem conta de acesso. Habilite o acesso pela ficha da Pessoa." };
  }
  if (input.personAccount.employeeId && input.personAccount.employeeId !== input.employeeId) {
    return { ...base, status: "IDENTITY_CONFLICT", accountId: input.personAccount.id, reason: "A conta desta Pessoa está ligada a outro colaborador." };
  }
  if (input.person.employeeIds.length > 1) {
    return { ...base, status: "IDENTITY_CONFLICT", accountId: input.personAccount.id, reason: "A Pessoa tem mais de um colaborador: escolha qual deles a conta representa." };
  }
  if (!input.personAccount.isActive) {
    return { ...base, status: "ACCOUNT_INACTIVE", accountId: input.personAccount.id, reason: "A conta desta Pessoa está inativa e não está ligada ao colaborador." };
  }
  return { ...base, status: "ACCOUNT_NOT_LINKED", accountId: input.personAccount.id, reason: "Conta ativa da mesma Pessoa, sem vínculo com o colaborador: regularize em Pessoas 360°." };
}

export const isEvaluatorUsable = (identity: EvaluatorIdentity | undefined) => identity?.status === "LINKED";
