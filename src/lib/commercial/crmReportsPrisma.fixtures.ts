/**
 * Fixtures de teste de CRM > Relatórios: avaliador mínimo de `where` Prisma
 * e um Prisma em memória (findMany / groupBy).
 *
 * Existe para os testes executarem o `where` CANÔNICO real
 * (`crmCanonicalSalesOrderWhere`, `buildSalesOrderListWhere`,
 * `crmEligibleCustomerWhere`, carteira) sobre linhas fixas — provando
 * comportamento, não comparando cópias de regra. Só implementa os operadores
 * que esses construtores emitem; operador desconhecido lança erro.
 *
 * Uso exclusivo de testes.
 */

export type FixtureRow = Record<string, unknown>;

function norm(value: unknown, insensitive: boolean): unknown {
  return insensitive && typeof value === "string" ? value.toLowerCase() : value;
}

function same(a: unknown, b: unknown, insensitive = false): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return norm(a, insensitive) === norm(b, insensitive);
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x - y;
}

function matchesField(value: unknown, cond: unknown): boolean {
  if (cond === null) return value == null;
  if (cond instanceof Date || typeof cond !== "object" || Array.isArray(cond)) return same(value, cond);
  const ops = cond as FixtureRow;
  if ("is" in ops || "isNot" in ops) {
    const related = value as FixtureRow | null | undefined;
    if ("is" in ops) {
      return ops.is === null ? related == null : related != null && matchesPrismaWhere(related, ops.is);
    }
    return ops.isNot === null ? related != null : related == null || !matchesPrismaWhere(related, ops.isNot);
  }
  const insensitive = ops.mode === "insensitive";
  for (const [op, arg] of Object.entries(ops)) {
    switch (op) {
      case "mode":
        break;
      case "equals":
        if (!same(value, arg, insensitive)) return false;
        break;
      case "not":
        if (arg === null) {
          if (value == null) return false;
        } else if (typeof arg === "object" && !(arg instanceof Date)) {
          if (matchesField(value, arg)) return false;
        } else if (value == null || same(value, arg, insensitive)) {
          return false;
        }
        break;
      case "in":
        if (!(arg as unknown[]).some((item) => same(value, item, insensitive))) return false;
        break;
      case "notIn":
        if ((arg as unknown[]).some((item) => same(value, item, insensitive))) return false;
        break;
      case "contains":
        if (
          typeof value !== "string" ||
          !(norm(value, insensitive) as string).includes(norm(arg, insensitive) as string)
        ) {
          return false;
        }
        break;
      case "gt":
        if (value == null || compare(value, arg) <= 0) return false;
        break;
      case "gte":
        if (value == null || compare(value, arg) < 0) return false;
        break;
      case "lt":
        if (value == null || compare(value, arg) >= 0) return false;
        break;
      case "lte":
        if (value == null || compare(value, arg) > 0) return false;
        break;
      case "array_contains":
        if (!Array.isArray(value) || !value.includes(arg)) return false;
        break;
      default:
        throw new Error(`operador não suportado pelo avaliador de teste: ${op}`);
    }
  }
  return true;
}

/** Avalia um `where` Prisma sobre uma linha (relações to-one como objeto aninhado). */
export function matchesPrismaWhere(row: FixtureRow, where: unknown): boolean {
  if (where == null) return true;
  for (const [key, cond] of Object.entries(where as FixtureRow)) {
    if (key === "AND") {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((c) => matchesPrismaWhere(row, c))) return false;
    } else if (key === "OR") {
      if (!(cond as unknown[]).some((c) => matchesPrismaWhere(row, c))) return false;
    } else if (key === "NOT") {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((c) => matchesPrismaWhere(row, c))) return false;
    } else if (!matchesField(row[key], cond)) {
      return false;
    }
  }
  return true;
}

function pick(row: FixtureRow, select: FixtureRow | undefined): FixtureRow {
  if (!select) return { ...row };
  const out: FixtureRow = {};
  for (const [key, flag] of Object.entries(select)) if (flag) out[key] = row[key];
  return out;
}

/** Decimal mínimo (Prisma devolve Decimal em `_sum`). */
export function fixtureDecimal(value: number): { toNumber: () => number; toString: () => string } {
  return { toNumber: () => value, toString: () => String(value) };
}

export type FixtureDb = {
  customers: FixtureRow[];
  salesOrders: FixtureRow[];
};

/**
 * Prisma em memória: `customer.findMany`, `salesOrder.findMany` e
 * `salesOrder.groupBy` (count/sum/max por `customerId`). Pedidos recebem a
 * relação `Customer` para os filtros de grupo econômico.
 */
export function createFixturePrisma(db: FixtureDb) {
  const customerById = new Map(db.customers.map((c) => [c.id as string, c]));
  const ordersWithCustomer = (): FixtureRow[] =>
    db.salesOrders.map((o) => ({ ...o, Customer: customerById.get(o.customerId as string) ?? null }));
  const calls: string[] = [];
  return {
    calls,
    customer: {
      findMany: async (args: { where?: unknown; select?: FixtureRow }) => {
        calls.push("customer.findMany");
        return db.customers.filter((c) => matchesPrismaWhere(c, args.where)).map((c) => pick(c, args.select));
      },
    },
    salesOrder: {
      findMany: async (args: { where?: unknown; select?: FixtureRow }) => {
        calls.push("salesOrder.findMany");
        return ordersWithCustomer()
          .filter((o) => matchesPrismaWhere(o, args.where))
          .map((o) => {
            const row = pick(o, args.select);
            if ("totalNetValue" in row) row.totalNetValue = fixtureDecimal(row.totalNetValue as number);
            return row;
          });
      },
      groupBy: async (args: {
        by: string[];
        where?: unknown;
        _count?: { _all?: boolean };
        _sum?: { totalNetValue?: boolean };
        _max?: { issueDate?: boolean };
      }) => {
        calls.push("salesOrder.groupBy");
        if (args.by.length !== 1 || args.by[0] !== "customerId") {
          throw new Error("groupBy de teste só agrupa por customerId");
        }
        const groups = new Map<string, FixtureRow[]>();
        for (const o of ordersWithCustomer()) {
          if (!matchesPrismaWhere(o, args.where)) continue;
          const key = o.customerId as string;
          groups.set(key, [...(groups.get(key) ?? []), o]);
        }
        return [...groups.entries()].map(([customerId, rows]) => {
          const out: FixtureRow = { customerId };
          if (args._count) out._count = { _all: rows.length };
          if (args._sum) {
            // Soma exata em micro-unidades, como o Decimal do banco.
            const micros = rows.reduce((acc, r) => acc + Math.round((r.totalNetValue as number) * 1e6), 0);
            out._sum = { totalNetValue: fixtureDecimal(micros / 1e6) };
          }
          if (args._max) {
            out._max = {
              issueDate: rows.reduce<Date | null>(
                (acc, r) => (!acc || (r.issueDate as Date) > acc ? (r.issueDate as Date) : acc),
                null
              ),
            };
          }
          return out;
        });
      },
    },
  };
}
