/**
 * Política única para mudar a identidade operacional de uma conta (`AppUser.employeeId` / `personId`).
 *
 * O `employeeId` da conta define o escopo de "Minha equipe", das respostas de avaliação e das demais
 * telas por liderança. Por isso todas as rotas que ligam, corrigem ou desligam esse vínculo
 * (Pessoas 360° e cadastro de RH) passam por aqui, para não divergirem:
 *
 * 0. Operação interativa sem usuário identificado: recusada (fail-closed, `ACTOR_REQUIRED`).
 * 1. Conta SUPER_ADMIN: só SUPER_ADMIN com step-up (regra E2 já existente).
 * 2. A própria conta: ninguém muda a própria identidade operacional — ganharia o escopo de outra
 *    pessoa sem um segundo par de olhos. Exceção: SUPER_ADMIN com step-up (já tem acesso total;
 *    a operação fica auditada).
 *
 * A política não concede nada: quem chega aqui já passou pela permissão efetiva da rota.
 * Rotinas internas não passam por aqui; as autorizadas estão em `ACCOUNT_IDENTITY_WRITERS`.
 */
import {
  SUPER_ADMIN_ROLE,
  evaluateSuperAdminAccountOperation,
  superAdminGuardDenial,
  type SuperAdminGuardActor,
  type SuperAdminGuardResult,
} from "./superAdminRoleGuard.js";

export type AccountIdentityTarget = { id: string; role: string | null | undefined };

export function evaluateAccountIdentityChange(args: { actor: SuperAdminGuardActor | null | undefined; account: AccountIdentityTarget }): SuperAdminGuardResult {
  const actor = args.actor ?? { id: null, role: null, elevated: false };
  if (!actor.id) {
    return { ok: false, code: "ACTOR_REQUIRED", status: 403, message: "Operação sem usuário identificado." };
  }
  const superAdmin = evaluateSuperAdminAccountOperation({ actor, targetRole: args.account.role });
  if (!superAdmin.ok) return superAdmin;
  if (actor.id === args.account.id && !(actor.role === SUPER_ADMIN_ROLE && actor.elevated)) {
    return {
      ok: false,
      code: "SELF_LINK_FORBIDDEN",
      status: 403,
      message: "Você não pode alterar o vínculo de identidade da sua própria conta. Peça a outro administrador.",
    };
  }
  return superAdmin;
}

/** Mesma decisão no formato de recusa ({ code, status, message } | null). */
export function accountIdentityChangeDenial(args: { actor: SuperAdminGuardActor | null | undefined; account: AccountIdentityTarget }) {
  return superAdminGuardDenial(evaluateAccountIdentityChange(args));
}

/**
 * Evidência suficiente para ligar conta e colaborador SEM prévia/justificativa (rota do RH):
 * a mesma Pessoa canônica nos dois lados. E-mail igual sozinho não basta — o e-mail corporativo é
 * editável por quem opera; nesse caso o caminho é a regularização de Pessoas 360° (prévia,
 * confirmação explícita, justificativa e auditoria).
 */
export function hasConfirmedAccountIdentity(args: { accountPersonId: string | null | undefined; employeePersonId: string | null | undefined }): boolean {
  return Boolean(args.accountPersonId && args.employeePersonId && args.accountPersonId === args.employeePersonId);
}

/**
 * Pôr um colaborador numa Pessoa que já tem conta SEM colaborador cria a evidência "mesma Pessoa"
 * para aquela conta — é uma mudança de identidade dela, mesmo sem gravar na linha da conta.
 * Exige a permissão efetiva de vínculo de usuários e a política acima (nunca a própria conta).
 * `affectedAccount` vem de `findAccountGainingEmployeeEvidence` (null = nada a decidir).
 */
export function employeePersonChangeDenial(args: {
  actor: SuperAdminGuardActor | null | undefined;
  canManageAccountIdentity: boolean;
  affectedAccount: AccountIdentityTarget | null;
}) {
  if (!args.affectedAccount) return null;
  if (!args.canManageAccountIdentity) {
    return {
      ok: false as const,
      code: "ACCOUNT_LINK_PERMISSION_REQUIRED",
      status: 403 as const,
      message: "Esta Pessoa tem uma conta de acesso sem colaborador: ligar o colaborador a ela muda a identidade da conta e exige a permissão de vínculo com usuário (RH).",
    };
  }
  return accountIdentityChangeDenial({ actor: args.actor, account: args.affectedAccount });
}

/**
 * Registro formal de quem grava `AppUser.employeeId` / `AppUser.personId` (o teste de fonte falha
 * se aparecer outro arquivo). Interativos passam pela política; rotinas internas têm a autorização
 * descrita aqui e não são alcançáveis por HTTP.
 */
export const ACCOUNT_IDENTITY_WRITERS = [
  { file: "src/lib/people/personLinkOps.server.ts", kind: "INTERACTIVE", authorization: "Pessoas 360° (regularizar, corrigir, desvincular): permissão efetiva de vínculo com usuário + esta política; unificar/reverter: SUPER_ADMIN com step-up." },
  { file: "src/lib/employeeUserLink.server.ts", kind: "INTERACTIVE", authorization: "Cadastro de RH (vincular/desvincular): permissão efetiva de vínculo com usuário + esta política + mesma Pessoa canônica." },
  { file: "src/lib/canonicalPersonSync.server.ts", kind: "INTERACTIVE_SIDE_EFFECT", authorization: "Efeito do PUT do colaborador (E4): permissão efetiva de vínculo com usuário + esta política com o ator da requisição; recusa vira pendência, sem gravar." },
  { file: "src/lib/adminUserCreation.server.ts", kind: "ACCOUNT_CREATION", authorization: "Cria conta nova já ligada (não altera conta existente): admin.settings.security:manage." },
  { file: "src/lib/canonicalPersonBackfill.server.ts", kind: "INTERNAL_ROUTINE", authorization: "CLI scripts/canonical-person-backfill.ts --apply --confirm-apply (acesso ao banco); só contas sem Pessoa; nunca SUPER_ADMIN nem quando criaria evidência conta↔colaborador (fica para regularização)." },
  { file: "src/lib/canonicalPersonCore.server.ts", kind: "NO_PRODUCTION_CALLER", authorization: "linkStage1RoleToPerson: sem chamador de produção (só testes); não alcançável por HTTP." },
  { file: "scripts/seedPerformanceLocalDemo.ts", kind: "LOCAL_SEED", authorization: "Só banco local (recusa DATABASE_URL não local)." },
  { file: "scripts/performance-e2e/seedLeadership180.mts", kind: "LOCAL_SEED", authorization: "Só banco local." },
  { file: "scripts/performance-e2e/seedPeopleLegacy.mts", kind: "LOCAL_SEED", authorization: "Só banco local (e nunca teste_bi)." },
  { file: "scripts/performance-e2e/seedHrRoles.mts", kind: "LOCAL_SEED", authorization: "Só banco local." },
] as const;
