#!/usr/bin/env npx tsx
/**
 * Auditoria read-only de prontidão de dados para o módulo Comissões.
 * Não altera dados.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-readiness.ts
 *   npx tsx scripts/audit-commission-readiness.ts --year=2026
 *   npx tsx scripts/audit-commission-readiness.ts --year=2026 --month=6
 *   npx tsx scripts/audit-commission-readiness.ts --from=2026-01-01 --to=2026-06-30
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  NOMUS_NFE_STATUS_AUTHORIZED,
  NOMUS_NFE_STATUS_CANCELLED,
} from "../src/lib/nomusNfeClassification.ts";

const EXIT_MOVEMENT_TYPES = [
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
] as const;

const MODELS_USED = [
  "SalesOrder (issueDate, externalSellerId, responsible, paymentTerms, paymentMethod, totalNetValue, nomusRawResponse, status, orderCode)",
  "SalesOrderNfeLink (salesOrderId, nfeExternalId, nfeNumber, nfeStatus)",
  "NomusNfe (externalId, status, numero, dataProcessamento, valorLiquido, xmlVNF)",
  "NomusAccountsReceivable (sourceInvoiceId, sourceInvoiceNumber, amountReceivable, amountReceived, balanceReceivable, settlementDate, dueDate)",
  "InventoryMovement (movementType, nfeId, nfeNumber, salesOrderId, documentNumber) — proxy local de Documento de Saída",
  "AppUser (externalSellerId, sellerResponsibleName) — referência de vendedores",
  "CrmCustomerCommercialOwner (sellerExternalId, sellerResponsibleName) — responsável comercial manual",
];

const REPRESENTATIVE_RAW_KEYS = [
  "idPessoaRepresentante",
  "idRepresentante",
  "nomeRepresentante",
  "representante",
  "nomePessoaRepresentante",
] as const;

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function parseDateRange(): { from: Date; to: Date; label: string } {
  const fromArg = parseArg("from");
  const toArg = parseArg("to");
  const yearArg = parseArg("year");
  const monthArg = parseArg("month");

  if (fromArg && toArg) {
    const from = new Date(`${fromArg}T00:00:00`);
    const to = new Date(`${toArg}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("Datas inválidas em --from ou --to. Use YYYY-MM-DD.");
    }
    return { from, to, label: `${fromArg} a ${toArg}` };
  }

  const year = yearArg ? Number(yearArg) : 2026;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("Ano inválido em --year.");
  }

  if (monthArg) {
    const month = Number(monthArg);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      throw new Error("Mês inválido em --month (1-12).");
    }
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    const mm = String(month).padStart(2, "0");
    return { from, to, label: `${mm}/${year}` };
  }

  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  return { from, to, label: `ano ${year}` };
}

function fmtBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fmtPct(part: number, total: number): string {
  if (total <= 0) return "0,0%";
  return `${((part / total) * 100).toFixed(1).replace(".", ",")}%`;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasSeller(order: { externalSellerId: number | null; responsible: string | null }): boolean {
  return order.externalSellerId != null || Boolean(order.responsible?.trim());
}

function extractRepresentativeFromRaw(raw: unknown): { id: number | null; name: string | null } {
  if (!raw || typeof raw !== "object") return { id: null, name: null };
  const obj = raw as Record<string, unknown>;

  let id: number | null = null;
  for (const key of ["idPessoaRepresentante", "idRepresentante"] as const) {
    const v = obj[key];
    if (v != null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) {
        id = n;
        break;
      }
    }
  }

  let name: string | null = null;
  for (const key of ["nomeRepresentante", "nomePessoaRepresentante"] as const) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      name = v.trim();
      break;
    }
  }

  const repObj = obj.representante;
  if (repObj && typeof repObj === "object") {
    const rep = repObj as Record<string, unknown>;
    if (id == null) {
      const rid = Number(rep.id ?? rep.idPessoa);
      if (Number.isFinite(rid) && rid > 0) id = rid;
    }
    if (!name) {
      const rname = rep.nome ?? rep.nomePessoa ?? rep.nomeRepresentante;
      if (typeof rname === "string" && rname.trim()) name = rname.trim();
    }
  }

  return { id, name };
}

function hasRepresentative(order: {
  nomusRawResponse: unknown;
}): boolean {
  const fromRaw = extractRepresentativeFromRaw(order.nomusRawResponse);
  return fromRaw.id != null || Boolean(fromRaw.name);
}

type InconsistencySample = {
  tipo: string;
  pedido?: string;
  nfeExternalId?: number;
  detalhe: string;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL não configurada. Configure .env ou variável de ambiente antes de executar a auditoria."
    );
  }

  const range = parseDateRange();

  console.log("=== Auditoria de prontidão — Módulo Comissões ===");
  console.log(`Período: ${range.label}`);
  console.log(`De: ${range.from.toISOString()}  Até: ${range.to.toISOString()}`);
  console.log("Modo: read-only (sem alterações no banco)\n");

  console.log("--- Modelos e campos consultados ---");
  for (const line of MODELS_USED) {
    console.log(`  • ${line}`);
  }
  console.log(
    "\n  Observação: não existe model Prisma de Representante/Comissionado; representante é inferido de SalesOrder.nomusRawResponse quando presente."
  );
  console.log(
    "  Observação: Documento de Saída Nomus não está sincronizado; proxy = InventoryMovement (saída) com nfeId/nfeNumber.\n"
  );

  const orders = await prisma.salesOrder.findMany({
    where: {
      issueDate: { gte: range.from, lte: range.to },
    },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      status: true,
      externalSellerId: true,
      responsible: true,
      paymentTerms: true,
      paymentMethod: true,
      totalNetValue: true,
      nomusRawResponse: true,
      nfeLinks: {
        select: {
          nfeExternalId: true,
          nfeNumber: true,
          nfeStatus: true,
        },
      },
    },
    orderBy: { issueDate: "asc" },
  });

  const totalOrders = orders.length;
  const withSeller = orders.filter(hasSeller);
  const withoutSeller = orders.filter((o) => !hasSeller(o));
  const withRepresentative = orders.filter(hasRepresentative);
  const withoutRepresentative = orders.filter((o) => !hasRepresentative(o));
  const withNfeLink = orders.filter((o) => o.nfeLinks.length > 0);
  const withoutNfeLink = orders.filter((o) => o.nfeLinks.length === 0);

  const allNfeExternalIds = [...new Set(orders.flatMap((o) => o.nfeLinks.map((l) => l.nfeExternalId)))];

  const nomusNfes =
    allNfeExternalIds.length > 0
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: allNfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            status: true,
            numero: true,
            dataProcessamento: true,
            valorLiquido: true,
            xmlVNF: true,
          },
        })
      : [];

  const nfeByExternalId = new Map(nomusNfes.map((n) => [n.externalId, n]));

  const authorizedNfes = nomusNfes.filter((n) => n.status === NOMUS_NFE_STATUS_AUTHORIZED);
  const cancelledNfes = nomusNfes.filter((n) => n.status === NOMUS_NFE_STATUS_CANCELLED);
  const otherStatusNfes = nomusNfes.filter(
    (n) => n.status !== NOMUS_NFE_STATUS_AUTHORIZED && n.status !== NOMUS_NFE_STATUS_CANCELLED
  );

  const arTitles =
    allNfeExternalIds.length > 0
      ? await prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: { in: allNfeExternalIds } },
          select: {
            externalId: true,
            sourceInvoiceId: true,
            sourceInvoiceNumber: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            settlementDate: true,
            dueDate: true,
            personName: true,
          },
        })
      : [];

  const arByNfeId = new Map<number, typeof arTitles>();
  for (const ar of arTitles) {
    if (ar.sourceInvoiceId == null) continue;
    const list = arByNfeId.get(ar.sourceInvoiceId) ?? [];
    list.push(ar);
    arByNfeId.set(ar.sourceInvoiceId, list);
  }

  const nfeIdsWithAr = new Set(arTitles.map((a) => a.sourceInvoiceId).filter((id): id is number => id != null));

  const nomusNfeUuidByExternalId = new Map(nomusNfes.map((n) => [n.externalId, n.id]));
  const nomusNfeNumeroByExternalId = new Map(
    nomusNfes.map((n) => [n.externalId, n.numero?.trim() || null])
  );

  const inventoryExits =
    allNfeExternalIds.length > 0
      ? await prisma.inventoryMovement.findMany({
          where: {
            movementType: { in: [...EXIT_MOVEMENT_TYPES] },
            OR: [
              { nfeNumber: { in: nomusNfes.map((n) => n.numero).filter(Boolean) as string[] } },
              { nfeId: { in: nomusNfes.map((n) => n.id) } },
              { nfeId: { in: allNfeExternalIds.map(String) } },
            ],
          },
          select: {
            id: true,
            movementType: true,
            nfeId: true,
            nfeNumber: true,
            documentNumber: true,
            salesOrderId: true,
            movementDate: true,
          },
        })
      : [];

  const nfeExternalIdsWithExit = new Set<number>();
  for (const extId of allNfeExternalIds) {
    const uuid = nomusNfeUuidByExternalId.get(extId);
    const numero = nomusNfeNumeroByExternalId.get(extId);
    const hasExit = inventoryExits.some(
      (m) =>
        m.nfeId === uuid ||
        m.nfeId === String(extId) ||
        (numero != null && m.nfeNumber === numero)
    );
    if (hasExit) nfeExternalIdsWithExit.add(extId);
  }

  const totalNetValue = orders.reduce((s, o) => s + toNumber(o.totalNetValue), 0);
  const totalWithSellerValue = withSeller.reduce((s, o) => s + toNumber(o.totalNetValue), 0);

  console.log("--- Resumo de Pedidos de Venda ---");
  console.log(`Total de pedidos no período: ${totalOrders}`);
  console.log(`Valor líquido total (totalNetValue): ${fmtBrl(totalNetValue)}`);
  console.log(`Pedidos com vendedor (externalSellerId ou responsible): ${withSeller.length} (${fmtPct(withSeller.length, totalOrders)})`);
  console.log(`  Valor líquido com vendedor: ${fmtBrl(totalWithSellerValue)}`);
  console.log(`Pedidos sem vendedor: ${withoutSeller.length} (${fmtPct(withoutSeller.length, totalOrders)})`);
  console.log(
    `Pedidos com representante (nomusRawResponse): ${withRepresentative.length} (${fmtPct(withRepresentative.length, totalOrders)})`
  );
  console.log(
    `Pedidos sem representante: ${withoutRepresentative.length} (${fmtPct(withoutRepresentative.length, totalOrders)})`
  );
  console.log(`Pedidos com NF-e vinculada (SalesOrderNfeLink): ${withNfeLink.length} (${fmtPct(withNfeLink.length, totalOrders)})`);
  console.log(`Pedidos sem NF-e vinculada: ${withoutNfeLink.length} (${fmtPct(withoutNfeLink.length, totalOrders)})`);

  console.log("\n--- NF-e (NomusNfe) vinculadas aos pedidos do período ---");
  console.log(`NF-e distintas nos vínculos: ${allNfeExternalIds.length}`);
  console.log(`NF-e encontradas em NomusNfe: ${nomusNfes.length}`);
  console.log(`NF-e autorizadas (status=${NOMUS_NFE_STATUS_AUTHORIZED}): ${authorizedNfes.length}`);
  console.log(`NF-e canceladas (status=${NOMUS_NFE_STATUS_CANCELLED}): ${cancelledNfes.length}`);
  console.log(`NF-e com outro status: ${otherStatusNfes.length}`);

  console.log("\n--- Documento de Saída (proxy InventoryMovement) ---");
  console.log(`NF-e com movimento de saída vinculado: ${nfeExternalIdsWithExit.size} de ${allNfeExternalIds.length}`);
  console.log(`Movimentos de saída encontrados: ${inventoryExits.length}`);
  if (allNfeExternalIds.length > 0 && inventoryExits.length === 0) {
    console.log(
      "  ⚠ Nenhum movimento de estoque com nfeId/nfeNumber — Documento de Saída Nomus não está no banco local."
    );
  }

  console.log("\n--- Contas a Receber (NomusAccountsReceivable) ---");
  console.log(`Títulos AR com sourceInvoiceId (idNfe) no conjunto: ${arTitles.length}`);
  console.log(`NF-e distintas com ao menos 1 título AR: ${nfeIdsWithAr.size} de ${allNfeExternalIds.length}`);
  const arTotalReceivable = arTitles.reduce((s, a) => s + toNumber(a.amountReceivable), 0);
  const arTotalReceived = arTitles.reduce((s, a) => s + toNumber(a.amountReceived), 0);
  const arTotalBalance = arTitles.reduce((s, a) => s + toNumber(a.balanceReceivable), 0);
  console.log(`Soma valorReceber (amountReceivable): ${fmtBrl(arTotalReceivable)}`);
  console.log(`Soma valorRecebido (amountReceived): ${fmtBrl(arTotalReceived)}`);
  console.log(`Soma saldoReceber (balanceReceivable): ${fmtBrl(arTotalBalance)}`);

  const inconsistencies: InconsistencySample[] = [];

  for (const order of orders) {
    if (!hasSeller(order)) {
      if (inconsistencies.filter((i) => i.tipo === "PEDIDO_SEM_VENDEDOR").length < 5) {
        inconsistencies.push({
          tipo: "PEDIDO_SEM_VENDEDOR",
          pedido: order.orderCode,
          detalhe: `Status ${order.status}, valor ${fmtBrl(toNumber(order.totalNetValue))}, emissão ${order.issueDate.toISOString().slice(0, 10)}`,
        });
      }
    }

    for (const link of order.nfeLinks) {
      const nfe = nfeByExternalId.get(link.nfeExternalId);
      if (!nfe) {
        if (inconsistencies.filter((i) => i.tipo === "NFE_LINK_SEM_NOMUSNFE").length < 5) {
          inconsistencies.push({
            tipo: "NFE_LINK_SEM_NOMUSNFE",
            pedido: order.orderCode,
            nfeExternalId: link.nfeExternalId,
            detalhe: `SalesOrderNfeLink aponta externalId=${link.nfeExternalId}, mas NomusNfe não existe localmente.`,
          });
        }
        continue;
      }

      if (nfe.status === NOMUS_NFE_STATUS_CANCELLED) {
        if (inconsistencies.filter((i) => i.tipo === "NFE_CANCELADA_VINCULADA").length < 5) {
          inconsistencies.push({
            tipo: "NFE_CANCELADA_VINCULADA",
            pedido: order.orderCode,
            nfeExternalId: link.nfeExternalId,
            detalhe: `NF-e ${nfe.numero ?? link.nfeExternalId} cancelada (status 7) ainda vinculada ao pedido.`,
          });
        }
      }

      const arForNfe = arByNfeId.get(link.nfeExternalId) ?? [];
      if (arForNfe.length === 0 && nfe.status === NOMUS_NFE_STATUS_AUTHORIZED) {
        if (inconsistencies.filter((i) => i.tipo === "NFE_AUTORIZADA_SEM_AR").length < 5) {
          inconsistencies.push({
            tipo: "NFE_AUTORIZADA_SEM_AR",
            pedido: order.orderCode,
            nfeExternalId: link.nfeExternalId,
            detalhe: `NF-e autorizada sem títulos em NomusAccountsReceivable (sourceInvoiceId).`,
          });
        }
      }

      if (!nfeExternalIdsWithExit.has(link.nfeExternalId) && nfe.status === NOMUS_NFE_STATUS_AUTHORIZED) {
        if (inconsistencies.filter((i) => i.tipo === "NFE_SEM_DOC_SAIDA").length < 5) {
          inconsistencies.push({
            tipo: "NFE_SEM_DOC_SAIDA",
            pedido: order.orderCode,
            nfeExternalId: link.nfeExternalId,
            detalhe: `NF-e autorizada sem InventoryMovement de saída vinculado (proxy Documento de Saída).`,
          });
        }
      }
    }

    if (order.nfeLinks.length === 0 && toNumber(order.totalNetValue) > 0 && order.status !== "CANCELLED") {
      if (inconsistencies.filter((i) => i.tipo === "PEDIDO_ATIVO_SEM_NFE").length < 5) {
        inconsistencies.push({
          tipo: "PEDIDO_ATIVO_SEM_NFE",
          pedido: order.orderCode,
          detalhe: `Pedido não cancelado, valor ${fmtBrl(toNumber(order.totalNetValue))}, sem SalesOrderNfeLink.`,
        });
      }
    }
  }

  for (const ar of arTitles) {
    if (ar.sourceInvoiceId != null && !allNfeExternalIds.includes(ar.sourceInvoiceId)) {
      if (inconsistencies.filter((i) => i.tipo === "AR_ORFAO_PEDIDO_PERIODO").length < 3) {
        inconsistencies.push({
          tipo: "AR_ORFAO_PEDIDO_PERIODO",
          nfeExternalId: ar.sourceInvoiceId,
          detalhe: `Título AR externalId=${ar.externalId} com idNfe=${ar.sourceInvoiceId} sem pedido do período vinculado.`,
        });
      }
    }
  }

  console.log("\n--- Amostras de inconsistências (até 5 por tipo) ---");
  if (inconsistencies.length === 0) {
    console.log("Nenhuma inconsistência amostrada no recorte.");
  } else {
    const byType = new Map<string, InconsistencySample[]>();
    for (const item of inconsistencies) {
      const list = byType.get(item.tipo) ?? [];
      list.push(item);
      byType.set(item.tipo, list);
    }
    for (const [tipo, items] of byType) {
      console.log(`\n[${tipo}]`);
      for (const item of items) {
        const parts = [
          item.pedido ? `pedido=${item.pedido}` : null,
          item.nfeExternalId != null ? `nfeExternalId=${item.nfeExternalId}` : null,
          item.detalhe,
        ].filter(Boolean);
        console.log(`  • ${parts.join(" | ")}`);
      }
    }
  }

  const repKeyPresence = new Map<string, number>();
  for (const order of orders) {
    if (!order.nomusRawResponse || typeof order.nomusRawResponse !== "object") continue;
    const raw = order.nomusRawResponse as Record<string, unknown>;
    for (const key of REPRESENTATIVE_RAW_KEYS) {
      if (raw[key] != null && raw[key] !== "") {
        repKeyPresence.set(key, (repKeyPresence.get(key) ?? 0) + 1);
      }
    }
  }

  if (repKeyPresence.size > 0) {
    console.log("\n--- Chaves de representante encontradas em nomusRawResponse ---");
    for (const [key, count] of repKeyPresence) {
      console.log(`  • ${key}: ${count} pedido(s)`);
    }
  } else {
    console.log(
      "\n--- Representante ---\n  Nenhuma chave conhecida (${REPRESENTATIVE_RAW_KEYS.join(", ")}) encontrada em nomusRawResponse no período."
    );
  }

  const [sellerUsers, manualOwners] = await Promise.all([
    prisma.appUser.count({
      where: {
        isActive: true,
        OR: [{ externalSellerId: { not: null } }, { sellerResponsibleName: { not: null } }],
      },
    }),
    prisma.crmCustomerCommercialOwner.count({ where: { isActive: true } }),
  ]);

  console.log("\n--- Referência de pessoas comissionáveis ---");
  console.log(`AppUser ativos com vínculo de vendedor: ${sellerUsers}`);
  console.log(`CrmCustomerCommercialOwner ativos (responsável manual): ${manualOwners}`);
  console.log("Model dedicado de Comissionado/Representante: inexistente no schema atual.");

  console.log("\n=== Fim da auditoria ===");
}

main()
  .catch((err) => {
    console.error("Erro na auditoria:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
