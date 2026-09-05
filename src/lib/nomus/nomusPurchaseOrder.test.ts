import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { classifyNomusPurchaseOrderStage, isNomusPurchaseOrderOverdue } from "./nomusPurchaseOrderClassifier.js";
import {
  mapNomusPurchaseOrderPayload,
  stableNomusPayloadHash,
} from "./nomusPurchaseOrderMapper.js";
import {
  pickFirstInt,
  pickPurchaseOrderArray,
  pickPurchaseOrderItemsArray,
} from "./nomusPurchaseOrderParser.js";
import {
  buildNomusPurchaseOrderKpis,
  buildNomusPurchaseOrderWhere,
  parseNomusPurchaseOrderListFilters,
  serializeNomusPurchaseOrderListRow,
} from "./nomusPurchaseOrderQuery.js";
import {
  decideNomusArToPurchaseOrderChain,
  resolveChainedExitCode,
} from "./nomusPurchaseOrderArChain.js";
import {
  buildPurchaseOrderPageParams,
  decidePurchaseOrderApply,
  hasNextPurchaseOrderPage,
  parsePurchaseOrderSyncCli,
  resolvePurchaseOrderWindow,
} from "./nomusPurchaseOrderSyncLogic.js";
import {
  formatNomusPurchaseOrderProgress,
  nomusPurchaseOrderStageLabel,
} from "./nomusPurchaseOrderUi.js";
import { fetchNomusJson } from "@/src/lib/nomusRestClient.js";

const SANITIZED_PAYLOAD = {
  id: 90001,
  numero: "PC-1001",
  idFornecedor: 77,
  nomeFornecedor: "Fornecedor Exemplo LTDA",
  cnpjFornecedor: "00.000.000/0001-00",
  status: "Aberto",
  cancelado: false,
  dataEmissao: "15/03/2026",
  dataPrevisao: "20/03/2026",
  dataCriacao: "15/03/2026 10:11:12",
  dataModificacao: "16/03/2026 08:00:00",
  condicaoPagamento: "28 DDL",
  observacoes: "Pedido sanitizado de fixture",
  valorTotal: "1.250,50",
  valorDesconto: "0,00",
  valorFrete: "50,00",
  itens: [
    {
      id: 1,
      idProduto: 501,
      codigoProduto: "MP-001",
      descricao: "Chapa sanitizada",
      unidade: "KG",
      quantidade: "10,000",
      quantidadeAtendida: "4,000",
      valorUnitario: "100,00",
      valorTotal: "1.000,00",
    },
  ],
};

describe("nomusPurchaseOrderParser", () => {
  it("extrai array de pedidos de envelopes conhecidos", () => {
    assert.equal(pickPurchaseOrderArray({ pedidoscompra: [SANITIZED_PAYLOAD] }).length, 1);
    assert.equal(pickPurchaseOrderArray({ dados: [SANITIZED_PAYLOAD] }).length, 1);
    assert.equal(pickPurchaseOrderArray([SANITIZED_PAYLOAD]).length, 1);
    assert.deepEqual(pickPurchaseOrderArray(null), []);
  });

  it("aceita números como string e nulls", () => {
    assert.equal(pickFirstInt({ id: "90001" }, ["id"]), 90001);
    assert.equal(pickFirstInt({ id: null }, ["id"]), null);
    assert.equal(pickPurchaseOrderItemsArray({ itens: null }).length, 0);
  });
});

describe("nomusPurchaseOrderMapper", () => {
  it("mapeia payload completo sanitizado", () => {
    const mapped = mapNomusPurchaseOrderPayload(SANITIZED_PAYLOAD);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 90001);
    assert.equal(mapped.row.orderNumber, "PC-1001");
    assert.equal(mapped.row.supplierExternalId, 77);
    assert.equal(mapped.row.totalAmount, 1250.5);
    assert.equal(mapped.row.items.length, 1);
    assert.equal(mapped.row.items[0].orderedQuantity, 10);
    assert.equal(mapped.row.items[0].receivedQuantity, 4);
    assert.equal(mapped.row.stage, "PARTIALLY_RECEIVED");
    assert.ok(mapped.row.rawPayload);
    assert.equal(mapped.row.payloadHash, stableNomusPayloadHash(SANITIZED_PAYLOAD));
  });

  it("rejeita payload sem id", () => {
    const mapped = mapNomusPurchaseOrderPayload({ numero: "X" });
    assert.equal(mapped.ok, false);
  });

  it("mesmo payload produz o mesmo hash; alteração muda o hash", () => {
    const first = stableNomusPayloadHash(SANITIZED_PAYLOAD);
    const second = stableNomusPayloadHash(SANITIZED_PAYLOAD);
    const changed = stableNomusPayloadHash({ ...SANITIZED_PAYLOAD, valorTotal: "1.300,00" });
    assert.equal(first, second);
    assert.notEqual(first, changed);
  });
});

describe("nomusPurchaseOrderClassifier", () => {
  it("cancelado tem prioridade", () => {
    assert.equal(classifyNomusPurchaseOrderStage({ canceled: true, statusRaw: "Recebido" }), "CANCELED");
    assert.equal(classifyNomusPurchaseOrderStage({ statusRaw: "Cancelado" }), "CANCELED");
  });

  it("aberto, parcial, concluído e unknown", () => {
    assert.equal(classifyNomusPurchaseOrderStage({ statusRaw: "Aberto" }), "OPEN");
    assert.equal(
      classifyNomusPurchaseOrderStage({ orderedQuantity: 10, receivedQuantity: 4 }),
      "PARTIALLY_RECEIVED"
    );
    assert.equal(
      classifyNomusPurchaseOrderStage({ orderedQuantity: 10, receivedQuantity: 10 }),
      "RECEIVED"
    );
    assert.equal(classifyNomusPurchaseOrderStage({ statusRaw: "estado-novo-xyz" }), "UNKNOWN");
  });

  it("não classifica ausência de quantidade como recebido", () => {
    assert.notEqual(classifyNomusPurchaseOrderStage({ statusRaw: "Aberto" }), "RECEIVED");
    assert.equal(classifyNomusPurchaseOrderStage({}), "UNKNOWN");
  });

  it("atraso só em fase aberta com previsão vencida", () => {
    const now = new Date("2026-04-01T12:00:00");
    assert.equal(
      isNomusPurchaseOrderOverdue({
        stage: "OPEN",
        expectedAt: new Date("2026-03-20"),
        now,
      }),
      true
    );
    assert.equal(
      isNomusPurchaseOrderOverdue({
        stage: "RECEIVED",
        expectedAt: new Date("2026-03-20"),
        now,
      }),
      false
    );
  });
});

describe("nomusPurchaseOrderSyncLogic", () => {
  it("preview é o modo padrão e apply grava só quando pedido", () => {
    assert.equal(parsePurchaseOrderSyncCli(["preview"]).mode, "preview");
    assert.equal(parsePurchaseOrderSyncCli(["apply", "--incremental"]).mode, "apply");
    assert.equal(parsePurchaseOrderSyncCli(["apply", "--incremental"]).incremental, true);
  });

  it("paginação para em página vazia ou menor que o page size", () => {
    assert.equal(hasNextPurchaseOrderPage({ totalPaginas: 3 }, 1, 50, 50), true);
    assert.equal(hasNextPurchaseOrderPage({ totalPaginas: 3 }, 3, 10, 50), false);
    assert.equal(hasNextPurchaseOrderPage({}, 1, 0, 50), false);
  });

  it("janela de backfill 12 meses e incremental 45 dias", () => {
    const now = new Date(2026, 8, 5);
    const backfill = resolvePurchaseOrderWindow({ now, incremental: false, backfill: true });
    const incremental = resolvePurchaseOrderWindow({ now, incremental: true, backfill: false });
    assert.equal(backfill.startDate, "05/09/2025");
    assert.equal(incremental.startDate, "22/07/2026");
  });

  it("idempotência: hash igual não atualiza payload", () => {
    assert.equal(decidePurchaseOrderApply(null, "abc"), "create");
    assert.equal(decidePurchaseOrderApply("abc", "abc"), "unchanged");
    assert.equal(decidePurchaseOrderApply("abc", "def"), "update");
  });

  it("reutiliza o cliente Nomus para 429/retry sem logar token", async () => {
    const originalFetch = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("rate limited Bearer secret-leak", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ pedidoscompra: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const payload = await fetchNomusJson(new URL("https://host/rest/pedidoscompra?pagina=1"), {
        maxRetries: 2,
        retryBaseMs: 1,
        sleepFn: async () => undefined,
        logPrefix: "[test-po]",
      });
      assert.deepEqual(payload, { pedidoscompra: [] });
      assert.equal(attempts, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("monta query com pagina e janela", () => {
    const params = buildPurchaseOrderPageParams(2, 50, {
      startDate: "05/09/2025",
      endDate: "05/09/2026",
    });
    assert.equal(params.pagina, "2");
    assert.equal(params.tamanhoPagina, "50");
    assert.equal(params.dataInicio, "05/09/2025");
  });
});

describe("nomusPurchaseOrderArChain", () => {
  it("AR sucesso dispara PO; AR falha não dispara; PO falha preserva AR", () => {
    assert.equal(decideNomusArToPurchaseOrderChain({ arExitCode: 0 }).shouldRunPurchaseOrders, true);
    assert.equal(decideNomusArToPurchaseOrderChain({ arExitCode: 1 }).shouldRunPurchaseOrders, false);
    assert.equal(resolveChainedExitCode(0, 1), 0);
    assert.equal(resolveChainedExitCode(2, 0), 2);
  });
});

describe("nomusPurchaseOrderQuery", () => {
  it("filtros de listagem e paginação", () => {
    const filters = parseNomusPurchaseOrderListFilters({
      q: "PC-1",
      stage: "OPEN",
      openOnly: "1",
      page: "2",
      pageSize: "10",
    });
    assert.equal(filters.q, "PC-1");
    assert.equal(filters.stage, "OPEN");
    assert.equal(filters.openOnly, true);
    assert.equal(filters.page, 2);
    const where = buildNomusPurchaseOrderWhere(filters);
    assert.ok(where.AND);
  });

  it("serializa detalhe e KPIs sem inferir recebimento ausente", () => {
    const now = new Date("2026-04-01T12:00:00");
    const row = serializeNomusPurchaseOrderListRow(
      {
        id: "a",
        externalId: 1,
        orderNumber: "PC-1",
        supplierExternalId: 7,
        supplierName: "Forn",
        supplierTaxId: null,
        statusRaw: "Aberto",
        canceled: false,
        stage: "OPEN",
        issuedAt: new Date("2026-03-01"),
        expectedAt: new Date("2026-03-20"),
        totalAmount: { toString: () => "10" },
        itemCount: 1,
        orderedQuantity: null,
        receivedQuantity: null,
        remainingQuantity: null,
        syncedAt: now,
        lastSeenAt: now,
      },
      now
    );
    assert.equal(row.overdue, true);
    assert.equal(row.receivedQuantity, null);
    const kpis = buildNomusPurchaseOrderKpis(
      [{ stage: "OPEN", expectedAt: new Date("2026-03-20"), totalAmount: { toString: () => "10" } }],
      now
    );
    assert.equal(kpis.openCount, 1);
    assert.equal(kpis.overdueCount, 1);
  });
});

describe("nomusPurchaseOrderUi", () => {
  it("rótulos e progresso", () => {
    assert.equal(nomusPurchaseOrderStageLabel("CANCELED"), "Cancelado");
    assert.match(formatNomusPurchaseOrderProgress({ orderedQuantity: null, receivedQuantity: null }), /indisponível/i);
    assert.match(formatNomusPurchaseOrderProgress({ orderedQuantity: 10, receivedQuantity: 4 }), /4 \/ 10/);
  });
});

describe("nomusPurchaseOrder integration wiring", () => {
  it("AR runner encadeia PO sem trocar o exit code", () => {
    const sh = readFileSync("scripts/runNomusAccountsReceivableSync.sh", "utf8");
    assert.match(sh, /runNomusPurchaseOrdersSync\.sh/);
    assert.match(sh, /EXIT_CODE original de AR preservado/);
    assert.match(sh, /AR_TECHNICAL_FAILURE/);
  });

  it("PO runner usa lock global e lock próprio", () => {
    const sh = readFileSync("scripts/runNomusPurchaseOrdersSync.sh", "utf8");
    assert.match(sh, /induscost-nomus-sync-global\.lock/);
    assert.match(sh, /induscost-nomus-purchase-orders\.lock/);
  });

  it("UI e rotas permanecem separadas de PurchaseRequest", () => {
    const ui = readFileSync("src/components/NomusPurchaseOrderModule.tsx", "utf8");
    const routes = readFileSync("src/lib/nomusPurchaseOrderRoutes.ts", "utf8");
    assert.match(ui, /Pedidos Nomus|espelho somente leitura/i);
    assert.doesNotMatch(ui, /PurchaseRequest/);
    assert.match(routes, /\/api\/nomus\/purchase-orders/);
    assert.match(routes, /purchases\.nomusPurchaseOrders\.view/);
  });
});
