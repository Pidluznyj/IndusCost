/**
 * Testes de atomicidade e do contrato de negócio do apply de engenharia
 * Nomus → IndusCost (applyEngineeringPlanMutations).
 *
 * Usa um client fake em memória com semântica de transação (escritas em
 * buffer; commit só sem erro; throw → descarta tudo) para provar:
 * OU O PLANO INTEIRO É APLICADO, OU NADA É.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEngineeringPlanMutations, type EngineeringApplyDbClient } from "./nomusEngineeringReconciliation";
import type {
  EngineeringBomActionPlan,
  EngineeringSyncPlan,
} from "./nomusEngineeringReconciliationTypes";

type BomRow = {
  id: string;
  productId: string;
  materialId: string | null;
  childProductId: string | null;
  quantity: number;
  lossPercentage: number;
  notes: string | null;
  sourceSystem: string | null;
  isNomusControlled: boolean;
  localException: boolean;
  nomusComponentCode: string | null;
};

type FakeDbState = {
  bomRows: Map<string, BomRow>;
  products: Map<string, { id: string; sku: string; name: string }>;
  changeLogs: number;
};

function cloneState(s: FakeDbState): FakeDbState {
  return {
    bomRows: new Map([...s.bomRows.entries()].map(([k, v]) => [k, { ...v }])),
    products: new Map([...s.products.entries()].map(([k, v]) => [k, { ...v }])),
    changeLogs: s.changeLogs,
  };
}

/**
 * Client fake com contagem de mutações e falha injetável na N-ésima mutação
 * de escrita. Trabalha sobre um estado clonado (buffer da "transação"); quem
 * chama decide commitar (copiar de volta) ou descartar, igual ao rollback.
 */
function createFakeTxClient(
  state: FakeDbState,
  options: { failAtWriteNumber?: number } = {}
): { client: EngineeringApplyDbClient; writes: string[] } {
  let writeCount = 0;
  const writes: string[] = [];
  let nextId = 1000;

  const registerWrite = (label: string) => {
    writeCount += 1;
    writes.push(label);
    if (options.failAtWriteNumber != null && writeCount === options.failAtWriteNumber) {
      throw new Error(`falha simulada na mutação #${writeCount} (${label})`);
    }
  };

  const client = {
    product: {
      create: async (args: { data: Record<string, unknown>; select?: unknown }) => {
        registerWrite("product.create");
        const id = `prod-${nextId++}`;
        const sku = String(args.data.sku);
        state.products.set(id, { id, sku, name: String(args.data.name ?? sku) });
        return { id, sku };
      },
      findUnique: async (args: { where: { id: string } }) => {
        const p = state.products.get(args.where.id);
        if (!p) return null;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          description: null,
          isNomusControlled: true,
          sourceSystem: "NOMUS",
          sourceExternalId: null,
        };
      },
      update: async (args: { where: { id: string } }) => {
        registerWrite("product.update");
        return state.products.get(args.where.id) ?? null;
      },
    },
    productBOM: {
      create: async (args: { data: Record<string, unknown>; select?: unknown }) => {
        registerWrite("productBOM.create");
        const id = `bom-${nextId++}`;
        state.bomRows.set(id, {
          id,
          productId: String(args.data.productId),
          materialId: (args.data.materialId as string | null) ?? null,
          childProductId: (args.data.childProductId as string | null) ?? null,
          quantity: Number(args.data.quantity),
          lossPercentage: Number(args.data.lossPercentage ?? 0),
          notes: (args.data.notes as string | null) ?? null,
          sourceSystem: (args.data.sourceSystem as string | null) ?? null,
          isNomusControlled: Boolean(args.data.isNomusControlled),
          localException: Boolean(args.data.localException),
          nomusComponentCode: (args.data.nomusComponentCode as string | null) ?? null,
        });
        return { id };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        registerWrite("productBOM.update");
        const row = state.bomRows.get(args.where.id);
        if (!row) throw new Error(`linha inexistente: ${args.where.id}`);
        if (args.data.quantity !== undefined) row.quantity = Number(args.data.quantity);
        if (args.data.materialId !== undefined) row.materialId = args.data.materialId as string | null;
        if (args.data.childProductId !== undefined)
          row.childProductId = args.data.childProductId as string | null;
        if (args.data.isNomusControlled !== undefined)
          row.isNomusControlled = Boolean(args.data.isNomusControlled);
        if (args.data.sourceSystem !== undefined) row.sourceSystem = args.data.sourceSystem as string | null;
        if (args.data.localException !== undefined)
          row.localException = Boolean(args.data.localException);
        if (args.data.nomusComponentCode !== undefined)
          row.nomusComponentCode = args.data.nomusComponentCode as string | null;
        return { id: row.id };
      },
      delete: async (args: { where: { id: string } }) => {
        registerWrite("productBOM.delete");
        state.bomRows.delete(args.where.id);
        return { id: args.where.id };
      },
      findUnique: async (args: { where: { id: string } }) => {
        const row = state.bomRows.get(args.where.id);
        if (!row) return null;
        return {
          id: row.id,
          materialId: row.materialId,
          childProductId: row.childProductId,
          quantity: row.quantity,
        };
      },
    },
    engineeringChangeLog: {
      create: async () => {
        registerWrite("engineeringChangeLog.create");
        state.changeLogs += 1;
        return { id: `log-${nextId++}` };
      },
    },
    engineeringSyncRun: {
      update: async () => {
        registerWrite("engineeringSyncRun.update");
        return { id: "run-1" };
      },
    },
  };

  return { client: client as unknown as EngineeringApplyDbClient, writes };
}

/** Simula prisma.$transaction: estado clonado; commit só sem exceção. */
async function runInFakeTransaction<T>(
  base: FakeDbState,
  fn: (state: FakeDbState) => Promise<T>
): Promise<{ result: T | null; committed: boolean; finalState: FakeDbState; error: Error | null }> {
  const buffer = cloneState(base);
  try {
    const result = await fn(buffer);
    return { result, committed: true, finalState: buffer, error: null };
  } catch (err) {
    return {
      result: null,
      committed: false,
      finalState: base,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function bomAction(overrides: Partial<EngineeringBomActionPlan>): EngineeringBomActionPlan {
  return {
    parentCode: "PROD-A",
    productId: "prod-a",
    productBomLineId: null,
    componentCode: "MP0",
    componentDescription: null,
    actionType: "CREATE_PRODUCT_BOM_LINE",
    resolvedAs: "MATERIAL",
    materialId: "mat-0",
    childProductId: null,
    oldQuantity: null,
    newQuantity: 1,
    oldLossPercentage: null,
    newLossPercentage: 0,
    willApply: true,
    reason: "teste",
    ...overrides,
  } as EngineeringBomActionPlan;
}

function planWith(bomActions: EngineeringBomActionPlan[]): EngineeringSyncPlan {
  return {
    generatedAt: new Date().toISOString(),
    scope: "ONE_PRODUCT",
    parentCodes: ["PROD-A"],
    recursive: false,
    maxDepth: 1,
    stageSummary: { parentsInStage: 1, componentsInStage: bomActions.length, lastStageSyncAt: null },
    productActions: [
      {
        parentCode: "PROD-A",
        parentDescription: "Produto A",
        actionType: "KEEP_PRODUCT_AS_NOMUS_CONTROLLED",
        existsInNomus: true,
        existsInIndusCost: true,
        indusProductId: "prod-a",
        isAlreadyNomusControlled: true,
        reason: "já controlado",
        fieldChanges: [],
      },
    ],
    bomActions,
    blockingReasons: [],
    blockingDetails: [],
    warnings: [],
    pendingCostItems: [],
    pendingRoutingItems: [],
    canApply: true,
    planHash: "hash-teste",
    confirmationRequiredText: "SINCRONIZAR ENGENHARIA PROD-A",
    summary: {
      productsToCreate: 0,
      productsToUpdate: 0,
      bomLinesToCreate: bomActions.filter((b) => b.actionType === "CREATE_PRODUCT_BOM_LINE").length,
      bomLinesToUpdate: 0,
      bomLinesToRemove: bomActions.filter(
        (b) => b.actionType === "REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS"
      ).length,
      bomLinesKept: 0,
      localExceptionsKept: 0,
      blockedItems: 0,
    },
  } as EngineeringSyncPlan;
}

function baseStateComContratoV1(): FakeDbState {
  // IndusCost: MP1 qty 10 [NOMUS], MP2 qty 20 [NOMUS], Furação [LOCAL], Montagem [LOCAL]
  const state: FakeDbState = { bomRows: new Map(), products: new Map(), changeLogs: 0 };
  state.products.set("prod-a", { id: "prod-a", sku: "PROD-A", name: "Produto A" });
  state.bomRows.set("bom-mp1", {
    id: "bom-mp1", productId: "prod-a", materialId: "mat-mp1", childProductId: null,
    quantity: 10, lossPercentage: 0, notes: null,
    sourceSystem: "NOMUS", isNomusControlled: true, localException: false, nomusComponentCode: "MP1",
  });
  state.bomRows.set("bom-mp2", {
    id: "bom-mp2", productId: "prod-a", materialId: "mat-mp2", childProductId: null,
    quantity: 20, lossPercentage: 0, notes: null,
    sourceSystem: "NOMUS", isNomusControlled: true, localException: false, nomusComponentCode: "MP2",
  });
  state.bomRows.set("bom-furacao", {
    id: "bom-furacao", productId: "prod-a", materialId: null, childProductId: "child-furacao",
    quantity: 1, lossPercentage: 0, notes: "Furação Reservatório",
    sourceSystem: "INDUSCOST", isNomusControlled: false, localException: true, nomusComponentCode: null,
  });
  state.bomRows.set("bom-montagem", {
    id: "bom-montagem", productId: "prod-a", materialId: null, childProductId: "child-montagem",
    quantity: 1, lossPercentage: 0, notes: "Montagem",
    sourceSystem: "INDUSCOST", isNomusControlled: false, localException: true, nomusComponentCode: null,
  });
  return state;
}

/** Plano representando a mudança Nomus: MP1 10→15, MP2 removida, MP3 qty 30 nova. */
function planoMudancaNomus(): EngineeringSyncPlan {
  return planWith([
    bomAction({
      actionType: "UPDATE_PRODUCT_BOM_LINE_QUANTITY",
      componentCode: "MP1",
      productBomLineId: "bom-mp1",
      materialId: "mat-mp1",
      oldQuantity: 10,
      newQuantity: 15,
    }),
    bomAction({
      actionType: "REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS",
      componentCode: "MP2",
      productBomLineId: "bom-mp2",
      materialId: "mat-mp2",
      oldQuantity: 20,
      newQuantity: null,
    }),
    bomAction({
      actionType: "CREATE_PRODUCT_BOM_LINE",
      componentCode: "MP3",
      materialId: "mat-mp3",
      newQuantity: 30,
    }),
    bomAction({
      actionType: "KEEP_LOCAL_EXCEPTION",
      componentCode: "(local) Furação",
      productBomLineId: "bom-furacao",
      materialId: null,
      childProductId: "child-furacao",
      willApply: false,
    }),
    bomAction({
      actionType: "KEEP_LOCAL_EXCEPTION",
      componentCode: "(local) Montagem",
      productBomLineId: "bom-montagem",
      materialId: null,
      childProductId: "child-montagem",
      willApply: false,
    }),
  ]);
}

const ctx = { runId: "run-1", approvedBy: "teste", warnings: [] as string[] };

describe("T — atomicidade do apply de engenharia", () => {
  it("T01/T05: plano completo aplica todas as mutações e commita", async () => {
    const base = baseStateComContratoV1();
    const out = await runInFakeTransaction(base, async (state) => {
      const { client } = createFakeTxClient(state);
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(out.committed, true);
    assert.equal(out.result?.bomLinesUpdated, 1);
    assert.equal(out.result?.bomLinesRemoved, 1);
    assert.equal(out.result?.bomLinesCreated, 1);
    // Estado final = contrato: MP1 15, MP3 30, Furação e Montagem intactas, MP2 fora.
    const rows = [...out.finalState.bomRows.values()];
    assert.equal(rows.find((r) => r.nomusComponentCode === "MP1")?.quantity, 15);
    assert.equal(rows.find((r) => r.nomusComponentCode === "MP2"), undefined);
    assert.equal(rows.find((r) => r.nomusComponentCode === "MP3")?.quantity, 30);
    const furacao = rows.find((r) => r.childProductId === "child-furacao");
    const montagem = rows.find((r) => r.childProductId === "child-montagem");
    assert.equal(furacao?.localException, true);
    assert.equal(montagem?.localException, true);
  });

  it("T02: falha na PRIMEIRA mutação → rollback total (estado idêntico ao inicial)", async () => {
    const base = baseStateComContratoV1();
    const out = await runInFakeTransaction(base, async (state) => {
      const { client } = createFakeTxClient(state, { failAtWriteNumber: 1 });
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(out.committed, false);
    assert.match(out.error?.message ?? "", /falha simulada/);
    assert.equal(out.finalState.bomRows.get("bom-mp1")?.quantity, 10);
    assert.equal(out.finalState.bomRows.has("bom-mp2"), true);
    assert.equal(out.finalState.bomRows.size, 4);
  });

  it("T03: falha no MEIO → rollback total (nem update anterior sobrevive)", async () => {
    const base = baseStateComContratoV1();
    const out = await runInFakeTransaction(base, async (state) => {
      // write #1 = update MP1; #2 = changelog; #3 = findUnique não conta; delete MP2 = #3
      const { client } = createFakeTxClient(state, { failAtWriteNumber: 3 });
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(out.committed, false);
    assert.equal(out.finalState.bomRows.get("bom-mp1")?.quantity, 10);
    assert.equal(out.finalState.bomRows.has("bom-mp2"), true);
  });

  it("T04: falha na ÚLTIMA mutação → rollback total", async () => {
    const base = baseStateComContratoV1();
    // Descobre quantas escritas o plano faz no caminho feliz:
    const probe = await runInFakeTransaction(base, async (state) => {
      const { client, writes } = createFakeTxClient(state);
      await applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
      return writes.length;
    });
    const totalWrites = probe.result ?? 0;
    assert.ok(totalWrites >= 6);

    const out = await runInFakeTransaction(baseStateComContratoV1(), async (state) => {
      const { client } = createFakeTxClient(state, { failAtWriteNumber: totalWrites });
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(out.committed, false);
    assert.equal(out.finalState.bomRows.get("bom-mp1")?.quantity, 10);
    assert.equal(out.finalState.bomRows.has("bom-mp2"), true);
    assert.equal([...out.finalState.bomRows.values()].some((r) => r.nomusComponentCode === "MP3"), false);
  });

  it("T06: validação de planHash acontece ANTES de qualquer escrita (ordem no fonte)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./nomusEngineeringReconciliation.ts", import.meta.url),
      "utf8"
    );
    const applyStart = source.indexOf("export async function applyNomusEngineeringSync");
    assert.ok(applyStart > 0);
    const body = source.slice(applyStart);
    const hashCheck = body.indexOf("plan.planHash !== input.planHash.trim()");
    const runCreate = body.indexOf("engineeringSyncRun.create");
    const txStart = body.indexOf("prisma.$transaction");
    assert.ok(hashCheck > 0 && runCreate > 0 && txStart > 0);
    assert.ok(hashCheck < runCreate, "hash deve ser validado antes do registro do run");
    assert.ok(hashCheck < txStart, "hash deve ser validado antes da transação de escrita");
    assert.ok(runCreate < txStart, "mutações devem estar dentro de prisma.$transaction");
  });

  it("T07: linha sumiu na janela do apply (concorrência) → erro alto e rollback, nada parcial", async () => {
    const base = baseStateComContratoV1();
    base.bomRows.delete("bom-mp1"); // outra sessão removeu a linha entre preview e apply
    const out = await runInFakeTransaction(base, async (state) => {
      const { client } = createFakeTxClient(state);
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(out.committed, false);
    assert.match(out.error?.message ?? "", /linha inexistente/);
    // Nenhuma outra mutação do plano sobreviveu.
    assert.equal(out.finalState.bomRows.has("bom-mp2"), true);
    assert.equal([...out.finalState.bomRows.values()].some((r) => r.nomusComponentCode === "MP3"), false);
  });

  it("T08: retry após rollback → resultado determinístico igual ao T01", async () => {
    const base = baseStateComContratoV1();
    const failed = await runInFakeTransaction(base, async (state) => {
      const { client } = createFakeTxClient(state, { failAtWriteNumber: 2 });
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(failed.committed, false);
    const retried = await runInFakeTransaction(failed.finalState, async (state) => {
      const { client } = createFakeTxClient(state);
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(retried.committed, true);
    const rows = [...retried.finalState.bomRows.values()];
    assert.equal(rows.find((r) => r.nomusComponentCode === "MP1")?.quantity, 15);
    assert.equal(rows.find((r) => r.nomusComponentCode === "MP3")?.quantity, 30);
    assert.equal(rows.filter((r) => r.localException).length, 2);
  });
});

describe("FASE 9 — cenário principal de negócio (BOM)", () => {
  it("mudança Nomus aplicada preservando locais; segundo plano sem mudanças = zero mutações", async () => {
    // Nomus muda: MP1 15, MP2 removida, MP3 30 — locais intocados.
    const afterChange = await runInFakeTransaction(baseStateComContratoV1(), async (state) => {
      const { client } = createFakeTxClient(state);
      return applyEngineeringPlanMutations(client, planoMudancaNomus(), { ...ctx, warnings: [] });
    });
    assert.equal(afterChange.committed, true);

    // Segundo sync sem alteração: plano só com KEEP → zero mutações de BOM/Product.
    // KEEP_PRODUCT_BOM_LINE re-estampa ownership (update idempotente), então o
    // plano "sem mudanças" do fluxo real usa willApply=false; aqui validamos
    // que um plano com apenas KEEP_LOCAL_EXCEPTION (não aplicável) não muta nada.
    const idlePlan = planWith([
      bomAction({
        actionType: "KEEP_LOCAL_EXCEPTION",
        componentCode: "(local) Furação",
        productBomLineId: "bom-furacao",
        materialId: null,
        childProductId: "child-furacao",
        willApply: false,
      }),
    ]);
    const second = await runInFakeTransaction(afterChange.finalState, async (state) => {
      const { client, writes } = createFakeTxClient(state);
      const totals = await applyEngineeringPlanMutations(client, idlePlan, { ...ctx, warnings: [] });
      return { totals, writes: writes.length };
    });
    assert.equal(second.committed, true);
    assert.equal(second.result?.totals.bomLinesCreated, 0);
    assert.equal(second.result?.totals.bomLinesUpdated, 0);
    assert.equal(second.result?.totals.bomLinesRemoved, 0);
    assert.equal(second.result?.writes, 0);
    // Estado permanece o do contrato.
    const rows = [...second.finalState.bomRows.values()];
    assert.equal(rows.find((r) => r.nomusComponentCode === "MP1")?.quantity, 15);
    assert.equal(rows.filter((r) => r.localException).length, 2);
  });

  it("linha local SEM exceção não marcada é removível (regra existente) — e adoção limpa localException de linha que casa com o Nomus", async () => {
    const base = baseStateComContratoV1();
    // Linha marcada localException que na verdade casa com componente Nomus:
    base.bomRows.get("bom-mp1")!.localException = true;
    const out = await runInFakeTransaction(base, async (state) => {
      const { client } = createFakeTxClient(state);
      return applyEngineeringPlanMutations(
        client,
        planWith([
          bomAction({
            actionType: "UPDATE_PRODUCT_BOM_LINE_QUANTITY",
            componentCode: "MP1",
            productBomLineId: "bom-mp1",
            materialId: "mat-mp1",
            oldQuantity: 10,
            newQuantity: 15,
          }),
        ]),
        { ...ctx, warnings: [] }
      );
    });
    assert.equal(out.committed, true);
    const mp1 = out.finalState.bomRows.get("bom-mp1");
    assert.equal(mp1?.localException, false);
    assert.equal(mp1?.isNomusControlled, true);
  });
});
