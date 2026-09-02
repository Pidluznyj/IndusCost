/**
 * Retirada de material pelo tablet do Stock Collector.
 *
 * O que está sob prova, em uma frase: O TABLET NÃO CONSEGUE TIRAR O QUE NÃO
 * EXISTE, E NUNCA FICA SABENDO QUANTO EXISTE.
 *
 * São duas garantias com naturezas diferentes. A primeira é do motor de
 * estoque, e o risco aqui é a retirada burlá-la sem querer — bastaria o
 * contexto do dispositivo carregar `permissions` ou `allowNegativeStock` para
 * a trava sumir em silêncio. Por isso os testes rodam o motor de verdade, com
 * um Prisma falso, em vez de simular a regra.
 *
 * A segunda é desta tela: o mesmo aparelho faz contagem CEGA no mesmo setor,
 * então qualquer número de saldo que escape — no DTO, na mensagem de erro ou
 * na composição da lista — contamina a contagem.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  buildWithdrawalReason,
  COLLECTOR_INSUFFICIENT_STOCK_MESSAGE,
  COLLECTOR_ITEM_NOT_ELIGIBLE,
  COLLECTOR_WITHDRAWAL_MOVEMENT_TYPE,
  listCollectorWithdrawItems,
  parseWithdrawalPerson,
  parseWithdrawalQuantity,
  withdrawCollectorMaterial,
} from "./collectorWithdrawal.server.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Comentários citam os termos proibidos ao explicar a regra; só código conta. */
function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
    })
    .join("\n");
}

const SERVICE = "src/lib/inventory/collector/collectorWithdrawal.server.ts";
const ROUTES = "src/lib/inventory/collector/collectorRoutes.server.ts";
const PAGE = "src/components/inventory/collector/CollectorSectorPage.tsx";
const MIGRATION =
  "prisma/migrations/20260920120000_collector_material_withdrawal/migration.sql";

const DEVICE = { id: "11111111-1111-4111-8111-111111111111" };
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const WAREHOUSE_ID = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// Prisma falso — superfície suficiente para o motor real rodar.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function dec(n: number) {
  return new Prisma.Decimal(n);
}

function createFakePrisma(seed: {
  physical?: number;
  reserved?: number;
  blocked?: number;
  /** Quando false, o item não existe / não é elegível ao setor. */
  eligible?: boolean;
  controlsLocation?: boolean;
}) {
  const physical = seed.physical ?? 0;
  const reserved = seed.reserved ?? 0;
  const blocked = seed.blocked ?? 0;
  const eligible = seed.eligible !== false;

  const item = {
    id: ITEM_ID,
    code: "MP-0001",
    description: "Chapa de aço 2mm",
    unit: "KG",
    status: "ACTIVE" as const,
    itemType: "RAW_MATERIAL" as const,
    controlsStock: true,
    controlsLocation: seed.controlsLocation === true,
    allowsReservation: true,
    allowsBlock: true,
    materialId: "material-1" as string | null,
    materialCodeSnapshot: null,
    materialDescriptionSnapshot: null,
    lastKnownCost: null as unknown,
    averageCost: null as unknown,
  };

  const state = {
    balances: [
      {
        id: "balance-1",
        itemId: ITEM_ID,
        warehouseId: WAREHOUSE_ID,
        locationId: null as string | null,
        balanceKey: WAREHOUSE_ID,
        physicalQuantity: dec(physical),
        reservedQuantity: dec(reserved),
        blockedQuantity: dec(blocked),
        quarantineQuantity: dec(0),
        availableQuantity: dec(physical - reserved - blocked),
      } as Row,
    ],
    movements: [] as Row[],
    auditLogs: [] as Row[],
    withdrawals: [] as Row[],
  };

  let seq = 0;
  const nextId = (p: string) => `${p}-${(seq += 1)}`;

  const balanceTable = {
    findUnique: async ({ where }: { where: Row }) => {
      const w = where as { id?: string; itemId_balanceKey?: Row };
      if (w.id) return state.balances.find((b) => b.id === w.id) ?? null;
      const key = w.itemId_balanceKey as { itemId: string; balanceKey: string } | undefined;
      if (!key) return null;
      return (
        state.balances.find(
          (b) => b.itemId === key.itemId && b.balanceKey === key.balanceKey
        ) ?? null
      );
    },
    findFirst: async ({ where }: { where: Row }) => {
      const w = where as Row;
      // O predicado do setor entra como `item: {...}` — item inelegível some.
      if (w.item && !eligible) return null;
      const row = state.balances.find(
        (b) =>
          (w.itemId == null || b.itemId === w.itemId) &&
          (w.warehouseId == null || b.warehouseId === w.warehouseId) &&
          (w.locationId === undefined || b.locationId === (w.locationId ?? null))
      );
      if (!row) return null;
      return { ...row, item };
    },
    findMany: async ({ where }: { where: Row }) => {
      if (!eligible) return [];
      const w = where as Row;
      return state.balances
        .filter((b) => w.warehouseId == null || b.warehouseId === w.warehouseId)
        .map((b) => ({ ...b, item, location: null }));
    },
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: nextId("balance"), ...data };
      state.balances.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.balances.find((b) => b.id === (where as { id: string }).id);
      if (!row) throw new Error("saldo não encontrado");
      Object.assign(row, data);
      return row;
    },
  };

  const client: Row = {
    $queryRaw: async () => [{ "?column?": 1 }],
    inventoryItem: {
      findUnique: async () => (eligible ? item : null),
      findFirst: async () => (eligible ? item : null),
    },
    inventoryWarehouse: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "ACTIVE",
        allowsMovements: true,
      }),
    },
    inventoryLocation: { findUnique: async () => null },
    inventoryBalance: balanceTable,
    inventoryMovement: {
      findFirst: async ({ where }: { where: Row }) => {
        const w = where as Row;
        return (
          state.movements.find((m) =>
            w.idempotencyKey != null
              ? m.idempotencyKey === w.idempotencyKey
              : m.originType === w.originType && m.originId === w.originId
          ) ?? null
        );
      },
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: nextId("movement"), ...data };
        state.movements.push(row);
        return row;
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: nextId("audit"), ...data };
        state.auditLogs.push(row);
        return row;
      },
    },
    inventoryCollectorWithdrawal: {
      findUnique: async ({ where }: { where: { operationId: string } }) =>
        state.withdrawals.find((w) => w.operationId === where.operationId) ?? null,
      create: async ({ data }: { data: Row }) => {
        if (state.withdrawals.some((w) => w.operationId === data.operationId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: Prisma.prismaVersion.client,
            meta: { target: ["operationId"] },
          });
        }
        const row: Row = { id: nextId("withdrawal"), ...data };
        state.withdrawals.push(row);
        return row;
      },
    },
  };

  // O motor abre a própria transação em createInventoryMovement; aqui o
  // serviço já abre a dele, e o fake executa tudo no mesmo "cliente".
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);

  return { client: client as never, state, item };
}

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    operationId: "op-1",
    itemId: ITEM_ID,
    warehouseId: WAREHOUSE_ID,
    locationId: null,
    quantity: 4,
    person: "João Silva",
    sector: "RAW_MATERIAL" as const,
    ...overrides,
  } as Parameters<typeof withdrawCollectorMaterial>[1];
}

// ===========================================================================
// 1) A trava de saldo vale para o tablet
// ===========================================================================

describe("retirada · não tira o que não existe", () => {
  it("1. pedir mais que o físico é barrado e NADA é gravado", async () => {
    const db = createFakePrisma({ physical: 3 });
    await assert.rejects(
      () => withdrawCollectorMaterial(db.client, baseInput({ quantity: 5 }), DEVICE),
      (e: unknown) => e instanceof InventoryValidationError
    );
    assert.equal(db.state.movements.length, 0, "nenhum movimento pode sobrar");
    assert.equal(db.state.withdrawals.length, 0);
    assert.equal(
      Number(db.state.balances[0]!.physicalQuantity),
      3,
      "o saldo não pode ter sido tocado"
    );
  });

  it("2. estoque reservado também barra — disponível é o que manda", async () => {
    const db = createFakePrisma({ physical: 10, reserved: 10 });
    await assert.rejects(
      () => withdrawCollectorMaterial(db.client, baseInput({ quantity: 1 }), DEVICE),
      (e: unknown) => e instanceof InventoryValidationError
    );
    assert.equal(db.state.movements.length, 0);
  });

  it("3. retirada válida debita exatamente o pedido", async () => {
    const db = createFakePrisma({ physical: 10 });
    const result = await withdrawCollectorMaterial(db.client, baseInput(), DEVICE);

    assert.equal(result.ok, true);
    assert.equal(result.idempotent, false);
    assert.equal(result.quantity, 4);
    assert.equal(result.withdrawnBy, "João Silva");
    assert.equal(db.state.movements.length, 1);
    assert.equal(Number(db.state.balances[0]!.physicalQuantity), 6);
  });

  it("4. o movimento é sempre REQUISITION_EXIT e leva o nome no motivo", async () => {
    const db = createFakePrisma({ physical: 10 });
    await withdrawCollectorMaterial(db.client, baseInput(), DEVICE);
    const movement = db.state.movements[0]!;
    assert.equal(movement.movementType, COLLECTOR_WITHDRAWAL_MOVEMENT_TYPE);
    assert.equal(movement.movementType, "REQUISITION_EXIT");
    assert.match(String(movement.reason), /João Silva/);
    assert.equal(movement.createdByUserId, null, "dispositivo não é usuário humano");
  });

  it("5. a operação fica registrada com quem retirou", async () => {
    const db = createFakePrisma({ physical: 10 });
    await withdrawCollectorMaterial(db.client, baseInput(), DEVICE);
    const row = db.state.withdrawals[0]!;
    assert.equal(row.withdrawnBy, "João Silva");
    assert.equal(row.deviceId, DEVICE.id);
    assert.equal(row.movementId, db.state.movements[0]!.id);
  });
});

// ===========================================================================
// 2) O saldo nunca chega à tela
// ===========================================================================

describe("retirada · o saldo não vaza", () => {
  it("6. o erro de saldo insuficiente não contém número algum", async () => {
    const db = createFakePrisma({ physical: 3 });
    await assert.rejects(
      () => withdrawCollectorMaterial(db.client, baseInput({ quantity: 5 }), DEVICE),
      (e: unknown) => {
        const err = e as InventoryValidationError;
        assert.equal(err.message, COLLECTOR_INSUFFICIENT_STOCK_MESSAGE);
        assert.doesNotMatch(err.message, /\d/, "mensagem não pode citar quantidade");
        return true;
      }
    );
  });

  it("7. a resposta de sucesso não carrega saldo", async () => {
    const db = createFakePrisma({ physical: 10 });
    const result = await withdrawCollectorMaterial(db.client, baseInput(), DEVICE);
    const payload = JSON.stringify(result);
    for (const leak of [
      "physicalQuantity",
      "availableQuantity",
      "reservedQuantity",
      "previousPhysicalBalance",
      "nextPhysicalBalance",
    ]) {
      assert.ok(!payload.includes(leak), `resposta não pode conter ${leak}`);
    }
    assert.deepEqual(Object.keys(result).sort(), [
      "idempotent",
      "item",
      "ok",
      "quantity",
      "withdrawnBy",
    ]);
  });

  it("8. a lista de materiais não expõe quantidade", async () => {
    const db = createFakePrisma({ physical: 0 });
    const items = await listCollectorWithdrawItems(db.client, {
      warehouseId: WAREHOUSE_ID,
      sector: "RAW_MATERIAL",
    });
    assert.equal(items.length, 1, "item de saldo zero continua listado");
    assert.deepEqual(Object.keys(items[0]!).sort(), [
      "code",
      "description",
      "itemId",
      "locationCode",
      "locationId",
      "locationName",
      "unit",
    ]);
  });

  it("9. item com saldo zero aparece na lista — pertencer não revela estoque", async () => {
    // Se a lista escondesse itens zerados, a própria composição dela contaria
    // ao operador onde há estoque, justamente o que a contagem cega evita.
    const zero = await listCollectorWithdrawItems(
      createFakePrisma({ physical: 0 }).client,
      { warehouseId: WAREHOUSE_ID, sector: "RAW_MATERIAL" }
    );
    const cheio = await listCollectorWithdrawItems(
      createFakePrisma({ physical: 999 }).client,
      { warehouseId: WAREHOUSE_ID, sector: "RAW_MATERIAL" }
    );
    assert.deepEqual(zero, cheio);
  });
});

// ===========================================================================
// 3) Entradas do operador
// ===========================================================================

describe("retirada · validação de entrada", () => {
  it("10. nome é obrigatório e vai aparado", () => {
    assert.throws(() => parseWithdrawalPerson(""), /nome de quem está retirando/i);
    assert.throws(() => parseWithdrawalPerson("   "), /nome de quem está retirando/i);
    assert.throws(() => parseWithdrawalPerson(null), /nome de quem está retirando/i);
    assert.equal(parseWithdrawalPerson("  Maria  "), "Maria");
  });

  it("11. quantidade tem de ser maior que zero", () => {
    for (const bad of [0, -1, Number.NaN, "", "abc", null]) {
      assert.throws(
        () => parseWithdrawalQuantity(bad),
        (e: unknown) => (e as InventoryValidationError).code === "INVALID_QUANTITY",
        `deveria recusar ${JSON.stringify(bad)}`
      );
    }
    assert.equal(parseWithdrawalQuantity("2,5"), 2.5);
    assert.equal(parseWithdrawalQuantity(1.23456789), 1.234568);
  });

  it("12. o motivo é composto no servidor e nunca fica vazio", () => {
    // Motivo vazio faria o motor recusar com REASON_REQUIRED.
    assert.match(buildWithdrawalReason("Ana"), /Ana/);
    assert.ok(buildWithdrawalReason("A").trim().length > 0);
  });

  it("13. item fora do setor é recusado antes de qualquer débito", async () => {
    const db = createFakePrisma({ physical: 10, eligible: false });
    await assert.rejects(
      () => withdrawCollectorMaterial(db.client, baseInput(), DEVICE),
      (e: unknown) => (e as InventoryValidationError).code === COLLECTOR_ITEM_NOT_ELIGIBLE
    );
    assert.equal(db.state.movements.length, 0);
  });
});

// ===========================================================================
// 4) Dois toques não debitam duas vezes
// ===========================================================================

describe("retirada · idempotência", () => {
  it("14. mesmo operationId debita uma vez só", async () => {
    const db = createFakePrisma({ physical: 10 });
    const first = await withdrawCollectorMaterial(db.client, baseInput(), DEVICE);
    const second = await withdrawCollectorMaterial(db.client, baseInput(), DEVICE);

    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(db.state.withdrawals.length, 1);
    assert.equal(Number(db.state.balances[0]!.physicalQuantity), 6, "debitou uma vez");
    assert.equal(second.quantity, 4);
    assert.equal(second.withdrawnBy, "João Silva");
  });

  it("15. operationId diferente é outra retirada", async () => {
    const db = createFakePrisma({ physical: 10 });
    await withdrawCollectorMaterial(db.client, baseInput({ operationId: "op-1" }), DEVICE);
    await withdrawCollectorMaterial(
      db.client,
      baseInput({ operationId: "op-2", quantity: 1 }),
      DEVICE
    );
    assert.equal(db.state.withdrawals.length, 2);
    assert.equal(Number(db.state.balances[0]!.physicalQuantity), 5);
  });

  it("16. operationId vazio é recusado", async () => {
    const db = createFakePrisma({ physical: 10 });
    await assert.rejects(
      () => withdrawCollectorMaterial(db.client, baseInput({ operationId: "  " }), DEVICE),
      (e: unknown) =>
        (e as InventoryValidationError).code === "COLLECTOR_OPERATION_ID_REQUIRED"
    );
  });
});

// ===========================================================================
// 5) Fronteiras no código-fonte
// ===========================================================================

describe("retirada · fronteiras do código", () => {
  it("17. o serviço não abre nenhuma válvula de escape do motor", () => {
    const service = codeOnly(read(SERVICE));
    for (const bypass of [
      /allowNegativeStock/,
      /allowNegativeAvailable/,
      /allowOverReservation/,
      /permissions/,
      /inventory\.movements\.override/,
    ]) {
      assert.doesNotMatch(service, bypass, `serviço não pode citar ${bypass}`);
    }
  });

  it("18. não existe motor de movimentação paralelo", () => {
    const service = codeOnly(read(SERVICE));
    assert.match(service, /createInventoryMovementInTx/);
    assert.doesNotMatch(service, /inventoryMovement\.create/);
    assert.doesNotMatch(service, /inventoryBalance\.(update|create)/);
  });

  it("19. o tipo do movimento é constante, nunca vem do cliente", () => {
    const service = codeOnly(read(SERVICE));
    assert.match(service, /COLLECTOR_WITHDRAWAL_MOVEMENT_TYPE = "REQUISITION_EXIT"/);
    const routes = codeOnly(read(ROUTES));
    assert.doesNotMatch(routes, /body\.movementType/);
    assert.doesNotMatch(routes, /movementType:/);
  });

  it("20. o serviço não seleciona quantidade de saldo em lugar nenhum", () => {
    const service = codeOnly(read(SERVICE));
    assert.doesNotMatch(service, /physicalQuantity/);
    assert.doesNotMatch(service, /availableQuantity/);
  });

  it("21. as duas rotas novas exigem dispositivo autorizado", () => {
    const routes = codeOnly(read(ROUTES));
    for (const path of [
      '"/api/inventory/collector/withdraw/items"',
      '"/api/inventory/collector/withdraw"',
    ]) {
      const idx = routes.indexOf(path);
      assert.ok(idx > 0, `rota ausente: ${path}`);
      const header = routes.slice(idx, routes.indexOf("async (", idx));
      assert.match(header, /deviceAuth/, `${path} sem deviceAuth`);
    }
  });

  it("22. a migration é aditiva", () => {
    const sql = read(MIGRATION)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toUpperCase();
    for (const destructive of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM", "ALTER TABLE"]) {
      assert.ok(!sql.includes(destructive), `migration não pode conter ${destructive}`);
    }
    assert.ok(sql.includes("CREATE TABLE"));
    assert.ok(sql.includes("CREATE UNIQUE INDEX"), "idempotência precisa do UNIQUE");
  });
});

// ===========================================================================
// 6) Navegação: nunca sair do deep-link
// ===========================================================================

describe("retirada · navegação", () => {
  const page = read(PAGE);

  it("23. o Voltar é estado local, nunca navegação de rota", () => {
    const code = codeOnly(page);
    assert.doesNotMatch(code, /useNavigate/);
    assert.doesNotMatch(code, /history\.back/);
    assert.doesNotMatch(code, /<Link/);
    assert.match(code, /SCREEN_PARENT/);
    assert.match(code, /CollectorBackButton/);
  });

  it("24. toda tela declara para onde volta", () => {
    const block = page.slice(page.indexOf("const SCREEN_PARENT"));
    const map = block.slice(0, block.indexOf("};"));
    for (const screen of [
      "home",
      "list",
      "count",
      "finalize",
      "done",
      "withdrawPick",
      "withdrawQty",
      "withdrawDone",
    ]) {
      assert.match(map, new RegExp(`\\b${screen}:`), `${screen} sem destino de Voltar`);
    }
  });

  it("25. finalize NÃO volta para a lista", () => {
    // finalizeCollectorSession já tirou a sessão de COUNTING: a lista ofereceria
    // um botão "Finalizar contagem" que falharia com INVALID_STATUS.
    const block = page.slice(page.indexOf("const SCREEN_PARENT"));
    const map = block.slice(0, block.indexOf("};"));
    assert.match(map, /finalize: "home"/);
    assert.doesNotMatch(map, /finalize: "list"/);
  });

  it("26. as telas de boot sem saída ganharam retentativa", () => {
    assert.match(page, /Tentar novamente/);
    assert.match(codeOnly(page), /retryBoot/);
  });

  it("27. a tela inicial oferece contagem E retirada", () => {
    assert.match(page, /Nova contagem/);
    assert.match(page, /Retirar material/);
  });

  it("28. a quantidade usa o parser puro, não Number\\(\\) cru", () => {
    const code = codeOnly(page);
    assert.match(code, /parseQuantityText/);
    assert.doesNotMatch(code, /Number\(qtyText/);
  });
});
