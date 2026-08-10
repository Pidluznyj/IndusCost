/**
 * Regressão — bug real confirmado em produção via Prisma/PostgreSQL:
 * `Customer.tradeName` é nullable (`String?`). Um `contains` cru sobre
 * `tradeName` dentro do OR de `buildEconomicGroupCustomerPrismaExclusion()`,
 * quando o Customer tem `tradeName = null`, produz UNKNOWN em SQL de três
 * valores (não TRUE nem FALSE). Como esse OR inteiro é negado via `isNot`,
 * `NOT UNKNOWN` continua UNKNOWN — e `WHERE UNKNOWN` nunca passa. Resultado:
 * clientes EXTERNOS com `tradeName = null` eram eliminados junto com os
 * intercompany reais (confirmado em produção: junho/2026, 127 pedidos
 * externos zerados para 0).
 *
 * Estes testes não dependem de um Postgres real (indisponível neste
 * ambiente) — provam a propriedade em dois níveis:
 *   1. Estrutural: toda cláusula `tradeName` dentro do OR está protegida
 *      por `AND: [{ tradeName: { not: null } }, { tradeName: { contains } }]`.
 *   2. Matemático: um avaliador de semântica SQL de três valores (TRUE /
 *      FALSE / UNKNOWN) aplicado à estrutura JSON real do where, provando
 *      que TOTAL = GRUPO + EXTERNOS para uma população sintética que inclui
 *      clientes externos com `tradeName` null e preenchido.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEconomicGroupCustomerPrismaExclusion,
  isEconomicGroupCnpj,
  isEconomicGroupName,
  isEconomicGroupCompany,
} from "./financeInternalGroupExclusions.js";

// ---------------------------------------------------------------------------
// 1) Teste estrutural do where gerado
// ---------------------------------------------------------------------------

describe("buildEconomicGroupCustomerPrismaExclusion — estrutura null-safe", () => {
  const exclusion = buildEconomicGroupCustomerPrismaExclusion();

  it("usa Customer.isNot (não NOT + is)", () => {
    const json = JSON.stringify(exclusion);
    assert.match(json, /"isNot"/);
    // Não deve existir a forma antiga NOT->Customer->is em nenhum lugar.
    assert.doesNotMatch(json, /"NOT":\{"Customer":\{"is"/);
  });

  it("toda cláusula tradeName dentro do OR está protegida com not:null (AND)", () => {
    assert.ok("Customer" in exclusion);
    const customerFilter = (exclusion as { Customer: { isNot: { OR: unknown[] } } }).Customer;
    const or = customerFilter.isNot.OR;
    const tradeNameBranches = or.filter(
      (clause) => JSON.stringify(clause).includes("tradeName")
    ) as Array<Record<string, unknown>>;

    assert.ok(tradeNameBranches.length > 0, "esperava pelo menos um ramo de tradeName no OR");
    for (const branch of tradeNameBranches) {
      // Cada ramo de tradeName precisa vir envolto em AND com { tradeName: { not: null } }.
      assert.ok("AND" in branch, `ramo de tradeName sem proteção AND: ${JSON.stringify(branch)}`);
      const and = branch.AND as Array<Record<string, unknown>>;
      const hasNotNullGuard = and.some((c) => {
        const tn = (c as { tradeName?: { not?: unknown } }).tradeName;
        return tn && "not" in tn && tn.not === null;
      });
      assert.ok(
        hasNotNullGuard,
        `ramo de tradeName sem { tradeName: { not: null } }: ${JSON.stringify(branch)}`
      );
    }
  });

  it("nenhum predicate cru { tradeName: { contains } } solto (sem AND/not-null) no OR", () => {
    const customerFilter = (exclusion as { Customer: { isNot: { OR: unknown[] } } }).Customer;
    for (const clause of customerFilter.isNot.OR) {
      const c = clause as Record<string, unknown>;
      if ("tradeName" in c) {
        assert.fail(
          `encontrado ramo de tradeName sem proteção AND (predicate cru): ${JSON.stringify(c)}`
        );
      }
    }
  });

  it("taxId e companyName (campos obrigatórios) continuam sem not:null — não precisam da proteção", () => {
    const customerFilter = (exclusion as { Customer: { isNot: { OR: unknown[] } } }).Customer;
    const taxIdBranches = customerFilter.isNot.OR.filter((c) => "taxId" in (c as object));
    const companyNameBranches = customerFilter.isNot.OR.filter(
      (c) => "companyName" in (c as object)
    );
    assert.ok(taxIdBranches.length > 0);
    assert.ok(companyNameBranches.length > 0);
    for (const c of [...taxIdBranches, ...companyNameBranches]) {
      assert.doesNotMatch(JSON.stringify(c), /"AND"/);
    }
  });

  it("CNPJs oficiais do grupo continuam presentes na cláusula taxId", () => {
    const json = JSON.stringify(exclusion);
    assert.match(json, /72569510000195/); // Lazarios
    assert.match(json, /14055501000180/); // Koppetel
    assert.match(json, /55717719000130/); // SM
  });
});

// ---------------------------------------------------------------------------
// 2) Reconhecimento positivo preservado (funções em memória, não afetadas
//    pelo bug SQL, mas a missão exige confirmar que continuam corretas)
// ---------------------------------------------------------------------------

describe("reconhecimento positivo do grupo — preservado", () => {
  it("Lazarios por CNPJ, mesmo sem tradeName", () => {
    assert.equal(isEconomicGroupCnpj("72569510000195"), true);
    assert.equal(isEconomicGroupCompany({ cnpj: "72569510000195", name: null }), true);
  });

  it("Koppetel por CNPJ, mesmo sem tradeName", () => {
    assert.equal(isEconomicGroupCnpj("14055501000180"), true);
    assert.equal(isEconomicGroupCompany({ cnpj: "14055501000180", name: null }), true);
  });

  it("SM por CNPJ, mesmo sem tradeName", () => {
    assert.equal(isEconomicGroupCnpj("55717719000130"), true);
    assert.equal(isEconomicGroupCompany({ cnpj: "55717719000130", name: null }), true);
  });

  it("match por nome/tradeName continua reconhecendo o grupo", () => {
    assert.equal(isEconomicGroupName("Lazarios Comercio de Plasticos LTDA"), true);
    assert.equal(isEconomicGroupName("Koppetel"), true);
    assert.equal(isEconomicGroupName("SM Comercio de Plasticos LTDA - SM"), true);
  });

  it("cliente externo não é reconhecido como grupo", () => {
    assert.equal(isEconomicGroupCnpj("11111111000111"), false);
    assert.equal(isEconomicGroupName("Cliente Externo Ltda"), false);
    assert.equal(isEconomicGroupCompany({ cnpj: "11111111000111", name: "Cliente Externo Ltda" }), false);
  });
});

// ---------------------------------------------------------------------------
// 3) Teste matemático — avaliador de semântica SQL de três valores aplicado
//    à estrutura JSON real do where, sem precisar de Postgres.
// ---------------------------------------------------------------------------

type ThreeValued = true | false | null; // null representa SQL UNKNOWN

type TestCustomer = {
  taxId: string;
  companyName: string;
  tradeName: string | null;
};

function evalStringLeaf(
  value: string | null,
  op: { equals?: string; contains?: string; mode?: string; not?: null }
): ThreeValued {
  if ("not" in op && op.not === null) {
    // { field: { not: null } } → verdadeiro sse o valor não é NULL.
    return value !== null;
  }
  if (value === null) return null; // qualquer comparação com NULL é UNKNOWN em SQL.
  if (op.equals !== undefined) return value === op.equals;
  if (op.contains !== undefined) {
    const insensitive = op.mode === "insensitive";
    const hay = insensitive ? value.toLowerCase() : value;
    const needle = insensitive ? op.contains.toLowerCase() : op.contains;
    return hay.includes(needle);
  }
  return null;
}

function evalCustomerWhere(node: unknown, customer: TestCustomer): ThreeValued {
  const n = node as Record<string, unknown>;
  if ("AND" in n) {
    const results = (n.AND as unknown[]).map((c) => evalCustomerWhere(c, customer));
    return threeValuedAnd(results);
  }
  if ("OR" in n) {
    const results = (n.OR as unknown[]).map((c) => evalCustomerWhere(c, customer));
    return threeValuedOr(results);
  }
  // Folha: { fieldName: { equals/contains/not } }
  const [field, op] = Object.entries(n)[0] as [string, Record<string, unknown>];
  const value = customer[field as keyof TestCustomer] as string | null;
  return evalStringLeaf(value, op as { equals?: string; contains?: string; mode?: string; not?: null });
}

function threeValuedAnd(values: ThreeValued[]): ThreeValued {
  if (values.some((v) => v === false)) return false;
  if (values.some((v) => v === null)) return null;
  return true;
}

function threeValuedOr(values: ThreeValued[]): ThreeValued {
  if (values.some((v) => v === true)) return true;
  if (values.some((v) => v === null)) return null;
  return false;
}

function threeValuedNot(value: ThreeValued): ThreeValued {
  if (value === null) return null;
  return !value;
}

/** `WHERE <predicate>` só deixa passar quando o resultado é estritamente TRUE. */
function passesWhere(predicate: ThreeValued): boolean {
  return predicate === true;
}

/** Reproduz a estrutura ANTIGA (bugada): contains cru sobre tradeName, sem proteção. */
function buildOldBuggyCustomerOr(): unknown[] {
  return [
    { taxId: { equals: "72569510000195" } },
    { taxId: { equals: "14055501000180" } },
    { taxId: { equals: "55717719000130" } },
    { companyName: { contains: "Lazarios", mode: "insensitive" } },
    { tradeName: { contains: "Lazarios", mode: "insensitive" } }, // <- sem proteção
    { companyName: { contains: "Koppetel", mode: "insensitive" } },
    { tradeName: { contains: "Koppetel", mode: "insensitive" } }, // <- sem proteção
  ];
}

describe("teste matemático — TOTAL = GRUPO + EXTERNOS (semântica SQL de 3 valores)", () => {
  const population: TestCustomer[] = [
    { taxId: "11111111000111", companyName: "Cliente Externo A Ltda", tradeName: null },
    { taxId: "22222222000122", companyName: "Cliente Externo B Ltda", tradeName: "Externo B" },
    { taxId: "33333333000133", companyName: "Cliente Externo C Ltda", tradeName: null },
    { taxId: "72569510000195", companyName: "Lazarios Comercio de Plasticos LTDA", tradeName: null },
    { taxId: "14055501000180", companyName: "Koppetel Comercio de Plasticos LTDA", tradeName: "Koppetel" },
  ];

  it("estrutura NOVA (null-safe): nenhum registro cai no buraco UNKNOWN — TOTAL = GRUPO + EXTERNOS", () => {
    const exclusion = buildEconomicGroupCustomerPrismaExclusion();
    const customerFilter = (exclusion as { Customer: { isNot: { OR: unknown[] } } }).Customer;
    const orNode = { OR: customerFilter.isNot.OR };

    let groupCount = 0;
    let externalCount = 0;
    let unknownHoleCount = 0;

    for (const customer of population) {
      const matchesGroup = evalCustomerWhere(orNode, customer); // true = é do grupo
      const isNotResult = threeValuedNot(matchesGroup); // isNot = NOT(is)
      const included = passesWhere(isNotResult); // WHERE só deixa passar TRUE

      if (matchesGroup === true) {
        groupCount += 1;
        assert.equal(included, false, `esperava grupo EXCLUÍDO: ${JSON.stringify(customer)}`);
      } else if (matchesGroup === false) {
        externalCount += 1;
        assert.equal(included, true, `esperava externo INCLUÍDO: ${JSON.stringify(customer)}`);
      } else {
        unknownHoleCount += 1;
      }
    }

    assert.equal(unknownHoleCount, 0, "nenhum registro pode cair no buraco UNKNOWN");
    assert.equal(groupCount, 2); // Lazarios + Koppetel
    assert.equal(externalCount, 3); // os 3 externos, incluindo os 2 com tradeName null
    assert.equal(population.length, groupCount + externalCount);
  });

  it("estrutura ANTIGA (bugada): externos com tradeName null caem no buraco UNKNOWN e são excluídos por engano", () => {
    const oldOrNode = { OR: buildOldBuggyCustomerOr() };

    let groupCount = 0;
    let externalCount = 0;
    let unknownHoleCount = 0;

    for (const customer of population) {
      const matchesGroup = evalCustomerWhere(oldOrNode, customer);
      const isNotResult = threeValuedNot(matchesGroup);
      const included = passesWhere(isNotResult);

      if (matchesGroup === true) groupCount += 1;
      else if (matchesGroup === false) externalCount += 1;
      else unknownHoleCount += 1;

      // Documenta o bug: cliente externo com tradeName null NÃO passa no WHERE
      // (o where antigo não os inclui nem os reconhece como grupo — eles somem).
      if (customer.tradeName === null && !isEconomicGroupCnpjInline(customer.taxId)) {
        assert.equal(
          included,
          false,
          `BUG reproduzido: externo com tradeName null deveria sumir do WHERE antigo — ${JSON.stringify(customer)}`
        );
      }
    }

    // A propriedade TOTAL = GRUPO + EXTERNOS FALHA na versão antiga — prova do bug.
    assert.notEqual(population.length, groupCount + externalCount);
    assert.ok(unknownHoleCount > 0, "esperava pelo menos um registro caindo no buraco UNKNOWN na versão antiga");
  });
});

function isEconomicGroupCnpjInline(taxId: string): boolean {
  return ["72569510000195", "14055501000180", "55717719000130"].includes(taxId);
}
