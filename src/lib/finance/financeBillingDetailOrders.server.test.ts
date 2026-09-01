/**
 * Loader de Financeiro > Faturamento > Detalhamento com Prisma falso.
 *
 * Cobre a regra canônica de "pedido faturado" (SalesOrderNfeLink → NomusNfe,
 * NF cancelada fora, pedido cancelado fora), a granularidade por pedido
 * (1 linha lógica mesmo com N NF / N documentos) e os 6 filtros da subaba.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadFinanceBillingDetailOrders } from "./financeBillingDetailOrders.server.ts";

const CUSTOMER_ACME = {
  id: "11111111-1111-4111-8111-111111111111",
  companyName: "ACME Industria Ltda",
  tradeName: "ACME",
  taxId: "12.345.678/0001-90",
};

const CUSTOMER_BETA = {
  id: "22222222-2222-4222-8222-222222222222",
  companyName: "Beta Comercio SA",
  tradeName: "Beta",
  taxId: "98.765.432/0001-10",
};

type Nfe = {
  externalId: number;
  numero: string | null;
  serie: string | null;
  status: number | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
};

type Link = {
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeStatus: number | null;
  dataProcessamento: Date | null;
  presentInLastPayload: boolean;
};

type Order = {
  id: string;
  orderCode: string;
  externalSalesOrderCode: string | null;
  externalSalesOrderId: number | null;
  customerId: string;
  companyIssuer: string | null;
  status: string;
  Customer: typeof CUSTOMER_ACME;
};

type StockDoc = {
  externalId: number;
  idNfe: number | null;
  documentNumber: string | null;
  dataDocumento: Date | null;
  isCancelled: boolean;
  tipoDocumentoEstoque: string;
};

type Dataset = {
  nfes: Nfe[];
  links: Link[];
  orders: Order[];
  stockDocuments: StockDoc[];
};

type CallCounter = { nomusNfe: number; link: number; order: number; stock: number };

/**
 * Prisma falso que honra só os predicados realmente usados pelo loader.
 * Suficiente para provar filtro, agregação e ausência de N+1.
 */
function fakePrisma(data: Dataset, counter: CallCounter) {
  const inRange = (
    value: Date | null | undefined,
    range: { gte?: Date; lt?: Date } | undefined
  ): boolean => {
    if (!range) return true;
    if (!value) return false;
    if (range.gte && value.getTime() < range.gte.getTime()) return false;
    if (range.lt && value.getTime() >= range.lt.getTime()) return false;
    return true;
  };

  return {
    nomusNfe: {
      findMany: async ({ where }: any) => {
        counter.nomusNfe += 1;
        if (where?.externalId?.in) {
          const ids: number[] = where.externalId.in;
          return data.nfes.filter((n) => ids.includes(n.externalId));
        }
        const [byIssue, byProcessing] = where.OR;
        return data.nfes.filter((n) => {
          if (inRange(n.xmlDhEmi, byIssue.xmlDhEmi)) return true;
          const [nullIssue, processing] = byProcessing.AND;
          void nullIssue;
          return (
            n.xmlDhEmi == null &&
            inRange(n.dataProcessamento, processing.dataProcessamento)
          );
        });
      },
    },
    salesOrderNfeLink: {
      findMany: async ({ where }: any) => {
        counter.link += 1;
        const [byLinkDate, byNfeIds] = where.OR;
        const ids: number[] = byNfeIds?.nfeExternalId?.in ?? [];
        return data.links.filter((l) => {
          if (l.presentInLastPayload !== true) return false;
          if (ids.includes(l.nfeExternalId)) return true;
          return inRange(l.dataProcessamento, byLinkDate.dataProcessamento);
        });
      },
    },
    salesOrder: {
      findMany: async ({ where }: any) => {
        counter.order += 1;
        const ids: string[] = where.id.in;
        return data.orders.filter((o) => {
          if (!ids.includes(o.id)) return false;
          if (where.status?.not && o.status === where.status.not) return false;
          if (where.customerId && o.customerId !== where.customerId) return false;
          return true;
        });
      },
    },
    nomusStockDocument: {
      findMany: async ({ where }: any) => {
        counter.stock += 1;
        const ids: number[] = where.idNfe.in;
        return data.stockDocuments.filter(
          (d) =>
            d.tipoDocumentoEstoque === where.tipoDocumentoEstoque &&
            d.idNfe != null &&
            ids.includes(d.idNfe)
        );
      },
    },
  };
}

function order(partial: Partial<Order> & Pick<Order, "id" | "orderCode">): Order {
  return {
    externalSalesOrderCode: null,
    externalSalesOrderId: null,
    customerId: CUSTOMER_ACME.id,
    companyIssuer: "Lazarios",
    status: "COMPLETED",
    Customer: CUSTOMER_ACME,
    ...partial,
  };
}

/**
 * Cenário base:
 *  - PD 02716 (ACME): 2 NF em agosto/2026 + 2 documentos de saída;
 *  - PD 02717 (Beta): 1 NF em agosto/2026 + 1 documento;
 *  - PD 02718 (ACME): NF cancelada em agosto (não fatura);
 *  - PD 02719 (ACME): pedido cancelado (não fatura);
 *  - PD 02716 também tem NF em setembro/2026 (faturamento parcial em 2 meses).
 */
function baseDataset(): Dataset {
  return {
    nfes: [
      {
        externalId: 7001,
        numero: "7001",
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 7, 5),
        dataProcessamento: new Date(2026, 7, 6),
      },
      {
        externalId: 7002,
        numero: "7002",
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 7, 20),
        dataProcessamento: new Date(2026, 7, 21),
      },
      {
        externalId: 7003,
        numero: "7003",
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 7, 12),
        dataProcessamento: new Date(2026, 7, 13),
      },
      {
        externalId: 7004,
        numero: "7004",
        serie: "1",
        status: 7, // cancelada
        xmlDhEmi: new Date(2026, 7, 14),
        dataProcessamento: new Date(2026, 7, 15),
      },
      {
        externalId: 7005,
        numero: "7005",
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 7, 18),
        dataProcessamento: new Date(2026, 7, 19),
      },
      {
        externalId: 7010,
        numero: "7010",
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 8, 3),
        dataProcessamento: new Date(2026, 8, 4),
      },
    ],
    links: [
      link("o-2716", 7001),
      link("o-2716", 7002),
      link("o-2717", 7003),
      link("o-2718", 7004),
      link("o-2719", 7005),
      link("o-2716", 7010),
    ],
    orders: [
      order({
        id: "o-2716",
        orderCode: "PD 02716",
        externalSalesOrderCode: "2716",
        externalSalesOrderId: 2716,
      }),
      order({
        id: "o-2717",
        orderCode: "PD 02717",
        customerId: CUSTOMER_BETA.id,
        Customer: CUSTOMER_BETA,
      }),
      order({ id: "o-2718", orderCode: "PD 02718" }),
      order({ id: "o-2719", orderCode: "PD 02719", status: "CANCELLED" }),
    ],
    stockDocuments: [
      stockDoc(8501, 7001, "8501", new Date(2026, 7, 5)),
      stockDoc(8502, 7002, "8502", new Date(2026, 7, 20)),
      stockDoc(8503, 7003, "8503", new Date(2026, 7, 12)),
      stockDoc(8510, 7010, "8510", new Date(2026, 8, 3)),
    ],
  };
}

function link(salesOrderId: string, nfeExternalId: number): Link {
  return {
    salesOrderId,
    nfeExternalId,
    nfeNumber: String(nfeExternalId),
    nfeSerie: "1",
    nfeStatus: null,
    dataProcessamento: null,
    presentInLastPayload: true,
  };
}

function stockDoc(
  externalId: number,
  idNfe: number,
  documentNumber: string,
  dataDocumento: Date
): StockDoc {
  return {
    externalId,
    idNfe,
    documentNumber,
    dataDocumento,
    isCancelled: false,
    tipoDocumentoEstoque: "DocumentoSaida",
  };
}

async function run(
  query: Record<string, unknown>,
  data: Dataset = baseDataset()
) {
  const counter: CallCounter = { nomusNfe: 0, link: 0, order: 0, stock: 0 };
  const payload = await loadFinanceBillingDetailOrders(query, {
    prisma: fakePrisma(data, counter) as never,
    now: new Date(2026, 8, 1, 10, 0, 0),
  });
  return { payload, counter };
}

describe("financeBillingDetailOrders.server — filtros", () => {
  it("filtro por ANO devolve os pedidos faturados no ano (sem duplicar)", async () => {
    const { payload } = await run({ year: "2026" });
    const codes = payload.items.map((i) => i.orderCode);
    assert.deepEqual([...codes].sort(), ["PD 02716", "PD 02717"]);
    assert.equal(codes.filter((c) => c === "PD 02716").length, 1);
    assert.equal(payload.pagination.totalItems, 2);
  });

  it("filtro por MÊS restringe à competência", async () => {
    const agosto = await run({ year: "2026", month: "8" });
    assert.deepEqual(
      agosto.payload.items.map((i) => i.orderCode).sort(),
      ["PD 02716", "PD 02717"]
    );
    assert.equal(agosto.payload.period.label, "Agosto/2026");

    const setembro = await run({ year: "2026", month: "9" });
    assert.deepEqual(
      setembro.payload.items.map((i) => i.orderCode),
      ["PD 02716"]
    );
  });

  it("mesmo pedido faturado em meses diferentes aparece nos dois meses, com as NF de cada um", async () => {
    const agosto = await run({ year: "2026", month: "8" });
    const setembro = await run({ year: "2026", month: "9" });

    const agostoRow = agosto.payload.items.find((i) => i.orderCode === "PD 02716")!;
    const setembroRow = setembro.payload.items.find((i) => i.orderCode === "PD 02716")!;

    assert.deepEqual(
      agostoRow.invoices.map((n) => n.number).sort(),
      ["7001", "7002"]
    );
    assert.deepEqual(setembroRow.invoices.map((n) => n.number), ["7010"]);
  });

  it("filtro por CLIENTE (customerId canônico)", async () => {
    const { payload } = await run({
      year: "2026",
      customerId: CUSTOMER_BETA.id,
    });
    assert.deepEqual(payload.items.map((i) => i.orderCode), ["PD 02717"]);
    assert.equal(payload.items[0]!.customerName, "Beta");
  });

  it("filtro por CLIENTE aceita nome quando não há id selecionado", async () => {
    const { payload } = await run({ year: "2026", customerName: "acme" });
    assert.deepEqual(payload.items.map((i) => i.orderCode), ["PD 02716"]);
  });

  it("filtro por PEDIDO DE VENDA aceita número puro e código apresentado", async () => {
    const byNumber = await run({ year: "2026", salesOrder: "2716" });
    assert.deepEqual(byNumber.payload.items.map((i) => i.orderCode), ["PD 02716"]);

    const byLabel = await run({ year: "2026", salesOrder: "PD 02717" });
    assert.deepEqual(byLabel.payload.items.map((i) => i.orderCode), ["PD 02717"]);
  });

  it("filtro por DOCUMENTO DE SAÍDA localiza o pedido relacionado", async () => {
    const { payload } = await run({ year: "2026", outputDocument: "8503" });
    assert.deepEqual(payload.items.map((i) => i.orderCode), ["PD 02717"]);
  });

  it("filtro por NF localiza o pedido relacionado (pelo número da nota)", async () => {
    const { payload } = await run({ year: "2026", invoice: "7002" });
    assert.deepEqual(payload.items.map((i) => i.orderCode), ["PD 02716"]);
    // A linha continua mostrando todas as NF do período, não só a filtrada.
    assert.deepEqual(
      payload.items[0]!.invoices.map((n) => n.number).sort(),
      ["7001", "7002", "7010"]
    );
  });

  it("combinação de filtros aplica todos (AND)", async () => {
    const match = await run({
      year: "2026",
      month: "8",
      customerId: CUSTOMER_ACME.id,
      salesOrder: "2716",
      outputDocument: "8501",
      invoice: "7001",
    });
    assert.deepEqual(match.payload.items.map((i) => i.orderCode), ["PD 02716"]);

    const conflicting = await run({
      year: "2026",
      month: "8",
      customerId: CUSTOMER_BETA.id,
      invoice: "7001",
    });
    assert.deepEqual(conflicting.payload.items, []);
  });

  it("resultado vazio devolve payload consistente (sem erro)", async () => {
    const { payload } = await run({ year: "2020" });
    assert.deepEqual(payload.items, []);
    assert.equal(payload.pagination.totalItems, 0);
    assert.equal(payload.pagination.totalPages, 1);
    assert.equal(payload.period.year, 2020);
    assert.ok(payload.generatedAt);
  });
});

describe("financeBillingDetailOrders.server — regra canônica de faturado", () => {
  it("NF cancelada (status 7) não torna o pedido faturado", async () => {
    const { payload } = await run({ year: "2026" });
    assert.equal(
      payload.items.some((i) => i.orderCode === "PD 02718"),
      false
    );
  });

  it("pedido cancelado fica fora mesmo com NF válida vinculada", async () => {
    const { payload } = await run({ year: "2026" });
    assert.equal(
      payload.items.some((i) => i.orderCode === "PD 02719"),
      false
    );
  });

  it("vínculo ausente do último payload Nomus não conta", async () => {
    const data = baseDataset();
    for (const l of data.links) {
      if (l.salesOrderId === "o-2717") l.presentInLastPayload = false;
    }
    const { payload } = await run({ year: "2026" }, data);
    assert.equal(
      payload.items.some((i) => i.orderCode === "PD 02717"),
      false
    );
  });

  it("usa a data fiscal/emissão da NF (não a data de processamento) para o Ano/Mês", async () => {
    const data = baseDataset();
    // NF emitida em 31/08 e processada em 01/09: competência = agosto.
    data.nfes = [
      {
        externalId: 9001,
        numero: "9001",
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 7, 31),
        dataProcessamento: new Date(2026, 8, 1),
      },
    ];
    data.links = [link("o-2716", 9001)];
    data.stockDocuments = [];

    const agosto = await run({ year: "2026", month: "8" }, data);
    assert.deepEqual(agosto.payload.items.map((i) => i.orderCode), ["PD 02716"]);

    const setembro = await run({ year: "2026", month: "9" }, data);
    assert.deepEqual(setembro.payload.items, []);
  });

  it("cai para a data do vínculo quando a NF-e não existe no stage local", async () => {
    const data = baseDataset();
    data.nfes = [];
    data.links = [
      { ...link("o-2716", 9500), dataProcessamento: new Date(2026, 7, 9) },
    ];
    data.stockDocuments = [];

    const { payload } = await run({ year: "2026", month: "8" }, data);
    assert.deepEqual(payload.items.map((i) => i.orderCode), ["PD 02716"]);
    assert.equal(payload.items[0]!.invoices[0]!.number, "9500");
  });

  it("não inventa faturamento quando não há nenhuma data", async () => {
    const data = baseDataset();
    data.nfes = [
      {
        externalId: 9600,
        numero: "9600",
        serie: null,
        status: 4,
        xmlDhEmi: null,
        dataProcessamento: null,
      },
    ];
    data.links = [link("o-2716", 9600)];
    data.stockDocuments = [];

    const { payload } = await run({ year: "2026" }, data);
    assert.deepEqual(payload.items, []);
  });
});

describe("financeBillingDetailOrders.server — granularidade e agregação", () => {
  it("pedido com N NF e N documentos vira 1 linha lógica com as referências agregadas", async () => {
    const { payload } = await run({ year: "2026", month: "8" });
    const row = payload.items.find((i) => i.orderCode === "PD 02716")!;
    assert.equal(payload.items.filter((i) => i.orderCode === "PD 02716").length, 1);
    assert.deepEqual(row.invoices.map((n) => n.number).sort(), ["7001", "7002"]);
    assert.deepEqual(
      row.outputDocuments.map((d) => d.number).sort(),
      ["8501", "8502"]
    );
    assert.equal(row.salesOrderId, "o-2716");
  });

  it("expõe primeira e última competência do pedido no período", async () => {
    const { payload } = await run({ year: "2026", month: "8" });
    const row = payload.items.find((i) => i.orderCode === "PD 02716")!;
    assert.equal(row.firstInvoiceDate, new Date(2026, 7, 5).toISOString());
    assert.equal(row.lastInvoiceDate, new Date(2026, 7, 20).toISOString());
  });

  it("dois documentos apontando para a mesma NF não duplicam a referência", async () => {
    const data = baseDataset();
    data.stockDocuments.push(stockDoc(8599, 7001, "8599", new Date(2026, 7, 5)));
    const { payload } = await run({ year: "2026", month: "8" }, data);
    const row = payload.items.find((i) => i.orderCode === "PD 02716")!;
    assert.deepEqual(
      row.outputDocuments.map((d) => d.number).sort(),
      ["8501", "8502", "8599"]
    );
    assert.equal(new Set(row.outputDocuments.map((d) => d.externalId)).size, 3);
  });

  it("pedido sem documento de saída ainda aparece (NF sem documento vinculado)", async () => {
    const data = baseDataset();
    data.stockDocuments = [];
    const { payload } = await run({ year: "2026", month: "8" }, data);
    const row = payload.items.find((i) => i.orderCode === "PD 02716")!;
    assert.deepEqual(row.outputDocuments, []);
    assert.ok(row.invoices.length > 0);
  });

  it("entrega a chave canônica do SalesOrder (id) para o modal de detalhe", async () => {
    const { payload } = await run({ year: "2026", month: "8" });
    for (const row of payload.items) {
      assert.match(row.salesOrderId, /^o-\d+$/);
      assert.ok(row.orderCode.length > 0);
    }
  });
});

describe("financeBillingDetailOrders.server — paginação, ordenação e custo", () => {
  it("pagina no servidor mantendo o total real", async () => {
    const first = await run({ year: "2026", pageSize: "1", page: "1" });
    const second = await run({ year: "2026", pageSize: "1", page: "2" });

    assert.equal(first.payload.pagination.totalItems, 2);
    assert.equal(first.payload.pagination.totalPages, 2);
    assert.equal(first.payload.items.length, 1);
    assert.equal(second.payload.items.length, 1);
    assert.notEqual(
      first.payload.items[0]!.orderCode,
      second.payload.items[0]!.orderCode
    );
  });

  it("ordena por data de faturamento (desc por padrão) e aceita inversão", async () => {
    const desc = await run({ year: "2026", month: "8" });
    assert.deepEqual(
      desc.payload.items.map((i) => i.orderCode),
      ["PD 02716", "PD 02717"]
    );

    const asc = await run({ year: "2026", month: "8", sortDir: "asc" });
    assert.deepEqual(
      asc.payload.items.map((i) => i.orderCode),
      ["PD 02717", "PD 02716"]
    );
  });

  it("ordena por pedido quando solicitado", async () => {
    const { payload } = await run({
      year: "2026",
      sortBy: "orderCode",
      sortDir: "asc",
    });
    assert.deepEqual(
      payload.items.map((i) => i.orderCode),
      ["PD 02716", "PD 02717"]
    );
  });

  it("consulta em lote: número de queries não cresce com a quantidade de linhas", async () => {
    const small = await run({ year: "2026", month: "9" });

    const data = baseDataset();
    for (let i = 0; i < 40; i += 1) {
      const nfeId = 9100 + i;
      data.nfes.push({
        externalId: nfeId,
        numero: String(nfeId),
        serie: "1",
        status: 4,
        xmlDhEmi: new Date(2026, 7, 10),
        dataProcessamento: new Date(2026, 7, 11),
      });
      data.links.push(link(`o-bulk-${i}`, nfeId));
      data.orders.push(order({ id: `o-bulk-${i}`, orderCode: `PD 1${i}` }));
      data.stockDocuments.push(
        stockDoc(9600 + i, nfeId, String(9600 + i), new Date(2026, 7, 10))
      );
    }
    const big = await run({ year: "2026", month: "8" }, data);

    assert.ok(big.payload.items.length > 40);
    assert.deepEqual(big.counter, small.counter);
    assert.equal(big.counter.order, 1);
    assert.equal(big.counter.stock, 1);
    assert.equal(big.counter.link, 1);
  });
});
