import type { PrismaClient } from "@prisma/client";
import { normalizeTaxId } from "../../scripts/nomusNumberParser.js";
import { buildNomusUrl, fetchNomusJson, resolveNomusHttpTimeoutMs } from "./nomusRestClient.js";

export type CustomerBridgeEntry = {
  taxId: string | null;
  customerId: string | null;
  conflict?: boolean;
};

export type CustomerResolutionMetrics = {
  requestedExternalCustomerIds: number;
  resolvedFromSalesOrders: number;
  unresolvedAfterSalesOrders: number;
  peopleBatchRequests: number;
  peopleFallbackRequests: number;
  resolvedByTaxId: number;
  conflicts: number;
  unresolvedFinal: number;
};

export type CustomerBridgeResult = {
  bridge: Map<number, CustomerBridgeEntry>;
  metrics: CustomerResolutionMetrics;
};

const customerBridgeMemoryCache = new Map<number, CustomerBridgeEntry>();

export function clearCustomerBridgeMemoryCacheForTests(): void {
  customerBridgeMemoryCache.clear();
}

/**
 * Resolução canônica de Customer Bridge (Nomus externalCustomerId -> IndusCost Customer.id).
 * 
 * ARQUITETURA DE IDENTIDADE:
 * 1. ETAPA 1 (LOCAL / BATCH): Consulta SalesOrder existente por externalCustomerId em lote.
 *    - Se o cliente já possui Pedidos de Venda no IndusCost com o mesmo Customer.id -> resolve localmente (0 HTTP).
 *    - Se o mesmo externalCustomerId estiver associado a múltiplos Customer.id diferentes -> CONFLITO (não escolhe arbitrariamente, marca como unresolved).
 * 2. ETAPA 2 (NOMUS API / BATCH + FALLBACK): Para externalCustomerIds não resolvidos via SalesOrder e sem conflito,
 *    consulta a API Nomus /pessoas em lotes de 50 (query=id=in(...)) para obter CNPJ/CPF.
 *    Em caso de falha do batch, executa fallback seguro por id individual sem abortar o sync.
 * 3. ETAPA 3 (LOCAL / BATCH): Consulta a tabela Customer por taxId (CNPJ/CPF normalizado) em lote.
 * 
 * NUNCA consulta colunas inexistentes no model Customer.
 * NUNCA executa N+1 queries SQL.
 */
export async function resolveNomusCustomerBridge(
  prisma: PrismaClient,
  baseUrl: string,
  externalCustomerIds: number[],
  options?: { logPrefix?: string; maxRetries?: number; retryBaseMs?: number }
): Promise<CustomerBridgeResult> {
  const uniqueIds = [...new Set(externalCustomerIds)].filter((id) => id > 0);
  const bridge = new Map<number, CustomerBridgeEntry>();

  let resolvedFromSalesOrders = 0;
  let peopleBatchRequests = 0;
  let peopleFallbackRequests = 0;
  let conflicts = 0;

  if (uniqueIds.length === 0) {
    return {
      bridge,
      metrics: {
        requestedExternalCustomerIds: 0,
        resolvedFromSalesOrders: 0,
        unresolvedAfterSalesOrders: 0,
        peopleBatchRequests: 0,
        peopleFallbackRequests: 0,
        resolvedByTaxId: 0,
        conflicts: 0,
        unresolvedFinal: 0,
      },
    };
  }

  // 1. Tenta recuperar do cache em memória primeiro
  const missingFromMemory: number[] = [];
  for (const id of uniqueIds) {
    if (customerBridgeMemoryCache.has(id)) {
      const entry = customerBridgeMemoryCache.get(id)!;
      bridge.set(id, entry);
      if (entry.customerId) resolvedFromSalesOrders += 1;
      if (entry.conflict) conflicts += 1;
    } else {
      missingFromMemory.push(id);
    }
  }

  if (missingFromMemory.length > 0) {
    // ETAPA 1 — CACHE LOCAL VIA SALES ORDER EM LOTE (1 Query SQL)
    const salesOrderCustomers = await prisma.salesOrder.findMany({
      where: {
        sourceSystem: "NOMUS",
        externalCustomerId: { in: missingFromMemory },
      },
      select: {
        externalCustomerId: true,
        Customer: {
          select: {
            id: true,
            taxId: true,
          },
        },
      },
    });

    // Detecta se o mesmo externalCustomerId aponta para mais de um Customer.id local
    const customersByExtId = new Map<number, Set<{ id: string; taxId: string | null }>>();
    for (const row of salesOrderCustomers) {
      const extId = row.externalCustomerId;
      if (extId == null || !row.Customer?.id) continue;
      if (!customersByExtId.has(extId)) {
        customersByExtId.set(extId, new Set());
      }
      customersByExtId.get(extId)!.add({ id: row.Customer.id, taxId: row.Customer.taxId });
    }

    for (const extId of missingFromMemory) {
      const customerSet = customersByExtId.get(extId);
      if (!customerSet || customerSet.size === 0) continue;

      const customerArray = [...customerSet];
      // Verifica se todos apontam para o mesmo Customer.id
      const uniqueCustomerIds = new Set(customerArray.map((c) => c.id));

      if (uniqueCustomerIds.size > 1) {
        // CONFLITO DE IDENTIDADE! Múltiplos Customers para o mesmo externalCustomerId
        const entry: CustomerBridgeEntry = {
          taxId: null,
          customerId: null,
          conflict: true,
        };
        bridge.set(extId, entry);
        customerBridgeMemoryCache.set(extId, entry);
        conflicts += 1;
      } else {
        const singleCustomer = customerArray[0]!;
        const entry: CustomerBridgeEntry = {
          customerId: singleCustomer.id,
          taxId: normalizeTaxId(singleCustomer.taxId),
        };
        bridge.set(extId, entry);
        customerBridgeMemoryCache.set(extId, entry);
        resolvedFromSalesOrders += 1;
      }
    }
  }

  const missingIdsFromNomus = uniqueIds.filter(
    (id) => !bridge.has(id) || (!bridge.get(id)?.customerId && !bridge.get(id)?.conflict)
  );
  const unresolvedAfterSalesOrders = missingIdsFromNomus.length;

  // Se todos os clientes foram resolvidos via SalesOrders / cache ou são conflitos, encerra sem chamadas HTTP!
  if (missingIdsFromNomus.length === 0) {
    let resolvedByTaxIdCount = 0;
    let unresolvedFinalCount = 0;
    for (const id of uniqueIds) {
      const entry = bridge.get(id);
      if (entry?.customerId) resolvedByTaxIdCount += 1;
      else unresolvedFinalCount += 1;
    }
    return {
      bridge,
      metrics: {
        requestedExternalCustomerIds: uniqueIds.length,
        resolvedFromSalesOrders,
        unresolvedAfterSalesOrders: 0,
        peopleBatchRequests: 0,
        peopleFallbackRequests: 0,
        resolvedByTaxId: resolvedByTaxIdCount,
        conflicts,
        unresolvedFinal: unresolvedFinalCount,
      },
    };
  }

  // ETAPA 2 — RESOLVER PESSOAS NO NOMUS EM LOTE (para IDs não resolvidos e sem conflito)
  const pessoaTaxIdByNomusId = new Map<number, string | null>();
  const BATCH_SIZE = 50;
  const maxRetries = options?.maxRetries ?? 6;
  const retryBaseMs = options?.retryBaseMs ?? 700;
  const timeoutMs = resolveNomusHttpTimeoutMs();
  const logPrefix = options?.logPrefix ?? "[nomus-customer-bridge]";

  for (let i = 0; i < missingIdsFromNomus.length; i += BATCH_SIZE) {
    const batch = missingIdsFromNomus.slice(i, i + BATCH_SIZE);
    peopleBatchRequests += 1;

    try {
      const url = buildNomusUrl(baseUrl, "pessoas");
      if (batch.length === 1) url.searchParams.set("query", `id==${batch[0]}`);
      else url.searchParams.set("query", `id=in=(${batch.join(",")})`);

      const payload = await fetchNomusJson(url, {
        maxRetries,
        retryBaseMs,
        timeoutMs,
        logPrefix,
      });

      const arr = Array.isArray(payload)
        ? payload
        : (payload as Record<string, unknown>)?.pessoas ??
          (payload as Record<string, unknown>)?.data ??
          (payload as Record<string, unknown>)?.items ??
          [];
      const pessoaList = Array.isArray(arr) ? arr : [];

      for (const p of pessoaList) {
        if (!p || typeof p !== "object") continue;
        const pObj = p as Record<string, unknown>;
        const pId = Number(pObj.id);
        if (Number.isFinite(pId)) {
          const taxId = normalizeTaxId((pObj.cnpj as string) ?? (pObj.cpf as string));
          pessoaTaxIdByNomusId.set(pId, taxId);
        }
      }
    } catch {
      // Fallback seguro em caso de falha do batch com query=id=in(...)
      for (const idCliente of batch) {
        try {
          peopleFallbackRequests += 1;
          const singleUrl = buildNomusUrl(baseUrl, "pessoas");
          singleUrl.searchParams.set("query", `id==${idCliente}`);
          const singlePayload = await fetchNomusJson(singleUrl, {
            maxRetries,
            retryBaseMs,
            timeoutMs,
            logPrefix,
          });
          const arr = Array.isArray(singlePayload)
            ? singlePayload
            : (singlePayload as Record<string, unknown>)?.pessoas ?? [];
          const pObj = (Array.isArray(arr) && arr[0] && typeof arr[0] === "object"
            ? arr[0]
            : singlePayload) as Record<string, unknown>;
          const taxId = normalizeTaxId((pObj?.cnpj as string) ?? (pObj?.cpf as string));
          pessoaTaxIdByNomusId.set(idCliente, taxId);
        } catch {
          pessoaTaxIdByNomusId.set(idCliente, null);
        }
      }
    }
  }

  // ETAPA 3 — CUSTOMER LOCAL POR TAXID (1 Query SQL em lote)
  const fetchedTaxIds = [
    ...new Set([...pessoaTaxIdByNomusId.values()].filter((t): t is string => t != null)),
  ];

  const localCustomersByTax =
    fetchedTaxIds.length === 0
      ? []
      : await prisma.customer.findMany({
          where: { taxId: { in: fetchedTaxIds } },
          select: { id: true, taxId: true },
        });

  const localByTaxIdMap = new Map<string, string>();
  for (const c of localCustomersByTax) {
    const norm = normalizeTaxId(c.taxId);
    if (norm) localByTaxIdMap.set(norm, c.id);
  }

  let resolvedByTaxIdCount = 0;
  let unresolvedFinalCount = 0;

  for (const idCliente of missingIdsFromNomus) {
    const taxId = pessoaTaxIdByNomusId.get(idCliente) ?? null;
    const customerId = taxId ? (localByTaxIdMap.get(taxId) ?? null) : null;
    const entry: CustomerBridgeEntry = { taxId, customerId };
    bridge.set(idCliente, entry);
    customerBridgeMemoryCache.set(idCliente, entry);

    if (customerId) resolvedByTaxIdCount += 1;
    else unresolvedFinalCount += 1;
  }

  return {
    bridge,
    metrics: {
      requestedExternalCustomerIds: uniqueIds.length,
      resolvedFromSalesOrders,
      unresolvedAfterSalesOrders,
      peopleBatchRequests,
      peopleFallbackRequests,
      resolvedByTaxId: resolvedByTaxIdCount,
      conflicts,
      unresolvedFinal: unresolvedFinalCount,
    },
  };
}
