#!/usr/bin/env tsx
/**
 * PURCH-MIRROR-01 — Probe read-only do endpoint de Pedidos de Compra Nomus.
 *
 * Uso (após configurar NOMUS_BASE_URL/NOMUS_TOKEN reais em .env local — NÃO
 * incluídos neste repositório):
 *
 *   npx tsx scripts/probeNomusPurchaseOrders.ts
 *   npx tsx scripts/probeNomusPurchaseOrders.ts --with-detail
 *
 * Garantias duras (não removível por flag):
 *  - só GET (usa fetchNomusJson, que só expõe GET);
 *  - busca no máximo 1 página pequena (pageSize=5) e, opcionalmente, 1 detail;
 *  - NUNCA escreve no banco — não importa Prisma nem toca models Nomus*;
 *  - NUNCA imprime token/Authorization (usa buildNomusHeaders só
 *    internamente, via fetchNomusJson — nunca logado aqui);
 *  - mascara CNPJ, nomes de pessoa e razão social na saída.
 *
 * Marcado NOT EXECUTED nesta entrega — ver relatório final da missão.
 */

import {
  fetchNomusPurchaseOrdersPage,
  fetchNomusPurchaseOrderDetail,
  resolveNomusPurchaseOrdersListPath,
  resolveNomusPurchaseOrdersDetailPath,
} from "../src/lib/nomus/nomusPurchaseOrdersClient.js";
import { mapNomusPurchaseOrderPayload } from "../src/lib/nomus/nomusPurchaseOrderPayload.js";

function maskDocument(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts
    .map((p, i) => (i === 0 ? `${p.slice(0, 1)}${"*".repeat(Math.max(0, p.length - 1))}` : "***"))
    .join(" ");
}

async function main() {
  const args = process.argv.slice(2);
  const withDetail = args.includes("--with-detail");

  const baseUrl = (process.env.NOMUS_BASE_URL ?? "").trim();
  if (!baseUrl) {
    console.error(
      "[probe] NOMUS_BASE_URL não configurada. Defina em .env local (NUNCA neste script) e rode de novo."
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[probe] endpoint list: ${resolveNomusPurchaseOrdersListPath()}`);
  console.log(`[probe] endpoint detail: ${resolveNomusPurchaseOrdersDetailPath()}/{id}`);
  console.log(`[probe] baseUrl (origin apenas): ${new URL(baseUrl).origin}`);
  console.log("[probe] buscando 1 página pequena (pageSize=5)...");

  const page = await fetchNomusPurchaseOrdersPage({ baseUrl, page: 1, pageSize: 5 });
  console.log(`[probe] pedidos retornados: ${page.rows.length} | hasNext=${page.hasNext}`);

  const mapped = page.rows.map((row) => mapNomusPurchaseOrderPayload(row));
  const masked = mapped.map((m) => ({
    externalId: m.header.externalId,
    code: m.header.code,
    externalSupplierId: m.header.externalSupplierId,
    supplierNameSnapshot: maskName(m.header.supplierNameSnapshot),
    supplierDocumentSnapshot: maskDocument(m.header.supplierDocumentSnapshot),
    buyerNameSnapshot: maskName(m.header.buyerNameSnapshot),
    issueDate: m.header.issueDate?.toISOString().slice(0, 10) ?? null,
    nomusStatusCode: m.header.nomusStatusCode,
    itemsInList: m.items.length,
  }));
  console.log("[probe] amostra (mascarada):");
  console.log(JSON.stringify(masked, null, 2));

  const rawKeysSample = page.rows[0] && typeof page.rows[0] === "object" ? Object.keys(page.rows[0] as object) : [];
  console.log(`[probe] chaves brutas do primeiro registro da lista: ${JSON.stringify(rawKeysSample)}`);

  if (withDetail && mapped[0]?.header.externalId != null) {
    const externalId = mapped[0].header.externalId;
    console.log(`[probe] buscando detail de externalId=${externalId}...`);
    const detailRaw = await fetchNomusPurchaseOrderDetail({ baseUrl, externalId });
    const detailMapped = mapNomusPurchaseOrderPayload(detailRaw);
    console.log(`[probe] detail — itens: ${detailMapped.items.length}`);
    const detailKeys =
      detailRaw && typeof detailRaw === "object" ? Object.keys(detailRaw as object) : [];
    console.log(`[probe] chaves brutas do detail: ${JSON.stringify(detailKeys)}`);
    const itemKeys =
      detailMapped.items[0]?.rawItem && typeof detailMapped.items[0].rawItem === "object"
        ? Object.keys(detailMapped.items[0].rawItem)
        : [];
    console.log(`[probe] chaves brutas de um item: ${JSON.stringify(itemKeys)}`);
  }

  console.log("[probe] OK — nenhuma escrita no banco foi realizada. Somente GET.");
}

main().catch((error) => {
  console.error(`[probe] FALHOU: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
