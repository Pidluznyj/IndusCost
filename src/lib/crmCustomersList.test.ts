import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import {
  aggregateCustomerActivities,
  buildCrmCustomerListAndWhere,
  buildCrmCustomerListFilterWhere,
  buildCrmCustomerListScopeWhere,
  buildCrmCustomerSearchWhere,
  enrichCustomersFromSalesOrders,
  fetchCrmManualOwnerCustomerIds,
  fetchCrmSellerScopeCustomerIds,
  parseCrmCustomerListFilter,
  parseCrmCustomerListSellerQuery,
  resolveCrmCustomerListScopeWhere,
  resolveCrmCustomerListSellerScopeFilter,
  type CrmSellerScopeFilter,
} from "@/src/lib/crmCustomersList.js";
import { CRM_CUSTOMER_LIST_FILTERS } from "@/src/lib/crmCustomersListTypes.js";
import {
  CRM_PORTFOLIO_FILTER_CHIPS,
  buildActivePortfolioFilterChips,
  computePortfolioEmptySummary,
} from "@/src/components/crm/crmCustomerPortfolioUi.js";

function findOr(
  where: Prisma.CustomerWhereInput | undefined,
  predicate: (clause: Prisma.CustomerWhereInput) => boolean
): boolean {
  const ors = (where?.OR ?? []) as Prisma.CustomerWhereInput[];
  return ors.some(predicate);
}

const NOW = new Date("2026-06-17T12:00:00.000Z");

function ownScope(): CrmCommercialAccessScope {
  return {
    dataScope: "own",
    externalSellerId: 464,
    responsible: "GISLENE LIMA",
    sellerIdentityKey: "gislene lima",
    canViewCommercialGeneral: false,
    canViewAllSellers: false,
    canViewOwnSellerData: true,
    sellerLocked: true,
    sellerLinked: true,
    blockedReason: null,
    blockedMessage: null,
  };
}

function globalScope(): CrmCommercialAccessScope {
  return {
    dataScope: "global",
    externalSellerId: null,
    responsible: null,
    sellerIdentityKey: null,
    canViewCommercialGeneral: true,
    canViewAllSellers: true,
    canViewOwnSellerData: true,
    sellerLocked: false,
    sellerLinked: true,
    blockedReason: null,
    blockedMessage: null,
  };
}

describe("crmCustomersList scope", () => {
  it("vendedor (own) aplica filtro de carteira do vendedor", () => {
    const where = buildCrmCustomerListScopeWhere(ownScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    assert.ok(where);
    assert.ok(where!.OR);
    assert.equal(Array.isArray(where!.OR), true);
  });

  it("gestor sem filtro de vendedor não restringe por vendedor", () => {
    const where = buildCrmCustomerListScopeWhere(globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    assert.equal(where, undefined);
  });

  it("gestor com filtro de vendedor restringe por SalesOrder ou responsável manual", () => {
    const where = buildCrmCustomerListScopeWhere(globalScope(), {
      externalSellerId: 99,
      sellerIdentityKey: null,
    });
    assert.ok(where);
    assert.ok(where!.OR);
  });

  it("parseCrmCustomerListSellerQuery normaliza sellerIdentityKey", () => {
    const q = parseCrmCustomerListSellerQuery("12", "  GISLENE LIMA  ");
    assert.equal(q.externalSellerId, 12);
    assert.equal(q.sellerIdentityKey, "gislene lima");
  });
});

describe("crmCustomersList — escopo normalizado por vendedor (SQL)", () => {
  function captureQueryPrisma(returnIds: string[]) {
    const captured: { sql?: Prisma.Sql } = {};
    const client = {
      $queryRaw: async <T>(q: Prisma.Sql): Promise<T> => {
        captured.sql = q;
        return returnIds.map((id) => ({ id })) as unknown as T;
      },
    };
    return { client, captured };
  }

  function captureManualPrisma(returnIds: string[]) {
    const captured: { where?: Prisma.CrmCustomerCommercialOwnerWhereInput } = {};
    const client = {
      crmCustomerCommercialOwner: {
        findMany: async (args: {
          where: Prisma.CrmCustomerCommercialOwnerWhereInput;
          select: { customerId: true };
        }) => {
          captured.where = args.where;
          return returnIds.map((id) => ({ customerId: id }));
        },
      },
    };
    return { client, captured };
  }

  const gisleneFilter: CrmSellerScopeFilter = {
    externalSellerId: null,
    responsible: null,
    sellerIdentityKey: "gislene lima",
  };

  it("decisão pura: own usa o vínculo consolidado do usuário", () => {
    const decision = resolveCrmCustomerListSellerScopeFilter(ownScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    assert.deepEqual(decision, {
      externalSellerId: 464,
      responsible: "GISLENE LIMA",
      sellerIdentityKey: "gislene lima",
    });
  });

  it("decisão pura: global sem filtro = 'all'; com filtro = vendedor escolhido", () => {
    assert.equal(
      resolveCrmCustomerListSellerScopeFilter(globalScope(), {
        externalSellerId: null,
        sellerIdentityKey: null,
      }),
      "all"
    );
    assert.deepEqual(
      resolveCrmCustomerListSellerScopeFilter(globalScope(), {
        externalSellerId: null,
        sellerIdentityKey: "gislene lima",
      }),
      { externalSellerId: null, responsible: null, sellerIdentityKey: "gislene lima" }
    );
  });

  it("decisão pura: ID legado preservado quando não há sellerIdentityKey", () => {
    assert.deepEqual(
      resolveCrmCustomerListSellerScopeFilter(globalScope(), {
        externalSellerId: 464,
        sellerIdentityKey: null,
      }),
      { externalSellerId: 464, responsible: null, sellerIdentityKey: null }
    );
  });

  it("SQL por sellerIdentityKey normaliza espaços/acento/caixa (casa 'GISLENE  LIMA')", async () => {
    const { client, captured } = captureQueryPrisma(["c1", "c2"]);
    const ids = await fetchCrmSellerScopeCustomerIds(client, gisleneFilter);
    assert.deepEqual(ids, ["c1", "c2"]);
    const text = captured.sql!.strings.join(" ");
    // normalização SQL (mesma do dashboard): REGEXP_REPLACE de espaços + translate de acentos
    assert.match(text, /REGEXP_REPLACE/);
    assert.match(text, /translate/);
    assert.match(text, /nomusSellerName/);
    assert.match(text, /NOT IN \('CANCELLED', 'ERROR'\)/);
    // a chave comparada é a forma normalizada com 1 espaço
    assert.ok(captured.sql!.values.includes("gislene lima"));
  });

  it("SQL por externalSellerId (legado) compara o ID, sem normalizar nome", async () => {
    const { client, captured } = captureQueryPrisma(["c9"]);
    const ids = await fetchCrmSellerScopeCustomerIds(client, {
      externalSellerId: 464,
      responsible: null,
      sellerIdentityKey: null,
    });
    assert.deepEqual(ids, ["c9"]);
    const text = captured.sql!.strings.join(" ");
    assert.match(text, /"externalSellerId"/);
    assert.ok(captured.sql!.values.includes(464));
  });

  it("manual: busca clientes com vínculo manual ativo pela mesma sellerIdentityKey", async () => {
    const { client, captured } = captureManualPrisma(["m1"]);
    const ids = await fetchCrmManualOwnerCustomerIds(client, gisleneFilter);
    assert.deepEqual(ids, ["m1"]);
    assert.deepEqual(captured.where, { isActive: true, sellerIdentityKey: "gislene lima" });
  });

  it("resolver une pedidos + manual e deduplica", async () => {
    const fakePrisma = {
      $queryRaw: async <T>(_q: Prisma.Sql): Promise<T> =>
        [{ id: "a" }, { id: "b" }] as unknown as T,
      crmCustomerCommercialOwner: {
        findMany: async () => [{ customerId: "b" }, { customerId: "c" }],
      },
    } as unknown as Parameters<typeof resolveCrmCustomerListScopeWhere>[0];

    const where = await resolveCrmCustomerListScopeWhere(fakePrisma, globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: "gislene lima",
    });
    assert.deepEqual(where, { id: { in: ["a", "b", "c"] } });
  });

  it("resolver: global sem filtro não restringe (undefined)", async () => {
    const fakePrisma = {
      $queryRaw: async () => [],
      crmCustomerCommercialOwner: { findMany: async () => [] },
    } as unknown as Parameters<typeof resolveCrmCustomerListScopeWhere>[0];
    const where = await resolveCrmCustomerListScopeWhere(fakePrisma, globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    assert.equal(where, undefined);
  });

  it("resolver: filtro ativo sem clientes retorna carteira vazia (não vaza todos)", async () => {
    const fakePrisma = {
      $queryRaw: async () => [],
      crmCustomerCommercialOwner: { findMany: async () => [] },
    } as unknown as Parameters<typeof resolveCrmCustomerListScopeWhere>[0];
    const where = await resolveCrmCustomerListScopeWhere(fakePrisma, globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: "vendedor inexistente",
    });
    assert.deepEqual(where, { id: { in: [] } });
  });

  it("own e global usam o MESMO caminho de resolução de escopo", async () => {
    const calls: CrmSellerScopeFilter[] = [];
    const fakePrisma = {
      $queryRaw: async <T>(_q: Prisma.Sql): Promise<T> => [{ id: "x" }] as unknown as T,
      crmCustomerCommercialOwner: { findMany: async () => [] },
    } as unknown as Parameters<typeof resolveCrmCustomerListScopeWhere>[0];

    const ownWhere = await resolveCrmCustomerListScopeWhere(fakePrisma, ownScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    const globalWhere = await resolveCrmCustomerListScopeWhere(fakePrisma, globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: "gislene lima",
    });
    void calls;
    assert.deepEqual(ownWhere, { id: { in: ["x"] } });
    assert.deepEqual(globalWhere, { id: { in: ["x"] } });
  });
});

describe("crmCustomersList filters", () => {
  it("parseCrmCustomerListFilter aceita filtros da carteira", () => {
    for (const f of CRM_CUSTOMER_LIST_FILTERS) {
      assert.equal(parseCrmCustomerListFilter(f), f);
    }
    assert.equal(parseCrmCustomerListFilter("invalid"), "all");
  });

  it("filtro withoutContact30 exclui contatos recentes", () => {
    const where = buildCrmCustomerListFilterWhere("withoutContact30", NOW);
    assert.ok(where);
    assert.ok(where!.NOT);
  });

  it("filtro withPurchaseHistory exige pedidos válidos", () => {
    const where = buildCrmCustomerListFilterWhere("withPurchaseHistory", NOW);
    assert.deepEqual(where, {
      salesOrders: { some: { status: { notIn: ["CANCELLED", "ERROR"] } } },
    });
  });

  it("chips da UI cobrem filtros obrigatórios", () => {
    const values = CRM_PORTFOLIO_FILTER_CHIPS.map((c) => c.value);
    assert.ok(values.includes("withPurchaseHistory"));
    assert.ok(values.includes("withOpenPortfolio"));
    assert.ok(values.includes("overdueFollowUp"));
  });
});

describe("crmCustomersList enrichment", () => {
  it("aggregateCustomerActivities calcula último contato e follow-up atrasado", () => {
    const map = aggregateCustomerActivities(
      [
        {
          customerId: "c1",
          contactDate: new Date("2026-05-01T10:00:00.000Z"),
          createdAt: new Date("2026-05-01T10:00:00.000Z"),
          nextActionAt: new Date("2026-06-01T10:00:00.000Z"),
          status: "OPEN",
        },
      ],
      NOW
    );
    const agg = map.get("c1");
    assert.ok(agg);
    assert.equal(agg!.contactCount, 1);
    assert.equal(agg!.hasOverdueFollowUp, true);
  });

  it("enrichCustomersFromSalesOrders marca carteira aberta sem NF processada", () => {
    const map = enrichCustomersFromSalesOrders([
      {
        customerId: "c1",
        responsible: "Vendedor A",
        externalSellerId: 10,
        status: "SENT",
        issueDate: new Date("2026-06-01"),
        nomusRawResponse: { nfes: [] },
      },
    ]);
    const row = map.get("c1");
    assert.ok(row);
    assert.equal(row!.hasOpenPortfolio, true);
    assert.equal(row!.hasPurchaseHistory, true);
    assert.equal(row!.primarySellerResponsible, "Vendedor A");
  });
});

describe("crmCustomersList UI integration", () => {
  it("estado vazio resume carteira listada", () => {
    const summary = computePortfolioEmptySummary([
      {
        id: "1",
        displayName: "A",
        tradeName: null,
        taxId: "1",
        email: null,
        phone: null,
        city: null,
        state: null,
        address: null,
        lastContactAt: null,
        nextFollowUpAt: null,
        contactCount: 0,
        primarySellerResponsible: null,
        primaryExternalSellerId: null,
        hasPurchaseHistory: true,
        hasOpenPortfolio: true,
        hasOverdueFollowUp: false,
      },
    ]);
    assert.equal(summary.totalListed, 1);
    assert.equal(summary.withOpenPortfolio, 1);
    assert.equal(summary.withoutContact, 1);
  });

  it("CrmModule usa cockpit e filtro de vendedor na carteira", () => {
    const crm = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    const portfolio = readFileSync(
      join(process.cwd(), "src/components/crm/CrmCustomerPortfolioSection.tsx"),
      "utf8"
    );
    assert.match(crm, /CrmCustomerPortfolioSection/);
    assert.match(portfolio, /CrmCustomerAccountCockpit/);
    assert.match(crm, /portfolioSellerKey/);
    assert.match(crm, /sellerIdentityKey/);
    assert.match(crm, /showCustomerPortfolioGrid/);
  });

  it("endpoints de detalhe validam escopo do cliente", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /isCustomerInCrmCommercialScope/);
  });

  it("endpoint lista clientes delega fetchCrmCustomersList com escopo", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const block = server.slice(
      server.indexOf('app.get("/api/crm/customers"'),
      server.indexOf('app.get("/api/crm/customers/:customerId/profile"')
    );
    assert.match(block, /fetchCrmCustomersList/);
    assert.match(block, /requireCrmCommercialDataScope/);
    assert.match(block, /parseCrmCustomerListSellerQuery/);
  });

  it("endpoint aceita sellerName como alias de sellerIdentityKey", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const block = server.slice(
      server.indexOf('app.get("/api/crm/customers"'),
      server.indexOf('app.get("/api/crm/customers/:customerId/profile"')
    );
    assert.match(block, /sellerName/);
  });
});

describe("crmCustomersList — filtro de vendedor + busca + permissão (casos obrigatórios)", () => {
  const gisleneIds = ["g1", "g2"];

  function scopePrisma(orderIds: string[], manualIds: string[] = []) {
    return {
      $queryRaw: async <T>(_q: Prisma.Sql): Promise<T> =>
        orderIds.map((id) => ({ id })) as unknown as T,
      crmCustomerCommercialOwner: {
        findMany: async () => manualIds.map((id) => ({ customerId: id })),
      },
    } as unknown as Parameters<typeof resolveCrmCustomerListScopeWhere>[0];
  }

  it("1. admin/gestor pode listar clientes de qualquer vendedor escolhido", () => {
    const decision = resolveCrmCustomerListSellerScopeFilter(globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: "rodrigo",
    });
    assert.deepEqual(decision, {
      externalSellerId: null,
      responsible: null,
      sellerIdentityKey: "rodrigo",
    });
  });

  it("2. vendedor comum vê somente a própria carteira (ignora query de vendedor)", () => {
    const decision = resolveCrmCustomerListSellerScopeFilter(ownScope(), {
      externalSellerId: 999,
      sellerIdentityKey: "outro vendedor",
    });
    assert.deepEqual(decision, {
      externalSellerId: 464,
      responsible: "GISLENE LIMA",
      sellerIdentityKey: "gislene lima",
    });
  });

  it("3. filtro por vendedor retorna somente clientes daquele vendedor", async () => {
    const where = await resolveCrmCustomerListScopeWhere(
      scopePrisma(gisleneIds),
      globalScope(),
      { externalSellerId: null, sellerIdentityKey: "gislene lima" }
    );
    assert.deepEqual(where, { id: { in: gisleneIds } });
  });

  it("4. busca textual é combinada por AND com o escopo do vendedor", async () => {
    const scopeWhere = await resolveCrmCustomerListScopeWhere(
      scopePrisma(gisleneIds),
      globalScope(),
      { externalSellerId: null, sellerIdentityKey: "gislene lima" }
    );
    const searchWhere = buildCrmCustomerSearchWhere("Esmaltec");
    const combined = buildCrmCustomerListAndWhere([scopeWhere, undefined, searchWhere]);
    assert.ok(Array.isArray(combined.AND));
    const parts = combined.AND as Prisma.CustomerWhereInput[];
    assert.ok(parts.some((p) => JSON.stringify(p) === JSON.stringify(scopeWhere)));
    assert.ok(parts.some((p) => Array.isArray(p.OR)));
  });

  it("5. busca por nome/razão/fantasia do cliente", () => {
    const where = buildCrmCustomerSearchWhere("Esmaltec");
    assert.ok(
      findOr(where, (c) => c.companyName?.contains === "Esmaltec" && c.companyName?.mode === "insensitive")
    );
    assert.ok(findOr(where, (c) => c.tradeName?.contains === "Esmaltec"));
  });

  it("6. busca por documento/CNPJ entra via ids pré-resolvidos por dígitos", () => {
    const where = buildCrmCustomerSearchWhere("12.345", ["c-doc-1", "c-doc-2"]);
    assert.ok(findOr(where, (c) => Array.isArray(c.id?.in)));
    const idClause = (where?.OR as Prisma.CustomerWhereInput[]).find((c) => c.id?.in);
    assert.deepEqual(idClause?.id?.in, ["c-doc-1", "c-doc-2"]);
  });

  it("7. busca por cidade e UF", () => {
    const where = buildCrmCustomerSearchWhere("PR");
    assert.ok(findOr(where, (c) => c.city?.contains === "PR"));
    assert.ok(findOr(where, (c) => c.state?.contains === "PR"));
  });

  it("8. Gislene com sellerIdentityKey normalizado retorna clientes (espaços/caixa)", async () => {
    const parsed = parseCrmCustomerListSellerQuery("464", "  GISLENE   LIMA  ");
    assert.equal(parsed.sellerIdentityKey, "gislene lima");
    const where = await resolveCrmCustomerListScopeWhere(scopePrisma(gisleneIds), globalScope(), parsed);
    assert.deepEqual(where, { id: { in: gisleneIds } });
  });

  it("9. Gislene + busca textual restringe à carteira dela", async () => {
    const scopeWhere = await resolveCrmCustomerListScopeWhere(
      scopePrisma(gisleneIds),
      globalScope(),
      { externalSellerId: 464, sellerIdentityKey: "gislene lima" }
    );
    const searchWhere = buildCrmCustomerSearchWhere("Esmaltec");
    const combined = buildCrmCustomerListAndWhere([scopeWhere, searchWhere]);
    const parts = combined.AND as Prisma.CustomerWhereInput[];
    assert.deepEqual(
      parts.find((p) => p.id)?.id,
      { in: gisleneIds }
    );
    assert.ok(parts.some((p) => Array.isArray(p.OR)));
  });

  it("10. vendedor passando outro sellerId continua restrito à própria carteira", async () => {
    // No backend o sellerQuery é ignorado para escopo 'own' (rota nem repassa o filtro).
    const where = await resolveCrmCustomerListScopeWhere(
      scopePrisma(gisleneIds),
      ownScope(),
      { externalSellerId: 999, sellerIdentityKey: "rodrigo" }
    );
    // Resolve usa o vínculo do próprio usuário (Gislene), não o vendedor 999/rodrigo.
    assert.deepEqual(where, { id: { in: gisleneIds } });
  });

  it("chips de filtros ativos resumem vendedor, busca e filtro rápido", () => {
    const chips = buildActivePortfolioFilterChips({
      sellerLabel: "GISLENE LIMA",
      searchTerm: "Esmaltec",
      filter: "withOpenPortfolio",
    });
    assert.equal(chips.length, 3);
    assert.ok(chips.some((c) => c.key === "seller" && c.label.includes("GISLENE LIMA")));
    assert.ok(chips.some((c) => c.key === "search" && c.label.includes("Esmaltec")));
    assert.ok(chips.some((c) => c.key === "filter"));
  });

  it("chips de filtros ativos ficam vazios sem filtros (filter 'all')", () => {
    const chips = buildActivePortfolioFilterChips({
      sellerLabel: null,
      searchTerm: "  ",
      filter: "all",
    });
    assert.deepEqual(chips, []);
  });

  it("seção da carteira expõe limpar filtros e estado vazio do vendedor", () => {
    const portfolio = readFileSync(
      join(process.cwd(), "src/components/crm/CrmCustomerPortfolioSection.tsx"),
      "utf8"
    );
    assert.match(portfolio, /Limpar filtros/);
    assert.match(portfolio, /Nenhum cliente encontrado para este vendedor com os filtros aplicados\./);
    assert.match(portfolio, /buildActivePortfolioFilterChips/);
  });
});
