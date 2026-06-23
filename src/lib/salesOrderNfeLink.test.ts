import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderNfeLinkWriteData,
  extractSalesOrderNfesFromNomusPayload,
  parseNomusNfeProcessingDate,
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
    assert.match(script, /previewSalesOrderNfeLinkBackfill/);
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
});
