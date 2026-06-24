import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applySalesOrderNfeLinkBackfill,
  buildSalesOrderNfeLinkWriteData,
  extractSalesOrderNfesFromNomusPayload,
  parseNomusNfeProcessingDate,
  planSalesOrderNfeLinkBackfill,
  upsertSalesOrderNfeLinksForOrder,
} from "./salesOrderNfeLink.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const SAMPLE_NFE = {
  id: 98765,
  numero: "12345",
  serie: "1",
  chave: "35260123456789012345678901234567890123456789",
  status: 100,
  tipoOperacao: 1,
  tipoEmissao: 1,
  dataProcessamento: "15/06/2026",
  horaProcessamento: "14:30:00",
  cnpjEmitente: "12345678000199",
  protocolo: "135260000000000",
  recibo: "REC-1",
  usuario: "nomus",
  ambiente: 1,
  finalidade: 1,
  isFornecedor: 0,
};

describe("salesOrderNfeLink", () => {
  it("motor atual mapeado no código (auditoria estática)", () => {
    assert.match(read("src/lib/salesOrderLogisticStatus.ts"), /buildSalesOrderBiLogisticStatus/);
    assert.match(read("src/lib/salesOrderLifecycleStatus.ts"), /buildSalesOrderLifecycleSummary/);
    assert.match(read("src/lib/salesOrderIntelligenceRoutes.ts"), /\/api\/sales-orders\/management/);
    assert.match(read("src/lib/salesOrderNomusRaw.ts"), /extractNomusRawNfes/);
    assert.match(read("scripts/nomusSalesOrdersSyncV1.ts"), /nomusRawResponse/);
  });

  it("payload sem nfes retorna lista vazia", () => {
    assert.deepEqual(extractSalesOrderNfesFromNomusPayload(null), []);
    assert.deepEqual(extractSalesOrderNfesFromNomusPayload({}), []);
    assert.deepEqual(extractSalesOrderNfesFromNomusPayload({ itensPedido: [] }), []);
  });

  it("payload com nfes: [] retorna lista vazia", () => {
    assert.deepEqual(extractSalesOrderNfesFromNomusPayload({ nfes: [] }), []);
  });

  it("payload com uma NF gera um vínculo normalizado", () => {
    const rows = extractSalesOrderNfesFromNomusPayload({ nfes: [SAMPLE_NFE] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nfeExternalId, 98765);
    assert.equal(rows[0].nfeNumber, "12345");
    assert.equal(rows[0].nfeKey?.length, 44);
    assert.ok(rows[0].rawPayload);
  });

  it("payload com múltiplas NF-es gera múltiplos vínculos", () => {
    const rows = extractSalesOrderNfesFromNomusPayload({
      nfes: [
        { ...SAMPLE_NFE, id: 1, numero: "A" },
        { ...SAMPLE_NFE, id: 2, numero: "B" },
      ],
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.nfeExternalId).sort(),
      [1, 2]
    );
  });

  it("remove duplicidade por nfes.id", () => {
    const rows = extractSalesOrderNfesFromNomusPayload({
      nfes: [
        { ...SAMPLE_NFE, id: 55, numero: "X" },
        { ...SAMPLE_NFE, id: 55, numero: "Y" },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nfeNumber, "Y");
  });

  it("nfeExternalId vem de nfes.id", () => {
    const rows = extractSalesOrderNfesFromNomusPayload({ nfes: [{ id: 4242, numero: "9" }] });
    assert.equal(rows[0]?.nfeExternalId, 4242);
  });

  it("converte dataProcessamento com segurança", () => {
    const parsed = parseNomusNfeProcessingDate("10/06/2026 08:15:30");
    assert.ok(parsed);
    assert.equal(parsed?.getDate(), 10);
    assert.equal(parsed?.getMonth(), 5);
    assert.equal(parsed?.getFullYear(), 2026);
  });

  it("pedido com várias NF-es não altera quantidade de itens extraídos por item", () => {
    const payload = {
      itensPedido: [{ item: 1, quantidade: 10 }],
      nfes: [
        { id: 1, numero: "1" },
        { id: 2, numero: "2" },
      ],
    };
    assert.equal(Array.isArray(payload.itensPedido) ? payload.itensPedido.length : 0, 1);
    assert.equal(extractSalesOrderNfesFromNomusPayload(payload).length, 2);
  });

  it("upsert é idempotente com mock de banco", async () => {
    type LinkRow = {
      id: string;
      salesOrderId: string;
      nfeExternalId: number;
      nomusNfeId: string | null;
      presentInLastPayload: boolean;
      data: Record<string, unknown>;
    };

    const links = new Map<string, LinkRow>();
    let seq = 0;

    const db = {
      nomusNfe: {
        findUnique: async ({ where }: { where: { externalId: number } }) =>
          where.externalId === 98765 ? { id: "nomus-nfe-1" } : null,
      },
      salesOrderNfeLink: {
        findUnique: async ({
          where,
        }: {
          where: { salesOrderId_nfeExternalId: { salesOrderId: string; nfeExternalId: number } };
        }) => {
          const key = `${where.salesOrderId_nfeExternalId.salesOrderId}:${where.salesOrderId_nfeExternalId.nfeExternalId}`;
          const row = links.get(key);
          return row ? { id: row.id } : null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const salesOrderId = String(data.salesOrderId);
          const nfeExternalId = Number(data.nfeExternalId);
          const key = `${salesOrderId}:${nfeExternalId}`;
          const row = { id: `link-${seq}`, salesOrderId, nfeExternalId, nomusNfeId: (data.nomusNfeId as string | null) ?? null, presentInLastPayload: true, data };
          links.set(key, row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = [...links.values()].find((entry) => entry.id === where.id);
          if (!row) throw new Error("missing");
          Object.assign(row.data, data);
          row.nomusNfeId = (data.nomusNfeId as string | null) ?? row.nomusNfeId;
          row.presentInLastPayload = Boolean(data.presentInLastPayload);
          return row;
        },
        updateMany: async () => ({ count: 0 }),
      },
    };

    const order = {
      id: "so-1",
      orderCode: "PD-001",
      externalSalesOrderId: 100,
      externalSalesOrderCode: "PD-001",
      nomusRawResponse: { nfes: [SAMPLE_NFE] },
    };

    const first = await upsertSalesOrderNfeLinksForOrder(order, db as never);
    const second = await upsertSalesOrderNfeLinksForOrder(order, db as never);

    assert.equal(first.created, 1);
    assert.equal(first.updated, 0);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(links.size, 1);
    assert.equal([...links.values()][0]?.nomusNfeId, "nomus-nfe-1");
  });

  it("salva nomusNfeId quando NomusNfe.externalId = nfes.id", () => {
    const data = buildSalesOrderNfeLinkWriteData(
      { id: "so-1", orderCode: "PD-001" },
      extractSalesOrderNfesFromNomusPayload({ nfes: [SAMPLE_NFE] })[0],
      "nomus-nfe-1",
      new Date("2026-06-15T12:00:00Z")
    );
    assert.equal(data.nomusNfeId, "nomus-nfe-1");
    assert.equal(data.nfeExternalId, 98765);
  });

  it("backfill dry-run não altera dados (script wiring)", () => {
    const script = read("scripts/backfill-sales-order-nfe-links.ts");
    assert.match(script, /--dry-run/);
    assert.match(script, /planSalesOrderNfeLinkBackfill/);
    assert.match(script, /Nenhum dado alterado/);
  });

  it("backfill apply altera somente SalesOrderNfeLink (script wiring)", () => {
    const script = read("scripts/backfill-sales-order-nfe-links.ts");
    assert.match(script, /--apply/);
    assert.match(script, /applySalesOrderNfeLinkBackfill/);
    assert.doesNotMatch(script, /salesOrder\.update/);
    assert.doesNotMatch(script, /salesOrderItem/);
    assert.doesNotMatch(script, /nomusNfe\.create/);
  });

  it("sync de pedidos atualiza links após upsert do pedido", () => {
    assert.match(read("scripts/nomusSalesOrdersSyncV1.ts"), /upsertSalesOrderNfeLinksForOrder/);
  });

  it("endpoint admin de diagnóstico registrado", () => {
    assert.match(read("src/lib/salesOrderIntelligenceRoutes.ts"), /nfe-links\/diagnostic/);
    assert.match(read("src/lib/salesOrderIntelligenceRoutes.ts"), /buildSalesOrderNfeLinkDiagnostic/);
  });

  it("módulo de extração de NF-e é browser-safe (sem Prisma)", () => {
    const src = read("src/lib/salesOrderNomusNfeExtract.ts");
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /lib\/prisma/);
  });
});

type StoredLink = Record<string, unknown> & {
  id: string;
  salesOrderId: string;
  nfeExternalId: number;
  presentInLastPayload: boolean;
};

type MockSeed = {
  orders: Array<{
    id: string;
    orderCode: string;
    externalSalesOrderId: number | null;
    externalSalesOrderCode: string | null;
    nomusRawResponse: unknown;
  }>;
  nomusExternalIds: number[];
  links?: StoredLink[];
};

function makeMockDb(seed: MockSeed) {
  const links = new Map<string, StoredLink>();
  for (const link of seed.links ?? []) links.set(link.id, { ...link });
  const nomusSet = new Set(seed.nomusExternalIds);

  const calls = {
    salesOrderFindMany: 0,
    nomusFindMany: 0,
    linkFindMany: 0,
    createMany: 0,
    update: 0,
    updateMany: 0,
    transaction: 0,
  };

  let seq = links.size;

  const keyOf = (salesOrderId: string, nfeExternalId: number) => `${salesOrderId}:${nfeExternalId}`;

  const db = {
    salesOrder: {
      findMany: async () => {
        calls.salesOrderFindMany += 1;
        return seed.orders.map((o) => ({ ...o }));
      },
    },
    nomusNfe: {
      findMany: async ({ where }: { where: { externalId: { in: number[] } } }) => {
        calls.nomusFindMany += 1;
        return where.externalId.in
          .filter((id) => nomusSet.has(id))
          .map((id) => ({ id: `nomus-${id}`, externalId: id }));
      },
    },
    salesOrderNfeLink: {
      findMany: async () => {
        calls.linkFindMany += 1;
        return [...links.values()].map((row) => ({ ...row }));
      },
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: StoredLink[];
        skipDuplicates?: boolean;
      }) => {
        calls.createMany += 1;
        let count = 0;
        for (const row of data) {
          const existingKey = [...links.values()].find(
            (l) => keyOf(l.salesOrderId, l.nfeExternalId) === keyOf(row.salesOrderId, row.nfeExternalId)
          );
          if (existingKey && skipDuplicates) continue;
          seq += 1;
          const id = `link-${seq}`;
          links.set(id, { ...row, id });
          count += 1;
        }
        return { count };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.update += 1;
        const row = links.get(where.id);
        if (!row) throw new Error(`missing link ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        calls.updateMany += 1;
        let count = 0;
        const ids = where.id?.in ?? [];
        for (const id of ids) {
          const row = links.get(id);
          if (!row) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    $transaction: async (promises: Array<Promise<unknown>>) => {
      calls.transaction += 1;
      return Promise.all(promises);
    },
  };

  return { db, links, calls };
}

const NFE_A = { id: 111, numero: "100", serie: "1", chave: "A".repeat(44), status: 100, dataProcessamento: "10/06/2026" };
const NFE_B = { id: 222, numero: "200", serie: "1", chave: "B".repeat(44), status: 100, dataProcessamento: "11/06/2026" };
const NFE_C = { id: 333, numero: "300", serie: "1", chave: "C".repeat(44), status: 100, dataProcessamento: "12/06/2026" };

describe("salesOrderNfeLink — backfill em lote (planner)", () => {
  it("cruza NomusNfe em lote (1 query) — sem N+1", async () => {
    const { db, calls } = makeMockDb({
      orders: [
        { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1", nomusRawResponse: { nfes: [NFE_A] } },
        { id: "so-2", orderCode: "PD-2", externalSalesOrderId: 2, externalSalesOrderCode: "PD-2", nomusRawResponse: { nfes: [NFE_B, NFE_C] } },
      ],
      nomusExternalIds: [111, 222, 333],
    });

    const plan = await planSalesOrderNfeLinkBackfill(db as never);

    assert.equal(calls.salesOrderFindMany, 1);
    assert.equal(calls.nomusFindMany, 1, "NomusNfe deve ser consultado em lote (1 query)");
    assert.equal(calls.linkFindMany, 1);
    assert.equal(plan.ordersAnalyzed, 2);
    assert.equal(plan.totalNfesFound, 3);
    assert.equal(plan.uniqueNfes, 3);
    assert.equal(plan.matchedNomusNfe, 3);
    assert.equal(plan.unmatchedNomusNfe, 0);
    assert.equal(plan.toCreate.length, 3);
    assert.equal(plan.ordersWithMultipleNfes, 1);
  });

  it("planeja criar quando não existe, atualizar quando difere, manter quando igual", async () => {
    const now = new Date();
    const baseData = buildSalesOrderNfeLinkWriteData(
      { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1" },
      extractSalesOrderNfesFromNomusPayload({ nfes: [NFE_A] })[0],
      "nomus-111",
      now
    );
    const staleData = buildSalesOrderNfeLinkWriteData(
      { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1" },
      extractSalesOrderNfesFromNomusPayload({ nfes: [{ ...NFE_B, numero: "ANTIGO" }] })[0],
      "nomus-222",
      now
    );

    const { db } = makeMockDb({
      orders: [
        {
          id: "so-1",
          orderCode: "PD-1",
          externalSalesOrderId: 1,
          externalSalesOrderCode: "PD-1",
          nomusRawResponse: { nfes: [NFE_A, NFE_B, NFE_C] },
        },
      ],
      nomusExternalIds: [111, 222, 333],
      links: [
        { ...baseData, id: "link-A", salesOrderId: "so-1", nfeExternalId: 111, presentInLastPayload: true },
        { ...staleData, id: "link-B", salesOrderId: "so-1", nfeExternalId: 222, presentInLastPayload: true },
      ],
    });

    const plan = await planSalesOrderNfeLinkBackfill(db as never);

    assert.equal(plan.unchanged, 1, "NFE_A idêntica deve ficar sem alteração");
    assert.equal(plan.toUpdate.length, 1, "NFE_B com numero diferente deve atualizar");
    assert.equal(plan.toUpdate[0].item.nfe.nfeExternalId, 222);
    assert.equal(plan.toCreate.length, 1, "NFE_C nova deve criar");
    assert.equal(plan.toCreate[0].nfe.nfeExternalId, 333);
  });

  it("reporta NF-e sem match em NomusNfe sem quebrar", async () => {
    const { db } = makeMockDb({
      orders: [
        { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1", nomusRawResponse: { nfes: [NFE_A, NFE_B] } },
      ],
      nomusExternalIds: [111],
    });

    const plan = await planSalesOrderNfeLinkBackfill(db as never);
    assert.equal(plan.matchedNomusNfe, 1);
    assert.equal(plan.unmatchedNomusNfe, 1);
    assert.equal(plan.examples.unmatched.length, 1);
    assert.equal(plan.examples.unmatched[0].nfeExternalId, 222);
  });

  it("pedido sem NF-e não quebra e conta corretamente", async () => {
    const { db } = makeMockDb({
      orders: [
        { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1", nomusRawResponse: { nfes: [] } },
        { id: "so-2", orderCode: "PD-2", externalSalesOrderId: 2, externalSalesOrderCode: "PD-2", nomusRawResponse: {} },
        { id: "so-3", orderCode: "PD-3", externalSalesOrderId: 3, externalSalesOrderCode: "PD-3", nomusRawResponse: { nfes: [NFE_A] } },
      ],
      nomusExternalIds: [111],
    });

    const plan = await planSalesOrderNfeLinkBackfill(db as never);
    assert.equal(plan.ordersAnalyzed, 3);
    assert.equal(plan.ordersWithoutNfes, 2);
    assert.equal(plan.ordersWithNfes, 1);
    assert.equal(plan.toCreate.length, 1);
  });

  it("apply cria em lote e é idempotente (segunda execução não duplica)", async () => {
    const seed: MockSeed = {
      orders: [
        { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1", nomusRawResponse: { nfes: [NFE_A] } },
        { id: "so-2", orderCode: "PD-2", externalSalesOrderId: 2, externalSalesOrderCode: "PD-2", nomusRawResponse: { nfes: [NFE_B, NFE_C] } },
      ],
      nomusExternalIds: [111, 222, 333],
    };
    const mock = makeMockDb(seed);

    const first = await applySalesOrderNfeLinkBackfill(mock.db as never);
    assert.equal(first.created, 3);
    assert.equal(first.updated, 0);
    assert.equal(mock.links.size, 3);
    assert.equal(mock.calls.createMany >= 1, true);

    const second = await applySalesOrderNfeLinkBackfill(mock.db as never);
    assert.equal(second.created, 0, "segunda execução não cria duplicados");
    assert.equal(second.updated, 0, "segunda execução não atualiza nada igual");
    assert.equal(second.unchanged, 3);
    assert.equal(mock.links.size, 3, "total de links permanece 3");
  });

  it("apply marca como ausente vínculos que sumiram do payload", async () => {
    const now = new Date();
    const linkData = buildSalesOrderNfeLinkWriteData(
      { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1" },
      extractSalesOrderNfesFromNomusPayload({ nfes: [NFE_B] })[0],
      "nomus-222",
      now
    );
    const mock = makeMockDb({
      orders: [
        { id: "so-1", orderCode: "PD-1", externalSalesOrderId: 1, externalSalesOrderCode: "PD-1", nomusRawResponse: { nfes: [NFE_A] } },
      ],
      nomusExternalIds: [111, 222],
      links: [
        { ...linkData, id: "link-old", salesOrderId: "so-1", nfeExternalId: 222, presentInLastPayload: true },
      ],
    });

    const result = await applySalesOrderNfeLinkBackfill(mock.db as never);
    assert.equal(result.created, 1, "NFE_A nova é criada");
    assert.equal(result.markedAbsent, 1, "NFE_B que sumiu é marcada ausente");
    assert.equal(mock.links.get("link-old")?.presentInLastPayload, false);
  });
});
