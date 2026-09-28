/**
 * Registro de contato no servidor (crmContactRegistration.server.ts) sobre um
 * Prisma em memória: responsável e usuário derivados no servidor, payload
 * adulterado ignorado, telefone/e-mail só no contato, snapshot histórico e
 * nenhuma gravação parcial. Numeração = lista de testes obrigatórios do spec.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedCustomerCommercialOwner } from "@/src/lib/crmCustomerCommercialOwnerTypes.js";
import {
  resolveCommercialResponsibleForCustomer,
  type CommercialResponsibleInjection,
} from "./crmCommercialResponsibleResolver.js";
import {
  loadCrmContactContext,
  registerCrmContact,
  type CrmContactRegistrationResult,
} from "./crmContactRegistration.server.js";

type Row = Record<string, any>;

const CUSTOMER_ID = "0f0f0f0f-0000-4000-8000-000000000001";
const NO_OWNER_ID = "0f0f0f0f-0000-4000-8000-000000000002";
const ORDER_ID = "0e0e0e0e-0000-4000-8000-000000000001";
const ANA = { id: "a1a1a1a1-0000-4000-8000-000000000001", name: "Ana Souza" };
const BRUNO = { id: "b2b2b2b2-0000-4000-8000-000000000002", name: "Bruno Lima" };

function owner(name: string, key: string, externalId: number | null): CommercialResponsibleInjection {
  return {
    sellerCanonicalName: name,
    sellerResponsibleName: name,
    sellerIdentityKey: key,
    sellerExternalId: externalId,
    isActive: true,
  };
}

function createFakeDb() {
  const state = {
    customers: [
      {
        id: CUSTOMER_ID,
        companyName: "Metalúrgica Alfa Ltda",
        taxId: "12.345.678/0001-90",
        phone: "(11) 3333-4444",
        email: "compras@alfa.com.br",
      },
      { id: NO_OWNER_ID, companyName: "Beta Comércio", taxId: "98.765.432/0001-10", phone: null, email: null },
    ] as Row[],
    salesOrders: [{ id: ORDER_ID, customerId: CUSTOMER_ID }] as Row[],
    activities: [] as Row[],
    writes: [] as string[],
  };
  const owners = new Map<string, CommercialResponsibleInjection>([
    [CUSTOMER_ID, owner("Carla Mendes", "CARLA MENDES", 17)],
  ]);
  let resolverCalls = 0;
  let resolverFails = false;
  const forbidden = (name: string) => async () => {
    state.writes.push(name);
    throw new Error(`escrita proibida: ${name}`);
  };
  let seq = 0;
  const client = {
    customer: {
      findUnique: async (args: Row) => {
        const row = state.customers.find((c) => c.id === args.where.id);
        return row ? { ...row } : null;
      },
      update: forbidden("customer.update"),
      updateMany: forbidden("customer.updateMany"),
      upsert: forbidden("customer.upsert"),
    },
    commercialActivity: {
      create: async (args: Row) => {
        state.writes.push("commercialActivity.create");
        const { Customer, SalesOrder, Proposal, ...fields } = args.data as Row;
        const row: Row = {
          id: `ca-${(seq += 1)}`,
          subject: null,
          scheduledAt: null,
          completedAt: null,
          priority: null,
          closeReason: null,
          createdAt: new Date("2026-09-28T13:05:00Z"),
          ...fields,
          customerId: Customer?.connect?.id,
          salesOrderId: SalesOrder?.connect?.id ?? null,
          proposalId: Proposal?.connect?.id ?? null,
          Proposal: null,
          SalesOrder: null,
        };
        state.activities.push(row);
        return row;
      },
    },
    salesOrder: {
      findFirst: async (args: Row) =>
        state.salesOrders.find((o) => o.id === args.where.id && o.customerId === args.where.customerId)
          ? { id: args.where.id }
          : null,
    },
    proposal: { findFirst: async () => null },
  };
  const deps = {
    resolveCommercialOwner: async (customerId: string) => {
      resolverCalls += 1;
      if (resolverFails) throw new Error("banco indisponível");
      return owners.get(customerId) ?? null;
    },
  };
  return {
    db: client as never,
    state,
    owners,
    deps,
    resolverCalls: () => resolverCalls,
    failResolver: () => {
      resolverFails = true;
    },
  };
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contactDate: "2026-09-28T13:00:00.000Z",
    channel: "WHATSAPP",
    reason: "PROPOSAL",
    result: "PROPOSAL_PRESENTED",
    summary: "Cliente gostou da condição e pediu revisão do prazo de pagamento.",
    nextActionType: "SEND_PROPOSAL",
    nextActionAt: "2026-10-02T13:00:00.000Z",
    nextActionDescription: "Revisar prazo para 45 dias e incluir os produtos X e Y.",
    phoneUsed: "(11) 3333-4444",
    emailUsed: "compras@alfa.com.br",
    ...over,
  };
}

function expectOk(result: CrmContactRegistrationResult) {
  if (result.ok === false) assert.fail(`esperava sucesso: ${result.error}`);
  return result.activity;
}

describe("contexto do modal (GET …/commercial-activities/context)", () => {
  it("1/2/5/7/8. cliente correto, responsável do cliente, usuário logado, telefone e e-mail do cadastro", async () => {
    const fake = createFakeDb();
    const context = await loadCrmContactContext(
      fake.db,
      { customerId: CUSTOMER_ID, actor: ANA },
      fake.deps
    );
    assert.deepEqual(context, {
      customer: {
        id: CUSTOMER_ID,
        displayName: "Metalúrgica Alfa Ltda",
        taxId: "12.345.678/0001-90",
        phone: "(11) 3333-4444",
        email: "compras@alfa.com.br",
      },
      commercialOwner: { name: "Carla Mendes", identityKey: "CARLA MENDES", externalSellerId: 17 },
      registeredBy: ANA,
    });
  });

  it("cliente sem responsável: null (nada inventado); cliente inexistente: null", async () => {
    const fake = createFakeDb();
    const context = await loadCrmContactContext(fake.db, { customerId: NO_OWNER_ID, actor: ANA }, fake.deps);
    assert.equal(context?.commercialOwner, null);
    assert.equal(context?.customer.phone, null);
    assert.equal(
      await loadCrmContactContext(fake.db, { customerId: "0f0f0f0f-0000-4000-8000-00000000000f", actor: ANA }, fake.deps),
      null
    );
  });
});

describe("gravação (POST …/commercial-activities)", () => {
  it("4/6. responsável e 'registrado por' adulterados no payload são ignorados", async () => {
    const fake = createFakeDb();
    const activity = expectOk(
      await registerCrmContact(
        fake.db,
        {
          customerId: CUSTOMER_ID,
          actor: ANA,
          body: body({
            assignedTo: "Vendedor Falso",
            commercialResponsibleId: "x",
            commercialOwnerIdentityKey: "HACK",
            commercialOwnerExternalSellerId: 999,
            createdByUserId: BRUNO.id,
            createdByName: "Comercial Lazarios",
            registeredByUserId: BRUNO.id,
            status: "DONE",
          }),
        },
        fake.deps
      )
    );
    const row = fake.state.activities[0]!;
    assert.equal(row.assignedTo, "Carla Mendes");
    assert.equal(row.commercialOwnerIdentityKey, "CARLA MENDES");
    assert.equal(row.commercialOwnerExternalSellerId, 17);
    assert.equal(row.createdByUserId, ANA.id);
    assert.equal(row.createdByName, "Ana Souza");
    assert.equal(row.status, "OPEN", "status vem da próxima ação, não do payload");
    assert.equal(activity.assignedTo, "Carla Mendes");
  });

  it("9/10/11. telefone/e-mail alternativos ficam só no contato; cadastro do cliente intacto", async () => {
    const fake = createFakeDb();
    const before = JSON.stringify(fake.state.customers);
    expectOk(
      await registerCrmContact(
        fake.db,
        {
          customerId: CUSTOMER_ID,
          actor: ANA,
          body: body({ phoneUsed: "(11) 98888-7777", emailUsed: "diretoria@alfa.com.br" }),
        },
        fake.deps
      )
    );
    const row = fake.state.activities[0]!;
    assert.equal(row.createdByPhone, "(11) 98888-7777");
    assert.equal(row.createdByEmail, "diretoria@alfa.com.br");
    assert.equal(JSON.stringify(fake.state.customers), before);
    assert.deepEqual(fake.state.writes, ["commercialActivity.create"], "nenhuma escrita no cliente");
  });

  it("28/30. resumo, resultado, motivo, canal e próxima ação gravados como códigos", async () => {
    const fake = createFakeDb();
    const activity = expectOk(
      await registerCrmContact(
        fake.db,
        { customerId: CUSTOMER_ID, actor: ANA, body: body({ salesOrderId: ORDER_ID }) },
        fake.deps
      )
    );
    const row = fake.state.activities[0]!;
    assert.equal(row.description, "Cliente gostou da condição e pediu revisão do prazo de pagamento.");
    assert.equal(row.channel, "WHATSAPP");
    assert.equal(row.reason, "PROPOSAL");
    assert.equal(row.activityType, "PROPOSAL");
    assert.equal(row.outcome, "PROPOSAL_PRESENTED");
    assert.equal(row.nextActionType, "SEND_PROPOSAL");
    assert.equal(row.nextActionAt.toISOString(), "2026-10-02T13:00:00.000Z");
    assert.equal(row.nextActionDescription, "Revisar prazo para 45 dias e incluir os produtos X e Y.");
    assert.equal(row.contactDate.toISOString(), "2026-09-28T13:00:00.000Z");
    assert.equal(row.salesOrderId, ORDER_ID);
    assert.equal(activity.nextActionType, "SEND_PROPOSAL");
    assert.equal(activity.createdByUserId, ANA.id);
  });

  it("26/27. 'Nenhuma ação necessária': sem data (null), detalhamento opcional, status Concluído", async () => {
    const fake = createFakeDb();
    expectOk(
      await registerCrmContact(
        fake.db,
        {
          customerId: CUSTOMER_ID,
          actor: ANA,
          body: body({
            reason: "POST_SALE",
            result: "CUSTOMER_SATISFIED",
            nextActionType: "NONE",
            nextActionAt: null,
            nextActionDescription: "",
          }),
        },
        fake.deps
      )
    );
    const row = fake.state.activities[0]!;
    assert.equal(row.nextActionType, "NONE");
    assert.equal(row.nextActionAt, null);
    assert.equal(row.nextActionDescription, null);
    assert.equal(row.status, "DONE");
  });
});

describe("histórico, validação e consistência", () => {
  it("31/32. contato antigo mantém o responsável e o usuário daquele momento", async () => {
    const fake = createFakeDb();
    expectOk(await registerCrmContact(fake.db, { customerId: CUSTOMER_ID, actor: ANA, body: body() }, fake.deps));
    // Depois: carteira troca de responsável e outro usuário registra.
    fake.owners.set(CUSTOMER_ID, owner("Diego Rocha", "DIEGO ROCHA", null));
    expectOk(await registerCrmContact(fake.db, { customerId: CUSTOMER_ID, actor: BRUNO, body: body() }, fake.deps));
    const [first, second] = fake.state.activities;
    assert.equal(first!.assignedTo, "Carla Mendes");
    assert.equal(first!.createdByName, "Ana Souza");
    assert.equal(first!.commercialOwnerExternalSellerId, 17);
    assert.equal(second!.assignedTo, "Diego Rocha");
    assert.equal(second!.createdByName, "Bruno Lima");
    assert.equal(second!.commercialOwnerExternalSellerId, null);
  });

  it("cliente sem responsável: registra com responsável vazio", async () => {
    const fake = createFakeDb();
    expectOk(await registerCrmContact(fake.db, { customerId: NO_OWNER_ID, actor: ANA, body: body() }, fake.deps));
    const row = fake.state.activities[0]!;
    assert.equal(row.assignedTo, null);
    assert.equal(row.commercialOwnerIdentityKey, null);
    assert.equal(row.commercialOwnerExternalSellerId, null);
  });

  it("22/24/25/35. inválido responde 400 com erros por campo e não grava nada", async () => {
    const fake = createFakeDb();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ result: "" }, "result"],
      [{ result: "CUSTOMER_SATISFIED" }, "result"],
      [{ nextActionType: "" }, "nextActionType"],
      [{ nextActionType: "ROUTE_TO_QUALITY" }, "nextActionType"],
      [{ nextActionAt: "" }, "nextActionAt"],
      [{ nextActionAt: "2026-09-01T10:00:00.000Z" }, "nextActionAt"],
      [{ nextActionDescription: "  " }, "nextActionDescription"],
      [{ summary: "" }, "summary"],
      [{ channel: "FAX" }, "channel"],
      [{ nextActionType: "NONE", nextActionAt: "2026-10-02T13:00:00.000Z" }, "nextActionAt"],
    ];
    for (const [over, field] of cases) {
      const result = await registerCrmContact(
        fake.db,
        { customerId: CUSTOMER_ID, actor: ANA, body: body(over) },
        fake.deps
      );
      if (result.ok === true) assert.fail(`deveria recusar ${JSON.stringify(over)}`);
      assert.equal(result.status, 400);
      assert.ok(result.fieldErrors?.[field as keyof typeof result.fieldErrors], `${field}: ${JSON.stringify(over)}`);
    }
    assert.equal(fake.state.activities.length, 0);
    assert.deepEqual(fake.state.writes, []);
    assert.equal(fake.resolverCalls(), 0, "validação acontece antes de ler o responsável");
  });

  it("36. uma única escrita; falha ao ler o responsável aborta sem gravar", async () => {
    const ok = createFakeDb();
    expectOk(await registerCrmContact(ok.db, { customerId: CUSTOMER_ID, actor: ANA, body: body() }, ok.deps));
    assert.deepEqual(ok.state.writes, ["commercialActivity.create"]);

    const failing = createFakeDb();
    failing.failResolver();
    await assert.rejects(() =>
      registerCrmContact(failing.db, { customerId: CUSTOMER_ID, actor: ANA, body: body() }, failing.deps)
    );
    assert.deepEqual(failing.state.writes, []);
  });

  it("cliente inexistente → 404; pedido de outro cliente → 400, sem gravar", async () => {
    const fake = createFakeDb();
    const missing = await registerCrmContact(
      fake.db,
      { customerId: "0f0f0f0f-0000-4000-8000-00000000000f", actor: ANA, body: body() },
      fake.deps
    );
    assert.equal(missing.ok === false && missing.status, 404);
    const foreignOrder = await registerCrmContact(
      fake.db,
      { customerId: NO_OWNER_ID, actor: ANA, body: body({ salesOrderId: ORDER_ID }) },
      fake.deps
    );
    assert.equal(foreignOrder.ok === false && foreignOrder.status, 400);
    assert.deepEqual(fake.state.writes, []);
  });
});

describe("resolvedor do responsável para gravação", () => {
  function manual(name: string): ResolvedCustomerCommercialOwner {
    return {
      source: "MANUAL",
      sellerCanonicalName: name,
      sellerResponsibleName: name,
      sellerExternalId: 21,
      sellerIdentityKey: name.toUpperCase(),
      sellerAliasExternalIds: [],
      confidence: "HIGH",
      updatedAt: null,
      updatedByName: null,
    };
  }

  it("usa o dono manual ativo; setor administrativo não vira responsável; erro não é engolido", async () => {
    const found = await resolveCommercialResponsibleForCustomer(
      CUSTOMER_ID,
      async () => new Map([[CUSTOMER_ID, manual("Carla Mendes")]])
    );
    assert.equal(found?.sellerCanonicalName, "Carla Mendes");
    assert.equal(found?.sellerExternalId, 21);
    const admin = await resolveCommercialResponsibleForCustomer(
      CUSTOMER_ID,
      async () => new Map([[CUSTOMER_ID, manual("FINANCEIRO")]])
    );
    assert.equal(admin, null);
    assert.equal(await resolveCommercialResponsibleForCustomer(CUSTOMER_ID, async () => new Map()), null);
    await assert.rejects(() =>
      resolveCommercialResponsibleForCustomer(CUSTOMER_ID, async () => {
        throw new Error("banco indisponível");
      })
    );
  });
});
