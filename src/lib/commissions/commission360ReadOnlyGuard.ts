/**
 * Trava de somente leitura para auditorias da Visão 360° rodadas no servidor.
 *
 * Envolve um PrismaClient num Proxy que só deixa passar leituras de modelo
 * (findMany, findFirst, findUnique, count, aggregate, groupBy) e $connect/$disconnect.
 * Qualquer outra operação — create, update, upsert, delete, *Many, $transaction,
 * $executeRaw, $queryRaw, $runCommandRaw, $extends, $use, $on — lança erro ANTES de chegar
 * ao banco e fica registrada em `blocked`. Instalada em `globalThis.prisma` antes de
 * importar os loaders, cobre também os módulos oficiais lidos por eles.
 */

export const COMMISSION_360_READ_METHODS: ReadonlySet<string> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

const CLIENT_ALLOWED: ReadonlySet<string> = new Set(["$connect", "$disconnect"]);

export class Commission360ReadOnlyViolation extends Error {
  constructor(public readonly operation: string) {
    super(`Operação bloqueada pela trava de somente leitura da Visão 360°: ${operation}`);
    this.name = "Commission360ReadOnlyViolation";
  }
}

export type Commission360ReadOnlyGuard<T extends object> = {
  client: T;
  /** Operações tentadas e bloqueadas (deve ficar vazio). */
  blocked: string[];
  /** Leituras feitas, por modelo.método (auditoria do que foi lido). */
  reads: Map<string, number>;
};

export function createCommission360ReadOnlyPrisma<T extends object>(base: T): Commission360ReadOnlyGuard<T> {
  const blocked: string[] = [];
  const reads = new Map<string, number>();
  const deny = (operation: string) => {
    blocked.push(operation);
    throw new Commission360ReadOnlyViolation(operation);
  };
  const delegates = new Map<string, unknown>();
  const client = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      if (prop === "then") return undefined;
      if (prop.startsWith("$")) {
        if (CLIENT_ALLOWED.has(prop)) {
          const fn = Reflect.get(target, prop, target) as (...args: unknown[]) => unknown;
          return (...args: unknown[]) => fn.apply(target, args);
        }
        return (..._args: unknown[]) => deny(prop);
      }
      const delegate = Reflect.get(target, prop, target) as Record<string, unknown> | undefined;
      if (!delegate || typeof delegate !== "object") return delegate;
      const cached = delegates.get(prop);
      if (cached) return cached;
      const wrapped = new Proxy(delegate, {
        get(model, method) {
          if (typeof method !== "string") return Reflect.get(model, method);
          const operation = `${prop}.${method}`;
          if (!COMMISSION_360_READ_METHODS.has(method)) return (..._args: unknown[]) => deny(operation);
          const fn = Reflect.get(model, method) as (...args: unknown[]) => unknown;
          return (...args: unknown[]) => {
            reads.set(operation, (reads.get(operation) ?? 0) + 1);
            return fn.apply(model, args);
          };
        },
      });
      delegates.set(prop, wrapped);
      return wrapped;
    },
  });
  return { client, blocked, reads };
}

/** Destino da conexão para conferência humana: host, porta, banco e usuário; nunca a senha. */
export function describeCommission360DatabaseUrl(url: string): {
  host: string;
  port: string;
  database: string;
  user: string;
  schema: string | null;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    user: decodeURIComponent(parsed.username),
    schema: parsed.searchParams.get("schema"),
  };
}

/**
 * URL da auditoria: mantém os parâmetros do servidor, limita o pool (o script consulta em
 * lotes, sem paralelismo amplo) e identifica a sessão no pg_stat_activity.
 */
export function buildCommission360AuditDatabaseUrl(url: string, connectionLimit = 3): string {
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", String(connectionLimit));
  if (!parsed.searchParams.has("application_name")) parsed.searchParams.set("application_name", "induscost-audit-commission-360");
  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Execução de auditoria: conferência do ambiente + transação READ ONLY
// ---------------------------------------------------------------------------

/** Tabelas cujo privilégio de escrita é conferido (nomes físicos = nomes dos modelos Prisma). */
export const COMMISSION_AUDIT_CHECKED_TABLES = [
  "CommissionOrderSnapshot",
  "CommissionOrderItemSnapshot",
  "CommissionReceivableSchedule",
  "CommissionReceiptCoverage",
  "CommissionMonthlyClosing",
  "CommissionReceiptLedgerLine",
  "CommissionPaymentBatch",
  "CommissionPaymentBatchItem",
  "NomusAccountsReceivable",
  "NomusReceivableReceipt",
  "SalesOrder",
  "SalesOrderNfeLink",
] as const;

export type CommissionAuditSession = {
  database: string;
  user: string;
  version: string;
  serverPort: number | null;
  readOnly: string;
  canWrite: boolean | null;
};

export class CommissionAuditRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommissionAuditRefused";
  }
}

type RawCapable = { $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> };

const SESSION_SQL = `
  SELECT current_database() AS database,
         current_user AS "user",
         current_setting('server_version') AS version,
         inet_server_port() AS "serverPort",
         current_setting('transaction_read_only') AS "readOnly",
         bool_or(has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                 OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE')) AS "canWrite"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = current_schema()
     AND c.relname = ANY($1::text[])`;

/**
 * Conferência do ambiente ANTES de qualquer leitura de negócio: banco e porta precisam ser os
 * informados; tabelas precisam existir no schema; papel com escrita só é aceito sem
 * `requireReadOnlyRole`. Única SQL própria: este SELECT de catálogo.
 */
export async function checkCommissionAuditSession(
  client: RawCapable,
  expected: { database: string; port: number | null; requireReadOnlyRole: boolean }
): Promise<CommissionAuditSession> {
  const rows = (await client.$queryRawUnsafe(SESSION_SQL, [...COMMISSION_AUDIT_CHECKED_TABLES])) as CommissionAuditSession[];
  const session = rows[0];
  if (!session) throw new CommissionAuditRefused("Não foi possível conferir a sessão do banco.");
  if (session.database !== expected.database) {
    throw new CommissionAuditRefused(`Banco conectado (${session.database}) diferente do informado (${expected.database}). Nada foi lido.`);
  }
  if (expected.port != null && session.serverPort != null && Number(session.serverPort) !== expected.port) {
    throw new CommissionAuditRefused(`Porta do servidor (${session.serverPort}) diferente da informada (${expected.port}). Nada foi lido.`);
  }
  if (session.canWrite == null) {
    throw new CommissionAuditRefused("As tabelas de comissão não existem no schema atual. Confira o ?schema= do DATABASE_URL.");
  }
  if (session.canWrite && expected.requireReadOnlyRole) {
    throw new CommissionAuditRefused("O papel do banco tem privilégio de escrita e --require-readonly-role foi pedido.");
  }
  return session;
}

type TransactionCapable<Tx> = {
  $transaction: (fn: (tx: Tx) => Promise<unknown>, options?: { maxWait?: number; timeout?: number }) => Promise<unknown>;
};

/**
 * Roda a auditoria numa transação REPEATABLE READ, READ ONLY do PostgreSQL (fotografia
 * consistente; o banco recusa qualquer escrita) e entrega ao `fn` o cliente da transação já
 * envolvido pela trava do processo. Se a sessão não ficar em modo somente leitura, recusa.
 */
export async function runCommissionReadOnlyAudit<Tx extends RawCapable & { $executeRawUnsafe: (sql: string) => Promise<unknown> }, T>(
  base: TransactionCapable<Tx>,
  fn: (guard: Commission360ReadOnlyGuard<Tx>, info: { readOnly: string; isolation: string }) => Promise<T>,
  options: { timeoutMs: number }
): Promise<T> {
  return (await base.$transaction(
    async (tx) => {
      // Primeira instrução da transação: o PostgreSQL só aceita SET TRANSACTION antes de qualquer consulta.
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const [info] = (await tx.$queryRawUnsafe(
        "SELECT current_setting('transaction_read_only') AS \"readOnly\", current_setting('transaction_isolation') AS isolation"
      )) as Array<{ readOnly: string; isolation: string }>;
      if (!info || info.readOnly !== "on") {
        throw new CommissionAuditRefused("A transação não ficou em modo somente leitura (transaction_read_only ≠ on). Nada foi lido.");
      }
      return fn(createCommission360ReadOnlyPrisma(tx), info);
    },
    { maxWait: 10_000, timeout: options.timeoutMs }
  )) as T;
}
