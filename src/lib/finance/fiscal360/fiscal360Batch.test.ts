/**
 * Conciliação por lote: elegibilidade conferida no servidor, falha isolada por item e pesquisa.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  Fiscal360InputError,
  listFiscal360ApTitles,
  listFiscal360Reconciliation,
  listFiscal360ReconciliationKeys,
  parseFiscal360AmountRange,
  parseFiscal360Filters,
} from "./fiscal360QueryService.server.js";
import { createFiscal360DecisionBatch, type Fiscal360DecisionInput } from "./fiscal360WriteService.server.js";

const ACTOR = { userId: "u1", userName: "Ana" };
const REASON = "Conferido com o extrato do período";

type Row = Record<string, unknown>;

function batchDb(data: { items?: Row[]; titles?: Row[]; active?: Row[] }) {
  return {
    fiscalReconciliationItem: { findMany: async () => data.items ?? [] },
    fiscalApTitleFact: { findMany: async () => data.titles ?? [] },
    fiscalReconciliationDecision: { findMany: async () => data.active ?? [] },
  } as unknown as PrismaClient;
}

function recorder(fail?: (d: Fiscal360DecisionInput) => Error | null) {
  const calls: Fiscal360DecisionInput[] = [];
  const create = (async (_db: PrismaClient, input: Fiscal360DecisionInput) => {
    const error = fail?.(input);
    if (error) throw error;
    calls.push(input);
    return {};
  }) as never;
  return { calls, create };
}

describe("decisão em lote", () => {
  it("aceita só o que ainda pode ser aceito e explica o restante", async () => {
    const { calls, create } = recorder();
    const db = batchDb({
      items: [
        { itemKey: "a", status: "DIVERGENT", message: "A" },
        { itemKey: "b", status: "ACCEPTED", message: "B" },
        { itemKey: "c", status: "OK", message: "C" },
        { itemKey: "d", status: "REVIEW", message: "D" },
      ],
      active: [{ itemKey: "d" }],
    });
    const res = await createFiscal360DecisionBatch(db, { decisionType: "ACCEPT_DIVERGENCE", itemKeys: ["a", "a", "b", "c", "d", "sumiu"], reason: REASON }, ACTOR, create);
    assert.deepEqual(calls.map((c) => c.itemKey), ["a"]);
    assert.equal(res.requested, 5, "chave repetida conta uma vez");
    assert.equal(res.applied, 1);
    assert.deepEqual(res.skipped.map((s) => s.target), ["b", "c", "d", "sumiu"]);
    assert.match(res.skipped.find((s) => s.target === "d")!.reason, /decisão ativa/);
  });

  it("todas as decisões levam o mesmo motivo e o mesmo lote", async () => {
    const { calls, create } = recorder();
    const db = batchDb({ items: [{ itemKey: "a", status: "MISSING", message: "A" }, { itemKey: "b", status: "REVIEW", message: "B" }] });
    const res = await createFiscal360DecisionBatch(db, { decisionType: "ACCEPT_DIVERGENCE", itemKeys: ["a", "b"], reason: REASON }, ACTOR, create);
    assert.ok(calls.every((c) => c.reason === REASON && (c.evidence as { batchId: string }).batchId === res.batchId));
  });

  it("tributo do lote vale para todos; sem ele, vale a sugestão, e título sem sugestão é ignorado", async () => {
    const titles = [
      { apExternalId: 1, classificationStatus: "PENDING", suggestedTaxType: "ISS" },
      { apExternalId: 2, classificationStatus: "PENDING", suggestedTaxType: null },
      { apExternalId: 3, classificationStatus: "TAX", suggestedTaxType: "ISS" },
    ];
    const suggested = recorder();
    const res = await createFiscal360DecisionBatch(batchDb({ titles }), { decisionType: "AP_CONFIRM_TAX", apExternalIds: [1, 2, 3], reason: REASON }, ACTOR, suggested.create);
    assert.deepEqual(suggested.calls.map((c) => [c.apExternalId, c.payload?.taxType]), [[1, "ISS"]]);
    assert.match(res.skipped.find((s) => s.target === "2")!.reason, /sem sugestão/);
    assert.match(res.skipped.find((s) => s.target === "3")!.reason, /não está mais pendente/);

    const fixed = recorder();
    await createFiscal360DecisionBatch(batchDb({ titles }), { decisionType: "AP_CONFIRM_TAX", apExternalIds: [1, 2], payload: { taxType: "cofins" }, reason: REASON }, ACTOR, fixed.create);
    assert.deepEqual(fixed.calls.map((c) => c.payload?.taxType), ["COFINS", "COFINS"]);
  });

  it("título com decisão ativa, de qualquer lado, não é substituído pelo lote", async () => {
    const { calls, create } = recorder();
    const db = batchDb({ titles: [{ apExternalId: 1, classificationStatus: "PENDING", suggestedTaxType: "ISS" }], active: [{ apExternalId: 1 }] });
    const res = await createFiscal360DecisionBatch(db, { decisionType: "AP_REJECT_TAX", apExternalIds: [1], reason: REASON }, ACTOR, create);
    assert.equal(calls.length, 0);
    assert.equal(res.skipped.length, 1);
  });

  it("falha em um item não desfaz os demais e não expõe erro interno", async () => {
    const { calls, create } = recorder((d) => (d.itemKey === "b" ? new Error("segredo do banco") : d.itemKey === "c" ? new Fiscal360InputError("Item de conciliação não encontrado.") : null));
    const db = batchDb({ items: ["a", "b", "c", "d"].map((itemKey) => ({ itemKey, status: "REVIEW", message: itemKey })) });
    const original = console.error;
    console.error = () => undefined;
    const res = await createFiscal360DecisionBatch(db, { decisionType: "ACCEPT_DIVERGENCE", itemKeys: ["a", "b", "c", "d"], reason: REASON }, ACTOR, create).finally(() => {
      console.error = original;
    });
    assert.deepEqual(calls.map((c) => c.itemKey), ["a", "d"]);
    assert.equal(res.applied, 2);
    assert.deepEqual(res.failed.map((f) => f.target), ["b", "c"]);
    assert.ok(!JSON.stringify(res).includes("segredo"));
    assert.match(res.failed[1]!.reason, /não encontrado/);
  });

  it("recusa o lote inteiro: motivo curto, vazio, acima do limite, tipo que exige dados próprios, tributo inválido", async () => {
    const { calls, create } = recorder();
    const db = batchDb({});
    const run = (input: Parameters<typeof createFiscal360DecisionBatch>[1]) => createFiscal360DecisionBatch(db, input, ACTOR, create);
    await assert.rejects(run({ decisionType: "ACCEPT_DIVERGENCE", itemKeys: ["a"], reason: "curto" }), /motivo/i);
    await assert.rejects(run({ decisionType: "ACCEPT_DIVERGENCE", itemKeys: [], reason: REASON }), /Marque de 1 a 500/);
    await assert.rejects(run({ decisionType: "ACCEPT_DIVERGENCE", itemKeys: Array.from({ length: 501 }, (_, i) => `k${i}`), reason: REASON }), /Marque de 1 a 500/);
    await assert.rejects(run({ decisionType: "LINK_GUIDE_AP" as never, itemKeys: ["a"], reason: REASON }), /não pode ser aplicada em lote/);
    await assert.rejects(run({ decisionType: "AP_CONFIRM_TAX", apExternalIds: [1], payload: { taxType: "XX" }, reason: REASON }), /Tributo inválido/);
    assert.equal(calls.length, 0);
  });
});

describe("pesquisa da conciliação", () => {
  const filters = (extra: Record<string, unknown> = {}) => parseFiscal360Filters({ company: "group", fromMonth: "2026-01", toMonth: "2026-10", ...extra });

  function capturing() {
    const wheres: Row[] = [];
    const model = {
      findMany: async (args: { where: Row }) => {
        wheres.push(args.where);
        return [];
      },
      count: async () => 0,
      groupBy: async () => [],
    };
    return { db: { fiscalReconciliationItem: model, fiscalApTitleFact: model } as unknown as PrismaClient, wheres };
  }

  it("faixa de valor: número válido, sem negativo, inicial não maior que final", () => {
    assert.deepEqual(parseFiscal360AmountRange({ minAmount: "10.5", maxAmount: "" }), { min: 10.5, max: null });
    assert.throws(() => parseFiscal360AmountRange({ minAmount: "abc" }), /Valor inválido/);
    assert.throws(() => parseFiscal360AmountRange({ minAmount: "-1" }), /Valor inválido/);
    assert.throws(() => parseFiscal360AmountRange({ minAmount: "5", maxAmount: "1" }), /maior que o final/);
  });

  it("a diferença é pesquisada em valor absoluto", async () => {
    const { db, wheres } = capturing();
    await listFiscal360Reconciliation(db, filters(), { page: 1, pageSize: 50 }, null, { min: 10, max: 20 });
    assert.deepEqual((wheres[0]!.AND as Row[])[0], { OR: [{ difference: { gte: 10, lte: 20 } }, { difference: { lte: -10, gte: -20 } }] });
  });

  it("o texto pesquisa mensagem e vínculos; sem pesquisa, o filtro não muda", async () => {
    const { db, wheres } = capturing();
    await listFiscal360Reconciliation(db, filters({ q: "darf" }), { page: 1, pageSize: 50 }, null);
    assert.deepEqual((wheres[0]!.AND as Array<{ OR: Row[] }>)[0]!.OR.map((o) => Object.keys(o)[0]), ["message", "subjectId", "relatedId"]);
    await listFiscal360Reconciliation(db, filters(), { page: 1, pageSize: 50 }, null);
    assert.deepEqual(wheres[1]!.AND, []);
  });

  it("marcar todos do filtro nunca traz item já conciliado ou aceito, mesmo filtrando por essa situação", async () => {
    const { db, wheres } = capturing();
    await listFiscal360ReconciliationKeys(db, filters({ status: "ACCEPTED" }), null, null);
    const and = wheres[0]!.AND as Row[];
    assert.deepEqual(and[1], { status: { notIn: ["OK", "ACCEPTED"] } });
    assert.equal((and[0] as Row).status, "ACCEPTED");
  });

  it("títulos AP: número pesquisa o id do Nomus, e o filtro de tributo convive com o texto", async () => {
    const { db, wheres } = capturing();
    await listFiscal360ApTitles(db, filters({ q: "4512", taxType: "ISS" }), { page: 1, pageSize: 20 }, "PENDING", { min: 100, max: null });
    const and = wheres[0]!.AND as Array<Row & { OR?: Row[] }>;
    assert.deepEqual(and[0], { OR: [{ taxType: "ISS" }, { suggestedTaxType: "ISS" }] });
    assert.ok(and[1]!.OR!.some((o) => o.apExternalId === 4512));
    assert.deepEqual(and[2], { amountOriginal: { gte: 100 } });
  });
});
