/**
 * Banco em memória para os testes do ciclo de senha.
 *
 * Reproduz o subconjunto de Prisma que o serviço usa (`appUser.findUnique`,
 * `appUser.updateMany`, `appSession.*`, `securityAuditLog.create` e
 * `$transaction`), com semântica de CAS de verdade: `updateMany` só conta a
 * linha quando TODAS as condições do `where` batem. É isso que permite provar,
 * sem PostgreSQL, que troca concorrente gera conflito em vez de sobrescrever.
 *
 * NÃO é um mock de conveniência do caso feliz: o `$transaction` faz rollback
 * de verdade (snapshot/restore) quando o callback lança, e é assim que os
 * testes verificam "reset sem auditoria não pode existir".
 *
 * Arquivo de apoio a teste — não é importado por código de produção.
 */

export type FakeUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  permissionsVersion: number;
};

export type FakeSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  permissionsVersionAtIssue: number;
};

export type FakeAuditRow = {
  id: string;
  eventType: string;
  actorUserId: string | null;
  targetUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
};

type State = {
  users: FakeUser[];
  sessions: FakeSession[];
  audits: FakeAuditRow[];
};

function clone(state: State): State {
  return {
    users: state.users.map((u) => ({ ...u })),
    sessions: state.sessions.map((s) => ({ ...s })),
    audits: state.audits.map((a) => ({ ...a })),
  };
}

/** `null` no `where` significa "campo tem de ser nulo" (ex.: revokedAt: null). */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (expected instanceof Date) {
      if (!(actual instanceof Date) || actual.getTime() !== expected.getTime()) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

export class FakePrisma {
  private state: State;
  private sessionSeq = 0;
  private auditSeq = 0;
  /** Executado no início de cada $transaction — usado para simular corrida. */
  public onTransactionStart: (() => void | Promise<void>) | null = null;

  constructor(users: FakeUser[] = [], sessions: FakeSession[] = []) {
    this.state = { users: users.map((u) => ({ ...u })), sessions: sessions.map((s) => ({ ...s })), audits: [] };
  }

  get users(): FakeUser[] {
    return this.state.users;
  }

  get sessions(): FakeSession[] {
    return this.state.sessions;
  }

  get audits(): FakeAuditRow[] {
    return this.state.audits;
  }

  userById(id: string): FakeUser | undefined {
    return this.state.users.find((u) => u.id === id);
  }

  activeSessionsOf(userId: string): FakeSession[] {
    return this.state.sessions.filter((s) => s.userId === userId && s.revokedAt === null);
  }

  private client(state: State) {
    return {
      appUser: {
        findUnique: async (args: { where: { id: string } }) => {
          const found = state.users.find((u) => u.id === args.where.id);
          return found ? { ...found } : null;
        },
        updateMany: async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const user of state.users) {
            if (!matches(user as unknown as Record<string, unknown>, args.where)) continue;
            Object.assign(user, args.data);
            count += 1;
          }
          return { count };
        },
        create: async (args: { data: Record<string, unknown> }) => {
          const created = { ...(args.data as unknown as FakeUser) };
          state.users.push(created);
          return { ...created };
        },
      },
      appSession: {
        updateMany: async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const session of state.sessions) {
            if (!matches(session as unknown as Record<string, unknown>, args.where)) continue;
            Object.assign(session, args.data);
            count += 1;
          }
          return { count };
        },
        create: async (args: { data: Record<string, unknown> }) => {
          this.sessionSeq += 1;
          const row: FakeSession = {
            id: `session-${this.sessionSeq}`,
            revokedAt: null,
            ...(args.data as unknown as Omit<FakeSession, "id" | "revokedAt">),
          } as FakeSession;
          state.sessions.push(row);
          return { id: row.id };
        },
        findFirst: async (args: { where: Record<string, unknown> }) => {
          const found = state.sessions.find((s) =>
            matches(s as unknown as Record<string, unknown>, args.where)
          );
          return found ? { ...found } : null;
        },
      },
      securityAuditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          this.auditSeq += 1;
          const row: FakeAuditRow = {
            id: `audit-${this.auditSeq}`,
            createdAt: new Date(),
            ...(args.data as unknown as Omit<FakeAuditRow, "id" | "createdAt">),
          } as FakeAuditRow;
          state.audits.push(row);
          return { ...row };
        },
      },
    };
  }

  /** Transação real o bastante: erro dentro do callback desfaz tudo. */
  async $transaction<T>(fn: (tx: ReturnType<FakePrisma["client"]>) => Promise<T>): Promise<T> {
    if (this.onTransactionStart) await this.onTransactionStart();
    const snapshot = clone(this.state);
    const working = this.state;
    try {
      return await fn(this.client(working));
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  get appUser() {
    return this.client(this.state).appUser;
  }

  get appSession() {
    return this.client(this.state).appSession;
  }

  get securityAuditLog() {
    return this.client(this.state).securityAuditLog;
  }
}

/** Hash de teste: rápido e determinístico, sem custo de scrypt real. */
export const fakeHash = {
  hashPassword: async (password: string) => `fake:${password}`,
  verifyPassword: async (password: string, stored: string) => stored === `fake:${password}`,
};

export function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: "user-1",
    email: "usuario@exemplo.test",
    passwordHash: "fake:senha atual valida",
    role: "VIEWER",
    isActive: true,
    mustChangePassword: false,
    passwordChangedAt: null,
    permissionsVersion: 3,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    id: "session-legacy",
    userId: "user-1",
    tokenHash: "hash-do-token-antigo",
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    permissionsVersionAtIssue: 3,
    ...overrides,
  };
}
