/**
 * Ciclo de vida da senha dos usuários humanos — núcleo transacional.
 *
 * Este módulo NÃO reimplementa autenticação. Ele consome os helpers canônicos
 * (`hashPassword`/`verifyPassword` scrypt:v1, `createOpaqueSessionToken`,
 * `hashSessionToken`) e a mesma tabela `AppSession`. Não existe segundo motor
 * de hash, segundo sistema de sessão nem tabela paralela de credencial.
 *
 * Todas as operações são fail-closed e usam CAS (compare-and-swap) sobre o
 * estado comprovado: se o estado mudou entre a leitura e a escrita, a operação
 * falha com `PASSWORD_STATE_CHANGED` em vez de sobrescrever cegamente.
 *
 * Invariantes de sessão:
 *   troca voluntária  → revoga TODAS as sessões + emite UMA nova (requisição atual)
 *   troca obrigatória → revoga TODAS as sessões + emite UMA nova (requisição atual)
 *   reset admin       → revoga TODAS as sessões do alvo + NÃO emite sessão
 *
 * A revogação usa `AppSession.revokedAt` (o registro é preservado).
 * `permissionsVersion` NÃO é usado como "passwordVersion": ele tem
 * responsabilidade própria de ACL.
 */

import crypto from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  APP_SESSION_TTL_MS,
  createOpaqueSessionToken,
  hashPassword as canonicalHashPassword,
  hashSessionToken as canonicalHashSessionToken,
  verifyPassword as canonicalVerifyPassword,
} from "./appAuth.server.js";
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
  type PasswordPolicyResult,
} from "./passwordPolicy.js";
import {
  SECURITY_AUDIT_EVENTS,
  writeSecurityAuditLog,
  type SecurityAuditDb,
  type SecurityAuditEvent,
  type SecurityAuditSource,
} from "./securityAudit.server.js";

/** Códigos estáveis de erro. O frontend decide por código, nunca por texto. */
export const PASSWORD_LIFECYCLE_ERRORS = {
  INVALID_CURRENT_PASSWORD: "INVALID_CURRENT_PASSWORD",
  PASSWORD_POLICY_VIOLATION: "PASSWORD_POLICY_VIOLATION",
  PASSWORD_REUSED: "PASSWORD_REUSED",
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  PASSWORD_CHANGE_NOT_REQUIRED: "PASSWORD_CHANGE_NOT_REQUIRED",
  PASSWORD_STATE_CHANGED: "PASSWORD_STATE_CHANGED",
  USER_INACTIVE: "USER_INACTIVE",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
} as const;

export type PasswordLifecycleErrorCode =
  (typeof PASSWORD_LIFECYCLE_ERRORS)[keyof typeof PASSWORD_LIFECYCLE_ERRORS];

export type PasswordLifecycleFailure = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 422;
  code: PasswordLifecycleErrorCode;
  message: string;
  /** Presente apenas em PASSWORD_POLICY_VIOLATION. */
  reasons?: string[];
};

/**
 * Estreitamento explícito do resultado.
 *
 * O tsconfig do projeto não usa `strict`, e sem `strictNullChecks` o
 * estreitamento por discriminante (`if (!result.ok)`) não é aplicado. Um type
 * guard nomeado resolve isso sem `any` e sem `@ts-ignore`.
 */
export function isPasswordLifecycleFailure(
  result: { ok: boolean } | PasswordLifecycleFailure
): result is PasswordLifecycleFailure {
  return result.ok === false;
}

export type IssuedSession = {
  /** Token bruto — vai só para o cookie da resposta; nunca é persistido. */
  token: string;
  sessionId: string;
  expiresAt: Date;
};

export type PasswordChangeSuccess = {
  ok: true;
  userId: string;
  sessionsRevoked: number;
  session: IssuedSession;
};

export type AdminResetSuccess = {
  ok: true;
  userId: string;
  sessionsRevoked: number;
  /**
   * Plaintext gerado nesta requisição. Existe só na resposta imediata ao
   * SUPER_ADMIN — não é persistido, logado nem consultável depois.
   */
  temporaryPassword: string;
};

/* ------------------------------------------------------------------ */
/* Cliente mínimo (aceita o `prisma` e a transação `tx`)               */
/* ------------------------------------------------------------------ */

/** Campos lidos do usuário — o mínimo necessário para decidir e fazer o CAS. */
type UserRow = {
  id: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  permissionsVersion: number;
};

/** Tipos reais do Prisma: sem interface paralela e sem `any`. */
export type PasswordLifecycleTx = Prisma.TransactionClient;
export type PasswordLifecycleDb = PrismaClient;

export type PasswordLifecycleDeps = {
  db: PasswordLifecycleDb;
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (password: string, stored: string) => Promise<boolean>;
  createSessionToken?: () => string;
  hashSessionToken?: (token: string) => string;
  sessionTtlMs?: number;
  now?: () => Date;
};

type ResolvedDeps = Required<Omit<PasswordLifecycleDeps, "db">> & { db: PasswordLifecycleDb };

function resolveDeps(deps: PasswordLifecycleDeps): ResolvedDeps {
  return {
    db: deps.db,
    hashPassword: deps.hashPassword ?? canonicalHashPassword,
    verifyPassword: deps.verifyPassword ?? canonicalVerifyPassword,
    createSessionToken: deps.createSessionToken ?? createOpaqueSessionToken,
    hashSessionToken: deps.hashSessionToken ?? canonicalHashSessionToken,
    sessionTtlMs: deps.sessionTtlMs ?? APP_SESSION_TTL_MS,
    now: deps.now ?? (() => new Date()),
  };
}

const USER_SELECT = {
  id: true,
  passwordHash: true,
  isActive: true,
  mustChangePassword: true,
  permissionsVersion: true,
} satisfies Prisma.AppUserSelect;

/* ------------------------------------------------------------------ */
/* Senha temporária                                                    */
/* ------------------------------------------------------------------ */

/**
 * Senha temporária gerada criptograficamente (não inventada pelo administrador).
 *
 * 18 bytes de `crypto.randomBytes` → 24 caracteres base64url (~144 bits de
 * entropia). Bem acima do mínimo da política; a asserção existe para o dia em
 * que alguém mexer no tamanho.
 */
export function generateTemporaryPassword(): string {
  const password = crypto.randomBytes(18).toString("base64url");
  if (!validatePasswordPolicy(password).valid) {
    throw new Error(
      `generateTemporaryPassword produziu senha fora da política (mínimo ${PASSWORD_MIN_LENGTH}).`
    );
  }
  return password;
}

/* ------------------------------------------------------------------ */
/* Helpers internos                                                    */
/* ------------------------------------------------------------------ */

function policyFailure(result: PasswordPolicyResult): PasswordLifecycleFailure {
  return {
    ok: false,
    status: 422,
    code: PASSWORD_LIFECYCLE_ERRORS.PASSWORD_POLICY_VIOLATION,
    message: result.reasons[0] ?? "Senha fora da política.",
    reasons: result.reasons,
  };
}

function stateChangedFailure(): PasswordLifecycleFailure {
  return {
    ok: false,
    status: 409,
    code: PASSWORD_LIFECYCLE_ERRORS.PASSWORD_STATE_CHANGED,
    message: "A senha foi alterada em outra requisição. Recarregue e tente novamente.",
  };
}

export type RequestOrigin = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Bloco transacional comum: troca o hash com CAS, revoga TUDO, emite a nova
 * sessão (quando pedida) e audita. A ordem importa — a sessão nova é criada
 * DEPOIS da revogação em massa para não se auto-revogar.
 */
async function applyPasswordChange(
  d: ResolvedDeps,
  args: {
    user: UserRow;
    newPasswordHash: string;
    /** Condição extra de CAS além do hash anterior (ex.: mustChangePassword). */
    extraCas?: Prisma.AppUserWhereInput;
    nextMustChangePassword: boolean;
    issueSession: boolean;
    audit: {
      eventType: SecurityAuditEvent;
      actorUserId: string | null;
      targetUserId: string;
      origin?: RequestOrigin;
      source: SecurityAuditSource;
    };
  }
): Promise<
  { ok: true; sessionsRevoked: number; session: IssuedSession | null } | PasswordLifecycleFailure
> {
  const now = d.now();
  // Token gerado FORA do banco e antes do commit: só o SHA-256 é persistido.
  const token = args.issueSession ? d.createSessionToken() : null;
  const expiresAt = new Date(now.getTime() + d.sessionTtlMs);

  return d.db.$transaction(async (tx) => {
    // CAS: só troca se o estado ainda for exatamente o que foi verificado.
    const updated = await tx.appUser.updateMany({
      where: {
        id: args.user.id,
        passwordHash: args.user.passwordHash,
        isActive: true,
        ...(args.extraCas ?? {}),
      },
      data: {
        passwordHash: args.newPasswordHash,
        mustChangePassword: args.nextMustChangePassword,
        passwordChangedAt: now,
      },
    });
    if (updated.count !== 1) return stateChangedFailure();

    // Toda sessão viva do usuário morre: outro PC, celular, sessão roubada.
    const revoked = await tx.appSession.updateMany({
      where: { userId: args.user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    let session: IssuedSession | null = null;
    if (token) {
      const created = await tx.appSession.create({
        data: {
          userId: args.user.id,
          tokenHash: d.hashSessionToken(token),
          expiresAt,
          permissionsVersionAtIssue: args.user.permissionsVersion ?? 0,
        },
      });
      session = { token, sessionId: created.id, expiresAt };
    }

    // Auditoria dentro da transação: troca sem trilha não pode existir.
    await writeSecurityAuditLog(tx, {
      eventType: args.audit.eventType,
      actorUserId: args.audit.actorUserId,
      targetUserId: args.audit.targetUserId,
      ipAddress: args.audit.origin?.ipAddress ?? null,
      userAgent: args.audit.origin?.userAgent ?? null,
      metadata: { source: args.audit.source, sessionsRevoked: revoked.count },
    });

    return { ok: true as const, sessionsRevoked: revoked.count, session };
  });
}

/* ------------------------------------------------------------------ */
/* 1. Troca voluntária da própria senha                                */
/* ------------------------------------------------------------------ */

export async function changeOwnPassword(
  deps: PasswordLifecycleDeps,
  input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    origin?: RequestOrigin;
  }
): Promise<PasswordChangeSuccess | PasswordLifecycleFailure> {
  const d = resolveDeps(deps);

  const user = await d.db.appUser.findUnique({
    where: { id: input.userId },
    select: { ...USER_SELECT },
  });
  if (!user) {
    return {
      ok: false,
      status: 404,
      code: PASSWORD_LIFECYCLE_ERRORS.NOT_FOUND,
      message: "Usuário não encontrado.",
    };
  }
  if (!user.isActive) {
    return {
      ok: false,
      status: 403,
      code: PASSWORD_LIFECYCLE_ERRORS.USER_INACTIVE,
      message: "Usuário inativo.",
    };
  }

  const currentValid = await d.verifyPassword(input.currentPassword ?? "", user.passwordHash);
  if (!currentValid) {
    return {
      ok: false,
      status: 400,
      code: PASSWORD_LIFECYCLE_ERRORS.INVALID_CURRENT_PASSWORD,
      message: "Senha atual incorreta.",
    };
  }

  const policy = validatePasswordPolicy(input.newPassword);
  if (!policy.valid) return policyFailure(policy);

  // Repetir a senha atual não é troca. Comparado pelo helper canônico, não por
  // igualdade de string — o hash é salgado, então não dá para comparar hashes.
  if (await d.verifyPassword(input.newPassword, user.passwordHash)) {
    return {
      ok: false,
      status: 422,
      code: PASSWORD_LIFECYCLE_ERRORS.PASSWORD_REUSED,
      message: "A nova senha deve ser diferente da senha atual.",
    };
  }

  const newPasswordHash = await d.hashPassword(input.newPassword);
  const result = await applyPasswordChange(d, {
    user,
    newPasswordHash,
    nextMustChangePassword: false,
    issueSession: true,
    audit: {
      eventType: SECURITY_AUDIT_EVENTS.PASSWORD_CHANGED,
      actorUserId: user.id,
      targetUserId: user.id,
      origin: input.origin,
      source: "SELF_SERVICE",
    },
  });
  if (isPasswordLifecycleFailure(result)) return result;

  return {
    ok: true,
    userId: user.id,
    sessionsRevoked: result.sessionsRevoked,
    session: result.session as IssuedSession,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Troca obrigatória (após reset)                                   */
/* ------------------------------------------------------------------ */

/**
 * Não pede a senha temporária de novo: a posse da credencial acabou de ser
 * comprovada pelo login que emitiu esta sessão.
 */
export async function completeForcedPasswordChange(
  deps: PasswordLifecycleDeps,
  input: { userId: string; newPassword: string; origin?: RequestOrigin }
): Promise<PasswordChangeSuccess | PasswordLifecycleFailure> {
  const d = resolveDeps(deps);

  const user = await d.db.appUser.findUnique({
    where: { id: input.userId },
    select: { ...USER_SELECT },
  });
  if (!user) {
    return {
      ok: false,
      status: 404,
      code: PASSWORD_LIFECYCLE_ERRORS.NOT_FOUND,
      message: "Usuário não encontrado.",
    };
  }
  if (!user.isActive) {
    return {
      ok: false,
      status: 403,
      code: PASSWORD_LIFECYCLE_ERRORS.USER_INACTIVE,
      message: "Usuário inativo.",
    };
  }
  if (!user.mustChangePassword) {
    return {
      ok: false,
      status: 409,
      code: PASSWORD_LIFECYCLE_ERRORS.PASSWORD_CHANGE_NOT_REQUIRED,
      message: "Não há troca de senha pendente. Use a alteração normal de senha.",
    };
  }

  const policy = validatePasswordPolicy(input.newPassword);
  if (!policy.valid) return policyFailure(policy);

  if (await d.verifyPassword(input.newPassword, user.passwordHash)) {
    return {
      ok: false,
      status: 422,
      code: PASSWORD_LIFECYCLE_ERRORS.PASSWORD_REUSED,
      message: "A nova senha deve ser diferente da senha temporária.",
    };
  }

  const newPasswordHash = await d.hashPassword(input.newPassword);
  // O CAS inclui `mustChangePassword: true`: duas requisições simultâneas → só
  // uma vence; a outra recebe 409 em vez de sobrescrever a senha da vencedora.
  const result = await applyPasswordChange(d, {
    user,
    newPasswordHash,
    extraCas: { mustChangePassword: true },
    nextMustChangePassword: false,
    issueSession: true,
    audit: {
      eventType: SECURITY_AUDIT_EVENTS.PASSWORD_FORCED_CHANGE_COMPLETED,
      actorUserId: user.id,
      targetUserId: user.id,
      origin: input.origin,
      source: "FORCED_CHANGE",
    },
  });
  if (isPasswordLifecycleFailure(result)) return result;

  return {
    ok: true,
    userId: user.id,
    sessionsRevoked: result.sessionsRevoked,
    session: result.session as IssuedSession,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Reset administrativo (SUPER_ADMIN)                               */
/* ------------------------------------------------------------------ */

/**
 * A autorização é do guard da rota; aqui garantimos o efeito: senha temporária
 * do sistema, `mustChangePassword`, revogação total e NENHUMA sessão nova —
 * o alvo precisa autenticar de novo.
 */
export async function adminResetPassword(
  deps: PasswordLifecycleDeps,
  input: { actorUserId: string; targetUserId: string; origin?: RequestOrigin }
): Promise<AdminResetSuccess | PasswordLifecycleFailure> {
  const d = resolveDeps(deps);

  const user = await d.db.appUser.findUnique({
    where: { id: input.targetUserId },
    select: { ...USER_SELECT },
  });
  if (!user) {
    return {
      ok: false,
      status: 404,
      code: PASSWORD_LIFECYCLE_ERRORS.NOT_FOUND,
      message: "Usuário não encontrado.",
    };
  }

  const temporaryPassword = generateTemporaryPassword();
  const newPasswordHash = await d.hashPassword(temporaryPassword);
  const now = d.now();

  const outcome = await d.db.$transaction(async (tx) => {
    // Reset é legítimo mesmo para usuário inativo (recuperação de acesso), mas
    // o CAS sobre o hash anterior evita que dois resets concorrentes entreguem
    // duas senhas temporárias e só uma funcione.
    const updated = await tx.appUser.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: true,
        passwordChangedAt: now,
      },
    });
    if (updated.count !== 1) return stateChangedFailure();

    const revoked = await tx.appSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    await writeSecurityAuditLog(tx, {
      eventType: SECURITY_AUDIT_EVENTS.PASSWORD_RESET_BY_SUPER_ADMIN,
      actorUserId: input.actorUserId,
      targetUserId: user.id,
      ipAddress: input.origin?.ipAddress ?? null,
      userAgent: input.origin?.userAgent ?? null,
      metadata: { source: "ADMIN_RESET", sessionsRevoked: revoked.count },
    });

    return { ok: true as const, sessionsRevoked: revoked.count };
  });

  if (isPasswordLifecycleFailure(outcome)) return outcome;

  return {
    ok: true,
    userId: user.id,
    sessionsRevoked: outcome.sessionsRevoked,
    temporaryPassword,
  };
}
