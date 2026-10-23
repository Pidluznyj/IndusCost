/**
 * Gerador determinístico de cenários N:N sintéticos para o banco efêmero de teste:
 * vendedores, regras, clientes, produtos, pedidos/itens, NF-e, vínculos pedido × NF-e,
 * documentos de saída (com idItemPedido), títulos e eventos de recebimento.
 * Tudo inventado — nenhum dado real de cliente, vendedor ou título.
 */
import type { PrismaClient } from "@prisma/client";

export type SeedSeller = { nomusId: number; name: string; registered?: boolean };
export type SeedProduct = { key: string; externalId: number; ratePercent: number };
export type SeedOrderItem = { key: string; productKey: string; quantity: number; unitPrice: number; nomusItemExternalId: number };
export type SeedOrder = { key: string; code: string; externalId: number; sellerNomusId: number; issueDate: string; items: SeedOrderItem[] };
export type SeedTitle = { externalId: number; amount: number; due: string };
export type SeedDocumentLine = { orderKey: string; itemKey: string; quantity: number };
export type SeedNfe = {
  externalId: number;
  numero: string;
  processedAt: string;
  cancelled?: boolean;
  orderKeys: string[];
  titles: SeedTitle[];
  documents?: Array<{ externalId: number; lines: SeedDocumentLine[] }>;
};
export type SeedReceipt = { externalId: number; titleExternalId: number; date: string; amount: number };
export type SeedScenario = {
  sellers: SeedSeller[];
  products: SeedProduct[];
  orders: SeedOrder[];
  nfes: SeedNfe[];
  receipts: SeedReceipt[];
  customer?: { externalId: number; name: string; taxId: string };
};

export type SeededIds = {
  orderIdByKey: Map<string, string>;
  itemIdByKey: Map<string, string>;
  personIdByNomusId: Map<number, string>;
  customerId: string;
};

const day = (civil: string) => new Date(`${civil}T12:00:00.000Z`);
const money = (value: number) => Math.round(value * 100) / 100;

export async function seedCommissionScenario(prisma: PrismaClient, scenario: SeedScenario): Promise<SeededIds> {
  const customerSpec = scenario.customer ?? { externalId: 500, name: "CLIENTE SINTÉTICO N:N", taxId: "SINTETICO-NN-0001" };
  const customer = await prisma.customer.upsert({
    where: { taxId: customerSpec.taxId },
    update: {},
    create: { companyName: customerSpec.name, tradeName: customerSpec.name, taxId: customerSpec.taxId },
  });

  const personIdByNomusId = new Map<number, string>();
  for (const seller of scenario.sellers) {
    if (seller.registered === false) continue;
    const existing = await prisma.commissionPerson.findFirst({ where: { nomusPersonId: seller.nomusId } });
    const person =
      existing ??
      (await prisma.commissionPerson.create({
        data: { name: seller.name, type: "SELLER", nomusPersonId: seller.nomusId, source: "NOMUS", active: true },
      }));
    personIdByNomusId.set(seller.nomusId, person.id);
    const alias = await prisma.commissionPersonAlias.findFirst({ where: { source: "NOMUS_ORDER", rawSellerId: seller.nomusId } });
    if (!alias) {
      await prisma.commissionPersonAlias.create({
        data: {
          commissionedPersonId: person.id,
          source: "NOMUS_ORDER",
          rawSellerId: seller.nomusId,
          rawSellerName: seller.name,
          normalizedSellerName: seller.name.toUpperCase(),
          status: "ACTIVE",
          confidence: 1,
        },
      });
    }
  }

  const productIdByKey = new Map<string, string>();
  for (const product of scenario.products) {
    const row = await prisma.product.upsert({
      where: { sku: `SKU-NN-${product.key}` },
      update: {},
      create: { sku: `SKU-NN-${product.key}`, name: `Produto sintético ${product.key}` },
    });
    productIdByKey.set(product.key, row.id);
    const ruleName = `Regra sintética ${product.key}`;
    if (!(await prisma.commissionRule.findFirst({ where: { name: ruleName } }))) {
      await prisma.commissionRule.create({
        data: {
          name: ruleName,
          beneficiaryType: "SELLER",
          calculationType: "FIXED_PERCENT",
          ratePercent: product.ratePercent,
          baseType: "SALES_ORDER_ITEM_NET",
          releaseRule: "EACH_RECEIVABLE_PAID",
          priority: 10,
          conditions: { create: [{ productExternalId: product.externalId }] },
        },
      });
    }
  }

  const productByKey = new Map(scenario.products.map((product) => [product.key, product]));
  const sellerByNomusId = new Map(scenario.sellers.map((seller) => [seller.nomusId, seller]));
  const orderIdByKey = new Map<string, string>();
  const itemIdByKey = new Map<string, string>();
  for (const order of scenario.orders) {
    const total = money(order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
    const row = await prisma.salesOrder.create({
      data: {
        orderCode: order.code,
        customerId: customer.id,
        externalSalesOrderId: order.externalId,
        externalCustomerId: customerSpec.externalId,
        externalSellerId: order.sellerNomusId,
        nomusSellerName: sellerByNomusId.get(order.sellerNomusId)?.name ?? null,
        issueDate: day(order.issueDate),
        totalNetValue: total,
        items: {
          create: order.items.map((item, index) => {
            const product = productByKey.get(item.productKey)!;
            const net = money(item.quantity * item.unitPrice);
            return {
              productId: productIdByKey.get(item.productKey)!,
              externalProductId: product.externalId,
              skuSnapshot: `SKU-NN-${item.productKey}`,
              productNameSnapshot: `Produto sintético ${item.productKey}`,
              quantity: item.quantity,
              unitCost: 0,
              negotiatedPrice: item.unitPrice,
              totalNetValue: net,
              totalCost: 0,
              marginValue: net,
              marginPerc: 100,
              nomusItemExternalId: item.nomusItemExternalId,
              nomusItemSequence: String(index + 1).padStart(5, "0"),
            };
          }),
        },
      },
      include: { items: { select: { id: true, nomusItemExternalId: true } } },
    });
    orderIdByKey.set(order.key, row.id);
    for (const item of order.items) {
      const created = row.items.find((candidate) => candidate.nomusItemExternalId === item.nomusItemExternalId)!;
      itemIdByKey.set(`${order.key}:${item.key}`, created.id);
    }
  }

  const orderByKey = new Map(scenario.orders.map((order) => [order.key, order]));
  for (const nfe of scenario.nfes) {
    const status = nfe.cancelled ? 7 : 4;
    const value = money(nfe.titles.reduce((sum, title) => sum + title.amount, 0));
    await prisma.nomusNfe.create({
      data: {
        externalId: nfe.externalId,
        numero: nfe.numero,
        status,
        tipoOperacao: 1,
        dataProcessamento: day(nfe.processedAt),
        valorLiquido: value,
        xmlVNF: value,
        rawPayload: { sintetico: true },
        payloadHash: `nfe-${nfe.externalId}`,
        syncedAt: new Date(),
      },
    });
    for (const orderKey of nfe.orderKeys) {
      const order = orderByKey.get(orderKey)!;
      await prisma.salesOrderNfeLink.create({
        data: {
          salesOrderId: orderIdByKey.get(orderKey)!,
          externalSalesOrderId: order.externalId,
          orderCode: order.code,
          nfeExternalId: nfe.externalId,
          nfeNumber: nfe.numero,
          nfeStatus: status,
          tipoOperacao: 1,
          dataProcessamento: day(nfe.processedAt),
        },
      });
    }
    for (const title of nfe.titles) {
      await prisma.nomusAccountsReceivable.create({
        data: {
          externalId: title.externalId,
          sourceInvoiceId: nfe.externalId,
          sourceInvoiceNumber: nfe.numero,
          personId: customerSpec.externalId,
          personName: customerSpec.name,
          personCnpj: customerSpec.taxId,
          dueDate: day(title.due),
          amountReceivable: title.amount,
          amountReceived: 0,
          balanceReceivable: title.amount,
          status: false,
          suspendCollection: false,
          rawPayload: { sintetico: true },
          payloadHash: `cr-${title.externalId}`,
          syncedAt: new Date(),
        },
      });
    }
    for (const document of nfe.documents ?? []) {
      await addOutputDocument(prisma, {
        documentExternalId: document.externalId,
        nfeExternalId: nfe.externalId,
        // Documento de saída de NF-e cancelada também é cancelado no Nomus.
        cancelled: nfe.cancelled === true,
        lines: document.lines.map((line) => {
          const order = orderByKey.get(line.orderKey)!;
          const item = order.items.find((candidate) => candidate.key === line.itemKey)!;
          return {
            externalSalesOrderId: order.externalId,
            nomusItemExternalId: item.nomusItemExternalId,
            productExternalId: productByKey.get(item.productKey)!.externalId,
            quantity: line.quantity,
            unitPrice: item.unitPrice,
          };
        }),
      });
    }
  }

  await addReceipts(prisma, scenario.receipts);
  return { orderIdByKey, itemIdByKey, personIdByNomusId, customerId: customer.id };
}

/**
 * Documento de saída do Nomus para uma NF-e já gravada, com `idPedido`/`idItemPedido`
 * nas linhas (como a sincronização grava). Usado também para a evidência que chega depois.
 */
export async function addOutputDocument(
  prisma: PrismaClient,
  input: {
    documentExternalId: number;
    nfeExternalId: number;
    cancelled?: boolean;
    lines: Array<{ externalSalesOrderId: number; nomusItemExternalId: number; productExternalId: number; quantity: number; unitPrice: number }>;
  }
): Promise<void> {
  await prisma.nomusStockDocument.create({
    data: {
      externalId: input.documentExternalId,
      idNfe: input.nfeExternalId,
      tipoDocumentoEstoque: "Saída por venda",
      statusRaw: input.cancelled ? "Cancelado" : "Emitido",
      isCancelled: input.cancelled === true,
      rawJson: { sintetico: true },
      payloadHash: `ds-${input.documentExternalId}`,
      syncedAt: new Date(),
      items: {
        create: input.lines.map((line) => ({
          externalItemId: Number(`${input.documentExternalId}${line.nomusItemExternalId}`.slice(-9)),
          externalProductId: line.productExternalId,
          quantity: line.quantity,
          unitValue: line.unitPrice,
          estimatedTotalValue: money(line.quantity * line.unitPrice),
          rawJson: {
            idPedido: line.externalSalesOrderId,
            idItemPedido: line.nomusItemExternalId,
            idProduto: line.productExternalId,
            quantidade: line.quantity,
          },
        })),
      },
    },
  });
}

/** Eventos de recebimento + recebido acumulado/saldo no título (como a sincronização deixa). */
export async function addReceipts(prisma: PrismaClient, receipts: SeedReceipt[]): Promise<void> {
  for (const receipt of receipts) {
    await prisma.nomusReceivableReceipt.create({
      data: {
        externalId: receipt.externalId,
        receivableExternalId: receipt.titleExternalId,
        receiptDate: day(receipt.date),
        receivedAmount: receipt.amount,
        rawPayload: { sintetico: true },
        payloadHash: `rec-${receipt.externalId}`,
        syncedAt: new Date(),
      },
    });
    const title = await prisma.nomusAccountsReceivable.findUniqueOrThrow({ where: { externalId: receipt.titleExternalId } });
    const received = money(Number(title.amountReceived ?? 0) + receipt.amount);
    const balance = money(Math.max(0, Number(title.amountReceivable ?? 0) - received));
    await prisma.nomusAccountsReceivable.update({
      where: { externalId: receipt.titleExternalId },
      data: { amountReceived: received, balanceReceivable: balance, status: balance <= 0, settlementDate: balance <= 0 ? day(receipt.date) : null },
    });
  }
}

/** PRNG determinístico (mulberry32) para cenários reproduzíveis. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
