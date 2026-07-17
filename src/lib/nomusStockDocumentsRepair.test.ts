/**
 * DS-03.6 — testes do reparo de cabeçalho normalizado (preview/apply/idempotência).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { stableNomusStockDocumentPayloadHash } from "@/src/lib/nomusStockDocumentsMapper.js";
import {
  buildStockDocumentRepairPatch,
  mapStockDocumentRepairFieldsFromRawJson,
  parseStockDocumentRepairCli,
  sameDecimal,
  stockDocumentNeedsRepair,
  type StockDocumentRepairableFields,
} from "@/src/lib/nomusStockDocumentsRepair.js";
import { runStockDocumentRepairFromRawJson } from "@/src/lib/nomusStockDocumentsRepair.server.js";

const richRaw = {
  id: 8451,
  numero: "DS-8451",
  idNfe: 7208,
  tipoDocumentoEstoque: "DocumentoSaida",
  data: "10/07/2026 09:00:00",
  dataMovimentacao: "11/07/2026 14:30:00",
  status: "Cancelado",
  dataCancelamento: "12/07/2026 10:00:00",
  motivoCancelamento: "Solicitação do cliente",
  valorTotal: "1.234,56",
  idPessoa: 501,
  nomeCliente: "Cliente Exemplo LTDA",
  idEmpresa: 2,
  razaoSocialEmpresa: "Empresa Emissora SA",
  condicaoPagamento: "28 DDL",
  itensDocumentoEstoque: [
    { id: 1, idProduto: 100, qtde: "1", valorUnitario: "100,00" },
  ],
};

type Stored = {
  id: string;
  externalId: number;
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  totalValue: Prisma.Decimal | null;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  movementDate: Date | null;
  paymentTermsRaw: string | null;
  payloadHash: string;
  rawJson: unknown;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  presentInLastPayload: boolean;
  syncedAt: Date;
  _itemCount: number;
  _itemsSnapshot: unknown[];
};

function emptyRepairable(): StockDocumentRepairableFields {
  return {
    documentNumber: null,
    statusRaw: null,
    isCancelled: false,
    cancelledAt: null,
    cancellationReason: null,
    totalValue: null,
    personExternalId: null,
    personName: null,
    companyExternalId: null,
    companyName: null,
    movementDate: null,
    paymentTermsRaw: null,
    payloadHash: "",
  };
}

function extractGt(where: unknown): number | null {
  if (!where || typeof where !== "object") return null;
  const w = where as Record<string, unknown>;
  if (typeof w.externalId === "number") return null;
  if (w.externalId && typeof w.externalId === "object" && "gt" in (w.externalId as object)) {
    const gt = (w.externalId as { gt?: number }).gt;
    return typeof gt === "number" ? gt : null;
  }
  if (Array.isArray(w.AND)) {
    for (const part of w.AND) {
      const nested = extractGt(part);
      if (nested != null) return nested;
    }
  }
  return null;
}

function createMemoryDb(initial: Stored[]) {
  const store = new Map(initial.map((row) => [row.id, structuredClone(row)]));
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let findManyCalls = 0;
  let itemMutations = 0;

  return {
    updates,
    store,
    get findManyCalls() {
      return findManyCalls;
    },
    get itemMutations() {
      return itemMutations;
    },
    nomusStockDocument: {
      findMany: async (args: {
        where?: unknown;
        orderBy?: { externalId: "asc" };
        take?: number;
        select?: unknown;
      }) => {
        findManyCalls += 1;
        const gt = extractGt(args.where);
        let rows = [...store.values()].sort((a, b) => a.externalId - b.externalId);
        if (gt != null) rows = rows.filter((r) => r.externalId > gt);
        const where = args.where as { externalId?: number } | undefined;
        if (typeof where?.externalId === "number") {
          rows = rows.filter((r) => r.externalId === where.externalId);
        }
        const take = args.take ?? rows.length;
        return rows.slice(0, take).map((row) => ({
          ...row,
          _count: { items: row._itemCount },
        }));
      },
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
        select?: unknown;
      }) => {
        const row = store.get(args.where.id);
        if (!row) throw new Error("not found");
        // Garantia de teste: update nunca toca itens / rawJson / IDs estruturais.
        assert.ok(!("rawJson" in args.data));
        assert.ok(!("items" in args.data));
        assert.ok(!("externalId" in args.data));
        assert.ok(!("id" in args.data));
        assert.ok(!("firstSeenAt" in args.data));
        assert.ok(!("lastSeenAt" in args.data));
        assert.ok(!("presentInLastPayload" in args.data));
        assert.ok(!("syncedAt" in args.data));
        updates.push({ id: args.where.id, data: { ...args.data } });
        Object.assign(row, args.data);
        return { id: row.id };
      },
    },
    nomusStockDocumentItem: {
      deleteMany: async () => {
        itemMutations += 1;
        return { count: 0 };
      },
      createMany: async () => {
        itemMutations += 1;
        return { count: 0 };
      },
    },
  };
}

describe("nomusStockDocumentsRepair pure", () => {
  it("parseia CLI preview/apply e flags", () => {
    const preview = parseStockDocumentRepairCli(["preview", "--limit=10", "--only-null"]);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.limit, 10);
    assert.equal(preview.onlyNull, true);

    const apply = parseStockDocumentRepairCli([
      "apply",
      "--batch-size=50",
      "--after-externalId=100",
      "--checkpoint-file=/tmp/x.json",
    ]);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.batchSize, 50);
    assert.equal(apply.afterExternalId, 100);
    assert.equal(apply.checkpointFile, "/tmp/x.json");
  });

  it("mapeia campos a partir do raw rico e Decimal", () => {
    const mapped = mapStockDocumentRepairFieldsFromRawJson(richRaw);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.fields.documentNumber, "DS-8451");
    assert.equal(mapped.fields.statusRaw, "Cancelado");
    assert.equal(mapped.fields.isCancelled, true);
    assert.equal(mapped.fields.personExternalId, 501);
    assert.equal(mapped.fields.companyName, "Empresa Emissora SA");
    assert.ok(mapped.fields.totalValue);
    assert.ok(sameDecimal(mapped.fields.totalValue, new Prisma.Decimal("1234.56")));
    assert.equal(mapped.totalValueSource, "raw");
    assert.equal(
      mapped.fields.payloadHash,
      stableNomusStockDocumentPayloadHash(richRaw)
    );
  });

  it("registra datas inválidas sem inventar valor", () => {
    const mapped = mapStockDocumentRepairFieldsFromRawJson({
      id: 99,
      status: "Cancelado",
      dataCancelamento: "não-é-data",
      dataMovimentacao: "32/13/2099 99:99:99",
      // sem valorTotal / pessoa / empresa → ausentes (não inventar)
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.fields.cancelledAt, null);
    assert.equal(mapped.fields.movementDate, null);
    assert.equal(mapped.fields.totalValue, null);
    assert.equal(mapped.fields.personName, null);
    assert.equal(mapped.fields.companyName, null);
    assert.ok(mapped.fieldErrors.some((e) => e.field === "cancelledAt"));
    assert.ok(mapped.fieldErrors.some((e) => e.field === "movementDate"));
    assert.ok(mapped.absentKeys.includes("totalValue"));
    assert.ok(mapped.absentKeys.includes("personName"));
  });

  it("payload parcial não limpa campos já preenchidos", () => {
    const current: StockDocumentRepairableFields = {
      ...emptyRepairable(),
      personName: "Cliente Já Persistido",
      personExternalId: 10,
      totalValue: new Prisma.Decimal("50.00"),
      payloadHash: "abc",
    };
    const mapped = mapStockDocumentRepairFieldsFromRawJson({
      id: 1,
      status: "Aberto",
      // sem pessoa / valor / empresa
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const patch = buildStockDocumentRepairPatch(current, mapped.fields);
    assert.equal(patch.personName, undefined);
    assert.equal(patch.personExternalId, undefined);
    assert.equal(patch.totalValue, undefined);
    assert.equal(patch.statusRaw, "Aberto");
  });
});

describe("nomusStockDocumentsRepair runner", () => {
  function seedEmpty(raw: unknown = richRaw): Stored {
    const now = new Date("2026-01-01T00:00:00.000Z");
    return {
      id: "doc-1",
      externalId: 8451,
      ...emptyRepairable(),
      rawJson: raw,
      idNfe: 7208,
      tipoDocumentoEstoque: "DocumentoSaida",
      dataDocumento: new Date("2026-07-10T12:00:00.000Z"),
      firstSeenAt: now,
      lastSeenAt: now,
      presentInLastPayload: true,
      syncedAt: now,
      _itemCount: 1,
      _itemsSnapshot: [{ id: "item-1", externalItemId: 1 }],
    };
  }

  it("preview não escreve", async () => {
    const db = createMemoryDb([seedEmpty()]);
    const result = await runStockDocumentRepairFromRawJson(db as never, {
      mode: "preview",
      limit: null,
      batchSize: 50,
      afterExternalId: null,
      externalId: null,
      onlyNull: false,
      checkpointFile: null,
    });
    assert.equal(result.mode, "preview");
    assert.ok(result.counters.wouldUpdate >= 1);
    assert.equal(result.counters.updated, 0);
    assert.equal(db.updates.length, 0);
    assert.equal(db.itemMutations, 0);
    const row = db.store.get("doc-1")!;
    assert.equal(row.documentNumber, null);
    assert.equal(row._itemCount, 1);
  });

  it("apply preenche campos e preserva itens/rawJson/IDs", async () => {
    const db = createMemoryDb([seedEmpty()]);
    const beforeItems = structuredClone(db.store.get("doc-1")!._itemsSnapshot);
    const beforeRaw = structuredClone(db.store.get("doc-1")!.rawJson);
    const result = await runStockDocumentRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      batchSize: 50,
      afterExternalId: null,
      externalId: null,
      onlyNull: false,
      checkpointFile: null,
    });
    assert.equal(result.counters.updated, 1);
    assert.equal(db.updates.length, 1);
    assert.equal(db.itemMutations, 0);
    const row = db.store.get("doc-1")!;
    assert.equal(row.id, "doc-1");
    assert.equal(row.externalId, 8451);
    assert.equal(row.documentNumber, "DS-8451");
    assert.equal(row.isCancelled, true);
    assert.ok(sameDecimal(row.totalValue, new Prisma.Decimal("1234.56")));
    assert.equal(row.personName, "Cliente Exemplo LTDA");
    assert.deepEqual(row.rawJson, beforeRaw);
    assert.deepEqual(row._itemsSnapshot, beforeItems);
    assert.equal(row._itemCount, 1);
    assert.equal(result.samples[0]?.itemCountPreserved, 1);
    assert.equal(result.samples[0]?.rawJsonPreserved, true);
  });

  it("segunda execução é idempotente (unchanged)", async () => {
    const db = createMemoryDb([seedEmpty()]);
    const cli = {
      mode: "apply" as const,
      limit: null,
      batchSize: 50,
      afterExternalId: null,
      externalId: null,
      onlyNull: false,
      checkpointFile: null,
    };
    const first = await runStockDocumentRepairFromRawJson(db as never, cli);
    assert.equal(first.counters.updated, 1);
    const second = await runStockDocumentRepairFromRawJson(db as never, cli);
    assert.equal(second.counters.updated, 0);
    assert.equal(second.counters.unchanged, 1);
    assert.equal(second.counters.wouldUpdate, 0);
    assert.equal(db.updates.length, 1);
  });

  it("payload parcial preenche só o disponível e registra ausentes", async () => {
    const partial = {
      id: 100,
      status: "Aberto",
      // sem cliente/empresa/valor/datas
    };
    const db = createMemoryDb([
      {
        ...seedEmpty(partial),
        id: "doc-partial",
        externalId: 100,
        _itemCount: 2,
        _itemsSnapshot: [{ id: "a" }, { id: "b" }],
      },
    ]);
    const result = await runStockDocumentRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      batchSize: 50,
      afterExternalId: null,
      externalId: 100,
      onlyNull: false,
      checkpointFile: null,
    });
    assert.equal(result.counters.updated, 1);
    assert.ok(result.counters.absentFields > 0);
    const row = db.store.get("doc-partial")!;
    assert.equal(row.statusRaw, "Aberto");
    assert.equal(row.personName, null);
    assert.equal(row.totalValue, null);
    assert.equal(row._itemCount, 2);
    assert.ok(!("personName" in db.updates[0]!.data));
    assert.ok(!("totalValue" in db.updates[0]!.data));
  });

  it("datas inválidas incrementam contador e não preenchem data", async () => {
    const bad = {
      id: 200,
      status: "Cancelado",
      dataCancelamento: "xx/yy/zzzz",
      dataMovimentacao: "not-a-date",
    };
    const db = createMemoryDb([
      { ...seedEmpty(bad), id: "doc-bad", externalId: 200, _itemCount: 0, _itemsSnapshot: [] },
    ]);
    const result = await runStockDocumentRepairFromRawJson(db as never, {
      mode: "apply",
      limit: null,
      batchSize: 50,
      afterExternalId: null,
      externalId: 200,
      onlyNull: false,
      checkpointFile: null,
    });
    assert.ok(result.counters.invalidDates >= 2);
    const row = db.store.get("doc-bad")!;
    assert.equal(row.isCancelled, true);
    assert.equal(row.cancelledAt, null);
    assert.equal(row.movementDate, null);
  });

  it("stockDocumentNeedsRepair e Decimal", () => {
    const current = emptyRepairable();
    const next: StockDocumentRepairableFields = {
      ...emptyRepairable(),
      totalValue: new Prisma.Decimal("10.00"),
      payloadHash: "hash",
    };
    assert.equal(stockDocumentNeedsRepair(current, next), true);
    const patched = { ...current, ...buildStockDocumentRepairPatch(current, next) };
    assert.ok(sameDecimal(patched.totalValue, new Prisma.Decimal("10.00")));
    assert.equal(stockDocumentNeedsRepair(patched, next), false);
  });
});
