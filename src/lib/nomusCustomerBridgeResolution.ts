import type { PrismaClient } from "@prisma/client";
import { normalizeTaxId } from "../../scripts/nomusNumberParser.js";
import { buildNomusUrl, fetchNomusJson, resolveNomusHttpTimeoutMs } from "./nomusRestClient.js";
import {
  buildCustomerIdentityIndexes,
  decideCustomerIdentity,
  documentDigits,
  type CustomerIdentityIndexes,
  type CustomerIdentityVia,
} from "./nomus/customerIdentityByDocument.js";

export type CustomerBridgeEntry = {
  taxId: string | null;
  customerId: string | null;
  conflict?: boolean;
  /** Evidência que resolveu (ou que gerou o conflito). */
  via?: CustomerIdentityVia;
  /** Clientes equivalentes quando há conflito (nenhum é escolhido). */
  candidateCustomerIds?: string[];
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

// Só entradas RESOLVIDAS ficam em cache: pendência (cliente não cadastrado) ou conflito (duplicidade) precisam ser
// reavaliados na próxima execução, depois que o cadastro for corrigido.
const customerBridgeMemoryCache = new Map<number, CustomerBridgeEntry>();

export function clearCustomerBridgeMemoryCacheForTests(): void {
  customerBridgeMemoryCache.clear();
}

/**
 * Resolução canônica de Customer Bridge (Nomus externalCustomerId -> IndusCost Customer.id), usada pelos syncs de
 * propostas e de pedidos. Regra de identidade única: src/lib/nomus/customerIdentityByDocument.ts.
 *
 * 1. SalesOrder existente por externalCustomerId (em lote): um Customer → resolve; mais de um → conflito.
 * 2. Customer.nomusExternalPersonId (id estável da pessoa no Nomus): resolve, ou desempata um conflito da etapa 1.
 * 3. Pessoa no Nomus /pessoas em lotes de 50 (fallback individual) → CPF/CNPJ comparado por DÍGITOS com todos os
 *    clientes (com ou sem máscara). Mais de um cliente com o mesmo documento → conflito, sem escolher.
 *
 * Clientes são carregados numa única consulta (id, taxId, nomusExternalPersonId) só quando a etapa 1 não resolve
 * tudo; o chamador pode passar `identityIndexes` já montados. Nunca cria cliente. Sem N+1.
 */
export async function resolveNomusCustomerBridge(
  prisma: PrismaClient,
  baseUrl: string,
  externalCustomerIds: number[],
  options?: {
    logPrefix?: string;
    maxRetries?: number;
    retryBaseMs?: number;
    identityIndexes?: CustomerIdentityIndexes;
  }
): Promise<CustomerBridgeResult> {
  const uniqueIds = [...new Set(externalCustomerIds)].filter((id) => id > 0);
  const bridge = new Map<number, CustomerBridgeEntry>();

  let resolvedFromSalesOrders = 0;
  let peopleBatchRequests = 0;
  let peopleFallbackRequests = 0;

  const finalMetrics = (unresolvedAfterSalesOrders: number): CustomerResolutionMetrics => {
    let resolved = 0;
    let unresolvedFinal = 0;
    let conflicts = 0;
    for (const id of uniqueIds) {
      const entry = bridge.get(id);
      if (entry?.customerId) resolved += 1;
      else unresolvedFinal += 1;
      if (entry?.conflict) conflicts += 1;
    }
    return {
      requestedExternalCustomerIds: uniqueIds.length,
      resolvedFromSalesOrders,
      unresolvedAfterSalesOrders,
      peopleBatchRequests,
      peopleFallbackRequests,
      resolvedByTaxId: resolved,
      conflicts,
      unresolvedFinal,
    };
  };

  if (uniqueIds.length === 0) return { bridge, metrics: finalMetrics(0) };

  const missingFromMemory: number[] = [];
  for (const id of uniqueIds) {
    const cached = customerBridgeMemoryCache.get(id);
    if (cached?.customerId) {
      bridge.set(id, cached);
      resolvedFromSalesOrders += 1;
    } else {
      missingFromMemory.push(id);
    }
  }

  // ETAPA 1 — histórico de pedidos (1 query em lote).
  const historyByExtId = new Map<number, Map<string, string | null>>();
  if (missingFromMemory.length > 0) {
    const salesOrderCustomers = await prisma.salesOrder.findMany({
      where: { sourceSystem: "NOMUS", externalCustomerId: { in: missingFromMemory } },
      select: { externalCustomerId: true, Customer: { select: { id: true, taxId: true } } },
    });
    for (const row of salesOrderCustomers) {
      const extId = row.externalCustomerId;
      if (extId == null || !row.Customer?.id) continue;
      const customers = historyByExtId.get(extId) ?? new Map<string, string | null>();
      customers.set(row.Customer.id, row.Customer.taxId);
      historyByExtId.set(extId, customers);
    }
    for (const extId of missingFromMemory) {
      const customers = historyByExtId.get(extId);
      if (customers?.size === 1) {
        const [customerId, taxId] = [...customers.entries()][0]!;
        const entry: CustomerBridgeEntry = { customerId, taxId: normalizeTaxId(taxId), via: "SALES_ORDER_HISTORY" };
        bridge.set(extId, entry);
        customerBridgeMemoryCache.set(extId, entry);
        resolvedFromSalesOrders += 1;
      }
    }
  }

  const pending = uniqueIds.filter((id) => !bridge.has(id));
  const unresolvedAfterSalesOrders = pending.filter((id) => (historyByExtId.get(id)?.size ?? 0) === 0).length;
  if (pending.length === 0) return { bridge, metrics: finalMetrics(0) };

  let indexes = options?.identityIndexes ?? null;
  const loadIndexes = async (): Promise<CustomerIdentityIndexes> => {
    if (!indexes) {
      const rows = await prisma.customer.findMany({ select: { id: true, taxId: true, nomusExternalPersonId: true } });
      indexes = buildCustomerIdentityIndexes(rows);
    }
    return indexes;
  };

  // ETAPA 2 — id estável da pessoa no Nomus (resolve ou desempata conflito do histórico).
  const needsNomusPerson: number[] = [];
  {
    const idx = await loadIndexes();
    for (const extId of pending) {
      const history = historyByExtId.get(extId);
      const decision = decideCustomerIdentity({
        salesOrderHistoryCustomerIds: history ? [...history.keys()] : [],
        personIdCustomerIds: idx.byPersonId.get(extId) ?? [],
      });
      if (decision.status === "RESOLVED") {
        const entry: CustomerBridgeEntry = { customerId: decision.customerId, taxId: null, via: decision.via };
        bridge.set(extId, entry);
        customerBridgeMemoryCache.set(extId, entry);
      } else if (decision.status === "CONFLICT") {
        // Conflito provisório: o documento da pessoa no Nomus ainda pode desempatar DENTRO do conjunto conflitante.
        bridge.set(extId, {
          customerId: null,
          taxId: null,
          conflict: true,
          via: decision.via,
          candidateCustomerIds: decision.candidateCustomerIds,
        });
        needsNomusPerson.push(extId);
      } else {
        needsNomusPerson.push(extId);
      }
    }
  }
  if (needsNomusPerson.length === 0) return { bridge, metrics: finalMetrics(unresolvedAfterSalesOrders) };

  // ETAPA 3 — pessoa no Nomus (lote de 50, fallback individual) → documento por dígitos.
  const pessoaTaxIdByNomusId = new Map<number, string | null>();
  const BATCH_SIZE = 50;
  const maxRetries = options?.maxRetries ?? 6;
  const retryBaseMs = options?.retryBaseMs ?? 700;
  const timeoutMs = resolveNomusHttpTimeoutMs();
  const logPrefix = options?.logPrefix ?? "[nomus-customer-bridge]";
  const pessoaDocument = (pObj: Record<string, unknown> | null | undefined): string | null =>
    normalizeTaxId((pObj?.cnpj as string) ?? (pObj?.cpf as string));

  for (let i = 0; i < needsNomusPerson.length; i += BATCH_SIZE) {
    const batch = needsNomusPerson.slice(i, i + BATCH_SIZE);
    peopleBatchRequests += 1;

    try {
      const url = buildNomusUrl(baseUrl, "pessoas");
      if (batch.length === 1) url.searchParams.set("query", `id==${batch[0]}`);
      else url.searchParams.set("query", `id=in=(${batch.join(",")})`);

      const payload = await fetchNomusJson(url, { maxRetries, retryBaseMs, timeoutMs, logPrefix });
      const arr = Array.isArray(payload)
        ? payload
        : (payload as Record<string, unknown>)?.pessoas ??
          (payload as Record<string, unknown>)?.data ??
          (payload as Record<string, unknown>)?.items ??
          [];
      for (const p of Array.isArray(arr) ? arr : []) {
        if (!p || typeof p !== "object") continue;
        const pObj = p as Record<string, unknown>;
        const pId = Number(pObj.id);
        if (Number.isFinite(pId)) pessoaTaxIdByNomusId.set(pId, pessoaDocument(pObj));
      }
    } catch {
      for (const idCliente of batch) {
        try {
          peopleFallbackRequests += 1;
          const singleUrl = buildNomusUrl(baseUrl, "pessoas");
          singleUrl.searchParams.set("query", `id==${idCliente}`);
          const singlePayload = await fetchNomusJson(singleUrl, { maxRetries, retryBaseMs, timeoutMs, logPrefix });
          const arr = Array.isArray(singlePayload)
            ? singlePayload
            : (singlePayload as Record<string, unknown>)?.pessoas ?? [];
          const pObj = (Array.isArray(arr) && arr[0] && typeof arr[0] === "object"
            ? arr[0]
            : singlePayload) as Record<string, unknown>;
          pessoaTaxIdByNomusId.set(idCliente, pessoaDocument(pObj));
        } catch {
          pessoaTaxIdByNomusId.set(idCliente, null);
        }
      }
    }
  }

  const idx = await loadIndexes();
  for (const idCliente of needsNomusPerson) {
    const taxId = pessoaTaxIdByNomusId.get(idCliente) ?? null;
    const digits = documentDigits(taxId);
    // Cliente já ligado a OUTRA pessoa do Nomus (nomusExternalPersonId diferente) não é esta pessoa: sai da lista.
    const documentCustomerIds = (digits ? (idx.byDocument.get(digits) ?? []) : []).filter((customerId) => {
      const personId = idx.personIdByCustomerId.get(customerId);
      return personId == null || personId === idCliente;
    });
    const history = historyByExtId.get(idCliente);
    const decision = decideCustomerIdentity({
      salesOrderHistoryCustomerIds: history ? [...history.keys()] : [],
      personIdCustomerIds: idx.byPersonId.get(idCliente) ?? [],
      documentCustomerIds,
    });
    if (decision.status === "RESOLVED") {
      const entry: CustomerBridgeEntry = { taxId, customerId: decision.customerId, via: decision.via };
      bridge.set(idCliente, entry);
      customerBridgeMemoryCache.set(idCliente, entry);
    } else if (decision.status === "CONFLICT") {
      bridge.set(idCliente, {
        taxId,
        customerId: null,
        conflict: true,
        via: decision.via,
        candidateCustomerIds: decision.candidateCustomerIds,
      });
    } else {
      bridge.set(idCliente, { taxId, customerId: null });
    }
  }

  return { bridge, metrics: finalMetrics(unresolvedAfterSalesOrders) };
}
