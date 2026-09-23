import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  describeRoleUsage,
  isRoleInUse,
  roleDeleteBlockedMessage,
} from "./settingsOperationalCatalog.ts";
import {
  deleteRoleIfUnused,
  OperationalCatalogError,
} from "./settingsOperationalCatalog.server.ts";

const ROLE = "11111111-1111-4111-8111-111111111111";

type AnyArgs = Record<string, any>;

function fakePrisma(tx: Record<string, unknown>) {
  return { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never;
}

function expectCatalogError(code: string, status: number) {
  return (err: unknown) => {
    assert.ok(err instanceof OperationalCatalogError, `esperava OperationalCatalogError: ${err}`);
    assert.equal(err.code, code);
    assert.equal(err.status, status);
    return true;
  };
}

function rolePrisma(opts: {
  role?: { id: string; name: string } | null;
  employees?: number;
  routings?: number;
  onDelete?: (args: AnyArgs) => unknown;
}) {
  return fakePrisma({
    role: {
      findUnique: async (args: AnyArgs) => {
        assert.deepEqual(args.where, { id: ROLE });
        return opts.role === undefined ? { id: ROLE, name: "Analista comercial" } : opts.role;
      },
      delete: async (args: AnyArgs) => {
        if (opts.onDelete) return opts.onDelete(args);
        throw new Error("role.delete não deveria ser chamado");
      },
    },
    employee: {
      count: async (args: AnyArgs) => {
        assert.deepEqual(args.where, { roleId: ROLE });
        return opts.employees ?? 0;
      },
    },
    productRouting: {
      count: async (args: AnyArgs) => {
        assert.deepEqual(args.where, { roleId: ROLE });
        return opts.routings ?? 0;
      },
    },
  });
}

describe("settingsOperationalCatalog — mensagens de uso do cargo", () => {
  it("descreve só as partes com uso", () => {
    assert.equal(isRoleInUse({ employees: 0, routings: 0 }), false);
    assert.equal(isRoleInUse({ employees: 0, routings: 1 }), true);
    assert.equal(describeRoleUsage({ employees: 3, routings: 0 }), "3 colaborador(es)");
    assert.equal(describeRoleUsage({ employees: 0, routings: 2 }), "2 roteiro(s) de produção");
    assert.equal(
      describeRoleUsage({ employees: 3, routings: 2 }),
      "3 colaborador(es) e 2 roteiro(s) de produção"
    );
  });

  it("mensagem de bloqueio diz onde trocar o cargo", () => {
    const msg = roleDeleteBlockedMessage("Analista de RH", { employees: 2, routings: 1 });
    assert.ok(msg.includes('"Analista de RH"'));
    assert.ok(msg.includes("2 colaborador(es) e 1 roteiro(s) de produção"));
    assert.ok(msg.includes("Pessoas / RH → Editar"));
    assert.ok(msg.includes("cadastro do produto"));
    const onlyRouting = roleDeleteBlockedMessage("Operador", { employees: 0, routings: 4 });
    assert.ok(!onlyRouting.includes("Pessoas / RH"));
  });
});

describe("deleteRoleIfUnused — excluir cargo do cadastro operacional", () => {
  it("cargo sem uso é excluído", async () => {
    let deleted: AnyArgs | null = null;
    const result = await deleteRoleIfUnused(
      rolePrisma({
        onDelete: (args) => {
          deleted = args.where;
          return { id: ROLE };
        },
      }),
      { roleId: ROLE }
    );
    assert.deepEqual(result, { name: "Analista comercial" });
    assert.deepEqual(deleted, { id: ROLE });
  });

  it("cargo usado por colaborador ou roteiro → 409 com o uso, sem excluir", async () => {
    await assert.rejects(
      () => deleteRoleIfUnused(rolePrisma({ employees: 5 }), { roleId: ROLE }),
      (err: unknown) => {
        expectCatalogError("ROLE_IN_USE", 409)(err);
        const e = err as OperationalCatalogError;
        assert.deepEqual(e.usage, { employees: 5, routings: 0 });
        assert.ok(e.message.includes("5 colaborador(es)"));
        return true;
      }
    );
    await assert.rejects(
      () => deleteRoleIfUnused(rolePrisma({ routings: 2 }), { roleId: ROLE }),
      expectCatalogError("ROLE_IN_USE", 409)
    );
  });

  it("cargo inexistente → 404; id inválido → 400 antes do banco", async () => {
    await assert.rejects(
      () => deleteRoleIfUnused(rolePrisma({ role: null }), { roleId: ROLE }),
      expectCatalogError("NOT_FOUND", 404)
    );
    await assert.rejects(
      () =>
        deleteRoleIfUnused(
          {
            $transaction: async () => {
              throw new Error("não deveria abrir transação");
            },
          } as never,
          { roleId: "nao-e-uuid" }
        ),
      expectCatalogError("INVALID_ID", 400)
    );
  });

  it("corrida: FK recusada pelo banco na exclusão vira 409", async () => {
    await assert.rejects(
      () =>
        deleteRoleIfUnused(
          rolePrisma({
            onDelete: () => {
              throw Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
            },
          }),
          { roleId: ROLE }
        ),
      expectCatalogError("ROLE_IN_USE", 409)
    );
  });

  it("server.ts: exclusão de cargo exige SUPER_ADMIN e passa pela checagem de uso", () => {
    const src = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
    const start = src.indexOf('app.delete("/api/roles/:id"');
    assert.ok(start > 0);
    const end = src.indexOf("\n  });", src.indexOf("deleteRoleIfUnused(prisma", start));
    const route = src.slice(start, end);
    assert.ok(route.includes('authUser.role !== "SUPER_ADMIN"'));
    assert.ok(route.includes("deleteRoleIfUnused(prisma"));
    assert.ok(!route.includes("prisma.role.delete("));
  });
});
