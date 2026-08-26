/**
 * Filtro de cliente (autocomplete nome/CNPJ) nas listagens da Satisfação.
 *
 * Trava:
 *  1. `customerId` exato SEMPRE intersecta com o escopo do vendedor
 *     (cliente fora da carteira ⇒ condição impossível, nunca vazamento);
 *  2. `search` busca nome OU CNPJ — inclusive CNPJ pontuado vs snapshot só
 *     com dígitos (braço literal + braço só-dígitos);
 *  3. gates estruturais: as três telas (Convites, Resultados, Wizard) usam o
 *     CustomerAutocompleteFilter oficial e as rotas repassam `customerId`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSatisfactionInvitationService } from "@/src/lib/satisfaction/satisfactionInvitationService.server.js";

/** Prisma fake que CAPTURA o where do findMany/count de convites. */
function capturingPrisma() {
  const captured: { where: Record<string, unknown> | null } = { where: null };
  const prisma = {
    satisfactionSurveyInvitation: {
      count: async (args: { where: Record<string, unknown> }) => {
        captured.where = args.where;
        return 0;
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        captured.where = args.where;
        return [];
      },
    },
    commissionPerson: { findMany: async () => [] },
    commissionPersonAlias: { findMany: async () => [] },
  } as never;
  return { prisma, captured };
}

async function whereFor(filters: {
  search?: string | null;
  customerId?: string | null;
  allowedCustomerIds?: string[] | null;
}) {
  const { prisma, captured } = capturingPrisma();
  const service = createSatisfactionInvitationService({ prisma });
  await service.listInvitations("camp-1", {
    page: 1,
    pageSize: 25,
    status: null,
    search: filters.search ?? null,
    customerId: filters.customerId ?? null,
    allowedCustomerIds: filters.allowedCustomerIds ?? null,
  });
  assert.ok(captured.where, "where deveria ter sido capturado");
  return captured.where!;
}

describe("satisfação — filtro de cliente nas listagens", () => {
  it("customerId sem escopo → filtro exato simples", async () => {
    const where = await whereFor({ customerId: "cust-9" });
    assert.equal(where.customerId, "cust-9");
  });

  it("customerId COM escopo → interseção (equals + in) — nunca escapa da carteira", async () => {
    const where = await whereFor({
      customerId: "cust-9",
      allowedCustomerIds: ["cust-1", "cust-2"],
    });
    assert.deepEqual(where.customerId, {
      equals: "cust-9",
      in: ["cust-1", "cust-2"],
    });
  });

  it("sem customerId, escopo continua aplicado como antes", async () => {
    const where = await whereFor({ allowedCustomerIds: ["cust-1"] });
    assert.deepEqual(where.customerId, { in: ["cust-1"] });
  });

  it("search por CNPJ pontuado gera braço literal E braço só-dígitos", async () => {
    const where = await whereFor({ search: "20.866.930" });
    assert.deepEqual(where.OR, [
      { customerNameSnapshot: { contains: "20.866.930", mode: "insensitive" } },
      { customerTaxIdSnapshot: { contains: "20.866.930" } },
      { customerTaxIdSnapshot: { contains: "20866930" } },
    ]);
  });

  it("search por nome não duplica braço de dígitos", async () => {
    const where = await whereFor({ search: "Anderson" });
    assert.deepEqual(where.OR, [
      { customerNameSnapshot: { contains: "Anderson", mode: "insensitive" } },
      { customerTaxIdSnapshot: { contains: "Anderson" } },
    ]);
  });

  it("customerId em branco (espaços) é ignorado", async () => {
    const where = await whereFor({ customerId: "   " });
    assert.equal(where.customerId, undefined);
  });
});

/* ------------------------------------------------------------------ */
/*  Gates estruturais — autocomplete presente da criação ao acompanhamento */
/* ------------------------------------------------------------------ */

function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("satisfação — gates do autocomplete de cliente", () => {
  const screens = [
    ["Convites", "../../components/commercial/satisfaction/SatisfactionInvitationsPage.tsx"],
    ["Resultados", "../../components/commercial/satisfaction/SatisfactionResultsPage.tsx"],
    ["Wizard (criação)", "../../components/commercial/satisfaction/NewSurveyWizard.tsx"],
  ] as const;

  for (const [label, rel] of screens) {
    it(`${label}: usa o CustomerAutocompleteFilter oficial`, () => {
      const src = readSource(rel);
      assert.ok(
        src.includes("CustomerAutocompleteFilter"),
        `${label} deveria usar o autocomplete oficial de cliente`
      );
    });
  }

  it("rotas repassam customerId nas três listagens (convites, respostas, audiência)", () => {
    const routes = readSource("./satisfactionRoutes.ts");
    const occurrences = routes.match(/req\.query\.customerId/g) ?? [];
    assert.ok(
      occurrences.length >= 3,
      `esperava >=3 leituras de req.query.customerId, achou ${occurrences.length}`
    );
    assert.ok(
      /equals: customerIdFilter,\s*\r?\n?\s*in: allowed/.test(routes) ||
        routes.includes("in: allowed }"),
      "filtro exato deve intersectar com o escopo (equals + in)"
    );
  });

  it("client API expõe customerId nas três listagens", () => {
    const api = readSource(
      "../../components/commercial/satisfaction/satisfactionApi.ts"
    );
    for (const fn of ["listInvitations", "listResponses", "listCustomers"]) {
      const seg = api.slice(api.indexOf(`${fn}(`));
      assert.ok(
        seg.slice(0, 400).includes("customerId"),
        `${fn} deveria aceitar customerId`
      );
    }
  });
});
