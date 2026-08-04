/**
 * Forma do `where` das contas financeiras, validada com Prisma mockado.
 *
 * REGRESSÃO QUE ESTE ARQUIVO TRAVA
 * `treasuryCompanyCodePresentWhere()` devolvia `NOT: { companyCode: null }`.
 * Como `companyCode` é `String` no schema e `TEXT NOT NULL` no banco, o Prisma
 * recusava a consulta inteira:
 *
 *   PrismaClientValidationError: Argument `companyCode` must not be null.
 *
 * Isso derrubava em runtime TODAS as rotas que carregam contas por empresa —
 * Caixa (`/api/finance/treasury/caixa`), Fechamento Guiado e Hoje Guiado — e o
 * erro chegava à tela como "Erro interno na Central de Tesouraria".
 *
 * Um teste anterior fixava justamente a forma defeituosa, o que impedia a
 * regressão de ser percebida.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { treasuryCompanyCodePresentWhere } from "./treasuryPrismaFilters.js";

type CapturedArgs = Record<string, unknown>;

/**
 * Mock que REJEITA o que o Prisma real rejeitaria, em vez de aceitar tudo.
 * Sem isso o teste passaria com a consulta inválida — foi assim que o defeito
 * chegou a produção.
 */
function createStrictAccountPrismaMock(rows: unknown[] = []) {
  const calls: CapturedArgs[] = [];

  function assertNoNullOnNonNullableField(node: unknown, path: string): void {
    if (node == null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (key === "companyCode" && value === null) {
        throw new Error(
          `PrismaClientValidationError: Argument \`companyCode\` must not be null (em ${nextPath})`
        );
      }
      if (value === null && /companyCode|name|isActive|sortOrder/.test(key)) {
        throw new Error(
          `PrismaClientValidationError: Argument \`${key}\` must not be null (em ${nextPath})`
        );
      }
      assertNoNullOnNonNullableField(value, nextPath);
    }
  }

  return {
    calls,
    treasuryFinancialAccount: {
      findMany: async (args: CapturedArgs) => {
        assertNoNullOnNonNullableField(args.where, "where");
        calls.push(args);
        return rows;
      },
      findFirst: async (args: CapturedArgs) => {
        assertNoNullOnNonNullableField(args.where, "where");
        calls.push(args);
        return rows[0] ?? null;
      },
    },
  };
}

/** Reproduz a consulta que os serviços fazem. */
async function loadCompanyAccounts(db: ReturnType<typeof createStrictAccountPrismaMock>) {
  return db.treasuryFinancialAccount.findMany({
    where: { isActive: true, ...treasuryCompanyCodePresentWhere() },
    select: { id: true, companyCode: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

describe("contas financeiras — forma do where", () => {
  it("a consulta não estoura validação do Prisma", async () => {
    const db = createStrictAccountPrismaMock([
      { id: "a1", companyCode: "EMP1" },
    ]);
    const rows = await loadCompanyAccounts(db);
    assert.equal(rows.length, 1);
  });

  it("o mock estrito realmente pegaria o defeito antigo", async () => {
    const db = createStrictAccountPrismaMock();
    await assert.rejects(
      () =>
        db.treasuryFinancialAccount.findMany({
          where: { isActive: true, NOT: { companyCode: null } },
        }),
      /must not be null/,
      "o mock precisa reprovar a forma antiga, senão não protege nada"
    );
  });

  it("mantém o recorte de contas ativas", async () => {
    const db = createStrictAccountPrismaMock();
    await loadCompanyAccounts(db);
    const where = db.calls[0]!.where as Record<string, unknown>;
    assert.equal(where.isActive, true);
  });

  it("preserva a ordenação por sortOrder e depois name", async () => {
    const db = createStrictAccountPrismaMock();
    await loadCompanyAccounts(db);
    assert.deepEqual(db.calls[0]!.orderBy, [
      { sortOrder: "asc" },
      { name: "asc" },
    ]);
  });

  it("o where não contém null em nenhuma profundidade", async () => {
    const db = createStrictAccountPrismaMock();
    await loadCompanyAccounts(db);
    assert.equal(JSON.stringify(db.calls[0]!.where).includes("null"), false);
  });

  it("conta com código válido é retornada; a consulta não esconde contas", async () => {
    const db = createStrictAccountPrismaMock([
      { id: "a1", companyCode: "EMP1" },
      { id: "a2", companyCode: "EMP2" },
    ]);
    const rows = await loadCompanyAccounts(db);
    assert.equal(rows.length, 2);
  });
});
