/**
 * Collector no celular — setor configurável (STANDARD).
 *
 * Regras de tela puras (capacidades, mensagens de erro, boot), a tela em si
 * (landing Contagem / Retirada, sem tocar no fluxo dos setores fixos) e o
 * caminho completo pelas rotas reais do aparelho: QR → contexto → contagem →
 * finalizar → aplicar → retirada.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  callCollectorRoute,
  createCollectorCountFakeDb,
  type FakeItemSeed,
} from "@/src/lib/inventory/collector/collectorCountFakeDb.js";
import { mapCollectorBootError } from "./collectorBootError";
import {
  collectorOperationErrorMessage,
  collectorSectorRequestKey,
  formatCollectorQuantity,
  standardSectorFromContext,
} from "./collectorSectorMessages";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const PAGE = "src/components/inventory/collector/CollectorSectorPage.tsx";
const ROUTES = "src/lib/inventory/collector/collectorRoutes.server.ts";

const WH_ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CC = "cc000000-0000-4000-8000-000000000001";
const PAPER = "00000001-1111-4111-8111-111111111111";
const PEN = "00000002-1111-4111-8111-111111111111";

/** Homologação: itens administrativos no almoxarifado ADMINISTRATIVO, zero saldo. */
function admDb(overrides: { status?: "ACTIVE" | "INACTIVE"; allowsCounting?: boolean; allowsWithdrawal?: boolean; extraItems?: FakeItemSeed[] } = {}) {
  return createCollectorCountFakeDb({
    warehouses: [{ id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo" }],
    items: [
      { id: PAPER, code: "ADM-001", description: "Papel A4", unit: "PCT", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_ADM },
      { id: PEN, code: "ADM-002", description: "Caneta azul", unit: "UN", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_ADM },
      ...(overrides.extraItems ?? []),
    ],
    sectors: [
      {
        id: "5ec70000-0000-4000-8000-000000000001",
        code: "ADMINISTRATIVO",
        name: "Estoque Administrativo",
        slug: "administrativo",
        itemType: "ADMINISTRATIVE_SUPPLY",
        warehouseId: WH_ADM,
        sessionCodePrefix: "ADM",
        allowsCounting: overrides.allowsCounting ?? true,
        allowsWithdrawal: overrides.allowsWithdrawal ?? true,
        status: overrides.status ?? "ACTIVE",
        defaultCostCenterId: CC,
      },
    ],
    costCenters: [{ id: CC }],
  });
}

type Db = ReturnType<typeof admDb>;
const get = (db: Db, path: string, query: Record<string, string>) =>
  callCollectorRoute(db.client, "get", path, { query });
const post = (db: Db, path: string, body: Record<string, unknown>, params?: Record<string, string>) =>
  callCollectorRoute(db.client, "post", path, { body, params });

// ===========================================================================
describe("celular · capacidades e mensagens (puro)", () => {
  it("1. setor fixo não é tratado como configurável; STANDARD usa as flags do servidor", () => {
    assert.equal(standardSectorFromContext({ code: "RAW_MATERIAL", label: "Matéria-prima" }), null);
    assert.equal(standardSectorFromContext(undefined), null);
    assert.deepEqual(
      standardSectorFromContext({
        code: "ADMINISTRATIVO",
        label: "Estoque Administrativo",
        strategy: "STANDARD",
        allowsCounting: true,
        allowsWithdrawal: false,
      }),
      { label: "Estoque Administrativo", allowsCounting: true, allowsWithdrawal: false }
    );
    // Capacidade ausente no payload conta como negada.
    assert.deepEqual(standardSectorFromContext({ code: "X", label: "X", strategy: "STANDARD" }), {
      label: "X",
      allowsCounting: false,
      allowsWithdrawal: false,
    });
  });

  it("1b. setor configurável é pedido ao servidor pelo slug; setor fixo, pelo código", () => {
    assert.equal(
      collectorSectorRequestKey(
        { code: "ESTOQUE_ADM", label: "Adm", slug: "adm", strategy: "STANDARD" },
        "adm"
      ),
      "adm"
    );
    // Sem slug no payload, vale o slug do QR — nunca o código.
    assert.equal(
      collectorSectorRequestKey({ code: "ESTOQUE_ADM", label: "Adm", strategy: "STANDARD" }, "adm"),
      "adm"
    );
    assert.equal(
      collectorSectorRequestKey({ code: "RAW_MATERIAL", label: "Matéria-prima" }, "raw-material"),
      "RAW_MATERIAL"
    );
    assert.equal(collectorSectorRequestKey(undefined, "componentes"), "componentes");
    const page = read(PAGE);
    assert.equal(page.match(/collectorSectorRequestKey\(boot\.context\.sector, sectorParam\)/g)?.length, 4);
    assert.doesNotMatch(page, /sector: boot\.context\.sector\?\.code \?\? sectorParam/);
  });

  it("2. cada erro conhecido vira uma frase clara ao operador", () => {
    const say = (code: string, message = "msg do servidor", status = 400) =>
      collectorOperationErrorMessage({ status, code, message });
    assert.match(say("COLLECTOR_ITEM_NOT_ELIGIBLE", "x", 404), /não pertence a este setor ou está inativo/);
    assert.match(say("WAREHOUSE_NOT_ELIGIBLE"), /almoxarifado não pertence/i);
    assert.match(say("COLLECTOR_SECTOR_INACTIVE"), /setor está inativo/);
    assert.match(say("COLLECTOR_COUNTING_DENIED", "x", 403), /não permite contagem/);
    assert.match(say("COLLECTOR_WITHDRAWAL_DENIED", "x", 403), /não permite retirada/);
    assert.match(say("COUNT_LINE_VERSION_CONFLICT", "x", 409), /Outro aparelho alterou/);
    assert.match(say("COUNT_OPERATION_IDEMPOTENCY_CONFLICT", "x", 409), /já foi enviada/);
    assert.match(say("COLLECTOR_DEVICE_UNAUTHORIZED", "x", 403), /não está autorizado/);
    assert.match(say("COST_CENTER_REQUIRED"), /centro de custo/);
    // Saldo insuficiente e sessão incompatível: a frase do servidor já é a certa.
    assert.equal(
      say("COLLECTOR_INSUFFICIENT_STOCK", "Não há material suficiente para essa retirada."),
      "Não há material suficiente para essa retirada."
    );
    assert.match(
      say("COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE", "Já existe uma conferência (MP-20260901-001).", 409),
      /MP-20260901-001/
    );
  });

  it("3. erro inesperado nunca mostra detalhe técnico", () => {
    const stack = "TypeError: Cannot read properties of undefined\n    at handler (server.ts:10:5)";
    const shown = collectorOperationErrorMessage(
      { status: 500, code: null, message: stack },
      "Erro ao registrar retirada."
    );
    assert.equal(shown, "Erro ao registrar retirada.");
    assert.doesNotMatch(shown, /TypeError|server\.ts|at /);
    assert.match(
      collectorOperationErrorMessage({ status: null, code: null, message: "Failed to fetch" }),
      /Sem conexão/
    );
  });

  it("4. boot: QR de setor desconhecido / inativo é erro do setor, não do aparelho", () => {
    const unknown = mapCollectorBootError({ status: 400, code: "COLLECTOR_INVALID_SECTOR", message: "x" });
    assert.equal(unknown.phase, "error");
    assert.match(unknown.message, /Setor não encontrado/);
    const inactive = mapCollectorBootError({ status: 400, code: "COLLECTOR_SECTOR_INACTIVE", message: "x" });
    assert.equal(inactive.phase, "error");
    assert.match(inactive.message, /inativo/);
    for (const code of ["COLLECTOR_SECTOR_MISCONFIGURED", "COLLECTOR_SECTOR_WAREHOUSE_INACTIVE"]) {
      assert.equal(mapCollectorBootError({ status: 400, code, message: "x" }).phase, "error", code);
    }
    // O que já existia continua igual.
    assert.equal(
      mapCollectorBootError({ status: 403, code: "COLLECTOR_DEVICE_UNAUTHORIZED", message: null }).phase,
      "unauthorized"
    );
    assert.equal(
      mapCollectorBootError({ status: 400, code: "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR", message: null }).phase,
      "configuration_error"
    );
  });

  it("5. quantidade na tela: vírgula decimal, sem zeros à direita", () => {
    assert.equal(formatCollectorQuantity(12, "UN"), "12 UN");
    assert.equal(formatCollectorQuantity(2.5, "KG"), "2,5 KG");
    assert.equal(formatCollectorQuantity(0), "0");
  });
});

// ===========================================================================
describe("celular · tela do setor", () => {
  const page = read(PAGE);

  it("6. landing do setor configurável: pergunta e dois botões grandes, pelas capacidades do servidor", () => {
    assert.match(page, /O que deseja fazer\?/);
    const block = page.slice(
      page.indexOf('screen.name === "home" && standardSector'),
      page.indexOf('screen.name === "home" && !standardSector')
    );
    assert.ok(block.length > 0, "bloco da landing STANDARD não encontrado");
    assert.match(block, /standardSector\.allowsCounting \? \(/);
    assert.match(block, /standardSector\.allowsWithdrawal \? \(/);
    assert.match(block, /Contagem/);
    assert.match(block, /Retirada/);
    assert.equal(block.match(/min-h-\[88px\]/g)?.length, 2, "alvos de toque grandes");
    assert.doesNotMatch(block, /<select/, "almoxarifado é fixo: sem seletor");
    assert.match(page, /standardSectorFromContext\(boot\.context\.sector\)/);
  });

  it("7. setores fixos seguem na tela de sempre", () => {
    assert.match(
      page,
      /const withdrawalEnabled =\s*\(boot\.context\.sector\?\.code \?\? sectorCodeFromSlug\(sectorParam\)\) === "RAW_MATERIAL"/
    );
    const legacyHome = page.slice(page.indexOf('screen.name === "home" && !standardSector'));
    assert.match(legacyHome, /Nova contagem/);
    assert.match(legacyHome, /\{withdrawalEnabled \? \(\s*<button/);
    assert.match(legacyHome, /Retirar material/);
  });

  it("8. retirada: saldo e saldo resultante vêm do servidor — a tela não calcula", () => {
    assert.match(page, /Saldo disponível/);
    assert.match(page, /Saldo resultante/);
    assert.match(page, /result\.remainingQuantity/);
    assert.doesNotMatch(page, /availableQuantity\s*-\s*/);
    assert.doesNotMatch(page, /remainingQuantity:\s*screen\.item/);
    // A contagem continua cega.
    assert.doesNotMatch(page, /item\.systemQuantity|item\.expectedQuantity/);
  });

  it("9. busca no servidor para o setor configurável; teclado numérico nas quantidades", () => {
    assert.match(page, /searchWithdrawItems/);
    assert.match(page, /Carregar mais/);
    assert.match(page, /window\.setTimeout\(\(\) => void searchWithdrawItems\(withdrawQ, 0\), 350\)/);
    assert.equal(page.match(/inputMode="decimal"/g)?.length, 2);
    assert.match(page, /Buscar código ou descrição/);
    assert.match(page, /Contagem salva:/, "retorno imediato ao salvar");
  });

  it("10. a tela não envia identidade, strategy, tipo de item nem tipo de movimento", () => {
    const client = read("src/components/inventory/collector/collectorClient.ts");
    for (const forbidden of [/deviceId/, /actorType/, /movementType/, /strategy:/, /costCenterId/]) {
      assert.doesNotMatch(
        client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
        forbidden,
        `cliente não pode enviar ${forbidden}`
      );
    }
    assert.doesNotMatch(page, /useNavigate|<Link/);
  });

  it("11. toda rota operacional do Collector exige dispositivo autorizado", () => {
    const routes = read(ROUTES);
    const declarations = routes.match(/app\.(get|post|patch)\(\s*"\/api\/inventory\/collector\/[^"]+",?\s*\w+/g) ?? [];
    assert.ok(declarations.length >= 12, "rotas do Collector não encontradas");
    for (const declaration of declarations) {
      assert.match(
        declaration,
        /deviceAuth|requireCollectorPeerIdentity/,
        `rota sem guarda: ${declaration}`
      );
    }
    assert.match(routes, /rejectIdentityFields\(req\.body\)/);
  });
});

// ===========================================================================
describe("celular · do QR à retirada, pelas rotas reais (ADMINISTRATIVO)", () => {
  it("12. landing: /collector/sector/administrativo resolve nome, almoxarifado e operações", async () => {
    const db = admDb();
    const context = await get(db, "/api/inventory/collector/context", { sector: "administrativo" });
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.equal(context.body.sector.label, "Estoque Administrativo");
    assert.equal(context.body.sector.strategy, "STANDARD");
    assert.equal(context.body.sector.allowsCounting, true);
    assert.equal(context.body.sector.allowsWithdrawal, true);
    assert.deepEqual(context.body.warehouses, [
      { id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo" },
    ]);
    assert.equal(context.body.operationalState, "READY");
    assert.equal(context.body.device.name, "Coletor 01");
    assert.deepEqual(standardSectorFromContext(context.body.sector), {
      label: "Estoque Administrativo",
      allowsCounting: true,
      allowsWithdrawal: true,
    });
  });

  it("13. slug desconhecido e setor inativo: erro claro, sem cair em outro setor", async () => {
    const unknown = await get(admDb(), "/api/inventory/collector/context", { sector: "nao-existe" });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, "COLLECTOR_INVALID_SECTOR");
    assert.equal(mapCollectorBootError({ status: 400, code: unknown.body.code, message: unknown.body.error }).phase, "error");

    const inactive = await get(admDb({ status: "INACTIVE" }), "/api/inventory/collector/context", {
      sector: "administrativo",
    });
    assert.equal(inactive.status, 400);
    assert.equal(inactive.body.code, "COLLECTOR_SECTOR_INACTIVE");
  });

  it("14. primeira contagem como implantação: 0 no sistema, 12 contados, saldo vira 12", async () => {
    const db = admDb();
    assert.equal(db.state.balances.length, 0, "itens existem, saldo não");

    const opened = await post(db, "/api/inventory/collector/count-sessions", {
      sector: "administrativo",
      operationId: "open-1",
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    const sessionId: string = opened.body.session.id;
    for (const line of db.state.lines) assert.equal(Number(line.systemQuantity), 0);
    assert.equal(db.state.balances.length, 0, "montar a sessão não cria saldo");

    // Continuar: mesmo toque de novo reaproveita a sessão.
    const resumed = await post(db, "/api/inventory/collector/count-sessions", {
      sector: "administrativo",
      operationId: "open-2",
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.session.id, sessionId);

    const list = await callCollectorRoute(db.client, "get", "/api/inventory/collector/count-sessions/:id/items", {
      params: { id: sessionId },
      query: { q: "papel" },
    });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.items.map((i: { code: string }) => i.code), ["ADM-001"]);
    assert.equal("systemQuantity" in list.body.items[0], false, "lista cega");

    const all = await callCollectorRoute(db.client, "get", "/api/inventory/collector/count-sessions/:id/items", {
      params: { id: sessionId },
    });
    for (const item of all.body.items as { lineId: string; itemId: string; version: number }[]) {
      const counted = await post(db, "/api/inventory/collector/count", {
        sessionId,
        lineId: item.lineId,
        countedQuantity: item.itemId === PAPER ? 12 : 0,
        expectedVersion: item.version,
        operationId: `count-${item.itemId}`,
      });
      assert.equal(counted.status, 200, JSON.stringify(counted.body));
    }

    const finalized = await post(
      db,
      "/api/inventory/collector/count-sessions/:id/finalize",
      { allowUncounted: false },
      { id: sessionId }
    );
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
    const applied = await post(
      db,
      "/api/inventory/collector/count-sessions/:id/apply-adjustments",
      { confirm: true, operationId: "apply-1" },
      { id: sessionId }
    );
    assert.equal(applied.status, 200, JSON.stringify(applied.body));

    assert.equal(db.balanceOf(PAPER, WH_ADM), 12, "saldo reflete a contagem");
    assert.deepEqual(
      db.state.movements.map((m) => [m.itemId, m.movementType, Number(m.quantity), m.originType]),
      [[PAPER, "POSITIVE_ADJUSTMENT", 12, "COUNT_SESSION"]],
      "o movimento oficial é o fato; nenhuma rotina especial de saldo inicial"
    );
    assert.ok(
      db.state.writes.filter((w) => w.startsWith("inventoryBalance.")).length > 0 &&
        db.state.balanceWriteStacks.every(
          (stack) =>
            /inventoryService\.server|inventoryRepository\.server/.test(stack) &&
            !/collectorStandard(Sector|Withdrawal)\.server/.test(stack)
        ),
      "saldo escrito só pelo motor de movimentos"
    );

    // Reaplicar (toque duplo) não gera segundo ajuste.
    const again = await post(
      db,
      "/api/inventory/collector/count-sessions/:id/apply-adjustments",
      { confirm: true, operationId: "apply-2" },
      { id: sessionId }
    );
    assert.equal(again.body.alreadyApplied, true);
    assert.equal(db.state.movements.length, 1);
  });

  it("15. contagem: versão conflitante e operação repetida", async () => {
    const db = admDb();
    const opened = await post(db, "/api/inventory/collector/count-sessions", { sector: "administrativo" });
    const sessionId: string = opened.body.session.id;
    const line = db.state.lines.find((l) => l.itemId === PAPER)!;
    const body = { sessionId, lineId: line.id, countedQuantity: 5, expectedVersion: 0, operationId: "c-1" };

    assert.equal((await post(db, "/api/inventory/collector/count", body)).status, 200);
    // Mesma operação reenviada: replay, sem segunda observação.
    const replay = await post(db, "/api/inventory/collector/count", body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(db.state.observations.length, 1);
    assert.equal(line.version, 1);

    // Outro aparelho com versão antiga: conflito, nada sobrescrito.
    const stale = await post(db, "/api/inventory/collector/count", { ...body, countedQuantity: 9, operationId: "c-2" });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, "COUNT_LINE_VERSION_CONFLICT");
    assert.equal(Number(line.countedQuantity), 5, "sem lost update");
    assert.match(
      collectorOperationErrorMessage({ status: 409, code: stale.body.code, message: stale.body.error }),
      /Outro aparelho/
    );
  });

  it("16. retirada: lista com saldo do servidor, débito pelo motor, saldo resultante devolvido", async () => {
    const db = createCollectorCountFakeDb({
      warehouses: [{ id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo" }],
      items: [{ id: PAPER, code: "ADM-001", description: "Papel A4", unit: "PCT", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_ADM }],
      balances: [{ itemId: PAPER, warehouseId: WH_ADM, physicalQuantity: 12 }],
      sectors: [
        {
          id: "5ec70000-0000-4000-8000-000000000001",
          code: "ADMINISTRATIVO",
          name: "Estoque Administrativo",
          slug: "administrativo",
          itemType: "ADMINISTRATIVE_SUPPLY",
          warehouseId: WH_ADM,
          sessionCodePrefix: "ADM",
          allowsWithdrawal: true,
          defaultCostCenterId: CC,
        },
      ],
      costCenters: [{ id: CC }],
    });

    const list = await callCollectorRoute(db.client, "get", "/api/inventory/collector/withdraw/items", {
      query: { sector: "administrativo", warehouseId: WH_ADM, q: "papel" },
    });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.items[0].availableQuantity, 12);
    assert.equal(list.body.balanceVisible, true);

    const body = {
      sector: "administrativo",
      operationId: "w-1",
      itemId: PAPER,
      warehouseId: WH_ADM,
      locationId: null,
      quantity: 2,
      person: "Maria",
      destination: "Recepção",
    };
    const done = await callCollectorRoute(db.client, "post", "/api/inventory/collector/withdraw", { body });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.quantity, 2);
    assert.equal(done.body.remainingQuantity, 10);
    assert.equal(done.body.item.description, "Papel A4");
    assert.equal(db.balanceOf(PAPER, WH_ADM), 10);

    // Toque duplo no botão: mesma intenção, um débito só.
    const twice = await callCollectorRoute(db.client, "post", "/api/inventory/collector/withdraw", { body });
    assert.equal(twice.body.idempotent, true);
    assert.equal(twice.body.remainingQuantity, 10);
    assert.equal(db.state.movements.length, 1);

    // Saldo insuficiente: barrado, com frase sem número.
    const tooMuch = await callCollectorRoute(db.client, "post", "/api/inventory/collector/withdraw", {
      body: { ...body, operationId: "w-2", quantity: 999 },
    });
    assert.equal(tooMuch.status, 400);
    assert.equal(tooMuch.body.code, "COLLECTOR_INSUFFICIENT_STOCK");
    assert.equal(db.balanceOf(PAPER, WH_ADM), 10);

    const [movement] = db.state.movements;
    assert.equal(movement!.movementType, "REQUISITION_EXIT");
    assert.equal(movement!.costCenterId, CC);
    assert.equal(movement!.originId, "w-1");
    assert.match(String(movement!.notes), /Estoque Administrativo.*Maria.*destino: Recepção/);
    const [record] = db.state.withdrawals;
    assert.deepEqual(
      [record!.sector, record!.itemId, record!.warehouseId, Number(record!.quantity), record!.withdrawnBy, record!.movementId],
      ["ADMINISTRATIVO", PAPER, WH_ADM, 2, "Maria", movement!.id]
    );
  });

  it("17. operação desligada no setor: a rota recusa, mesmo que a tela mandasse", async () => {
    const noCount = admDb({ allowsCounting: false });
    const count = await post(noCount, "/api/inventory/collector/count-sessions", { sector: "administrativo" });
    assert.equal(count.status, 403);
    assert.equal(count.body.code, "COLLECTOR_COUNTING_DENIED");

    const noWithdraw = admDb({ allowsWithdrawal: false });
    const withdraw = await post(noWithdraw, "/api/inventory/collector/withdraw", {
      sector: "administrativo",
      operationId: "w-x",
      itemId: PAPER,
      quantity: 1,
      person: "Maria",
    });
    assert.equal(withdraw.status, 403);
    assert.equal(withdraw.body.code, "COLLECTOR_WITHDRAWAL_DENIED");
    const context = await get(noWithdraw, "/api/inventory/collector/context", { sector: "administrativo" });
    assert.equal(context.body.sector.allowsWithdrawal, false);
  });

  it("17b. setor com código diferente do slug funciona de ponta a ponta pelo slug", async () => {
    const db = createCollectorCountFakeDb({
      warehouses: [{ id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo" }],
      items: [{ id: PAPER, code: "ADM-001", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_ADM }],
      balances: [{ itemId: PAPER, warehouseId: WH_ADM, physicalQuantity: 5 }],
      sectors: [
        {
          id: "5ec70000-0000-4000-8000-000000000009",
          code: "ESTOQUE_ADM",
          name: "Estoque Adm",
          slug: "adm",
          itemType: "ADMINISTRATIVE_SUPPLY",
          warehouseId: WH_ADM,
          sessionCodePrefix: "ADM",
          allowsWithdrawal: true,
          defaultCostCenterId: CC,
        },
      ],
      costCenters: [{ id: CC }],
    });
    const context = await callCollectorRoute(db.client, "get", "/api/inventory/collector/context", {
      query: { sector: "adm" },
    });
    assert.equal(context.status, 200, JSON.stringify(context.body));
    const key = collectorSectorRequestKey(context.body.sector, "adm");
    assert.equal(key, "adm");

    const opened = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count-sessions", {
      body: { sector: key },
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    // Com a conferência aberta a retirada continua valendo (só o saldo fica oculto).
    const list = await callCollectorRoute(db.client, "get", "/api/inventory/collector/withdraw/items", {
      query: { sector: key, warehouseId: WH_ADM },
    });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.items.length, 1);
    const withdrawn = await callCollectorRoute(db.client, "post", "/api/inventory/collector/withdraw", {
      body: { sector: key, operationId: "w-adm", itemId: PAPER, warehouseId: WH_ADM, quantity: 1, person: "Ana" },
    });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    assert.equal(db.state.withdrawals[0]!.sector, "ESTOQUE_ADM");
    // O código do setor não é um identificador de rota.
    const byCode = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count-sessions", {
      body: { sector: "ESTOQUE_ADM" },
    });
    assert.equal(byCode.status, 400);
    assert.equal(byCode.body.code, "COLLECTOR_INVALID_SECTOR");
  });

  it("18. QR dos setores fixos continua abrindo o fluxo de sempre", async () => {
    const MP = "00000009-1111-4111-8111-111111111111";
    const db = admDb({
      extraItems: [{ id: MP, code: "MP-001", itemType: "RAW_MATERIAL", materialId: "mat-1", defaultWarehouseId: WH_ADM }],
    });
    for (const [slug, code, label] of [
      ["raw-material", "RAW_MATERIAL", "Matéria-prima"],
      ["componentes", "COMPONENT", "Componentes"],
      ["produto-acabado", "FINISHED_PRODUCT", "Produto acabado"],
    ] as const) {
      const context = await get(db, "/api/inventory/collector/context", { sector: slug });
      assert.equal(context.status, 200, `${slug}: ${JSON.stringify(context.body)}`);
      assert.deepEqual(context.body.sector, { code, label });
      assert.equal(standardSectorFromContext(context.body.sector), null);
    }
    assert.equal(
      db.state.queries.filter((q) => q.startsWith("inventoryStockSector.")).length,
      0,
      "setores fixos não dependem da tabela de setores"
    );
  });
});
