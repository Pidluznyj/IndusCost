/**
 * Resolver batch de Responsável Comercial por cliente.
 *
 * Regra oficial (docs/commercial/crm-commercial-official-rules.md):
 *   - Responsável Comercial VEM DO CADASTRO/CARTEIRA DO CLIENTE
 *     (CrmCustomerCommercialOwner), não do pedido.
 *   - NÃO pode ser resolvido via include/select dentro de `salesOrder.findMany`
 *     (Prisma Client pode não conhecer a relação em ambientes fora de sync).
 *   - NÃO é vendedor do pedido Nomus (SalesOrder.nomusSellerName / externalSellerId).
 *   - NÃO pode retornar rótulos administrativos (FINANCEIRO / FATURAMENTO / SETOR).
 *
 * Uso canônico:
 *   1. Buscar SalesOrder normalmente (sem include de CrmCustomerCommercialOwner).
 *   2. Coletar `customerId` dos pedidos.
 *   3. Chamar `resolveCommercialResponsibleMap(prisma, customerIds)`.
 *   4. Injetar o resultado no shape esperado pelos consumidores (`order.Customer.CrmCustomerCommercialOwner`).
 */

import type { PrismaClient } from "@prisma/client";
import { loadManualCommercialOwnersForCustomers } from "@/src/lib/crmCustomerCommercialOwner.js";
import type { ResolvedCustomerCommercialOwner } from "@/src/lib/crmCustomerCommercialOwnerTypes.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { isSellerIdOnlyLabel } from "@/src/lib/commercial/orderSellerIdentityResolver.js";

/**
 * Rótulos administrativos/setores que NUNCA podem aparecer como Responsável
 * Comercial. Se o cliente tem um "responsável" cujo nome canônico bate com
 * um desses padrões, o resolver retorna `null` — a UI mostra "Sem responsável"
 * e o usuário precisa cadastrar um vendedor real.
 */
export const FORBIDDEN_COMMERCIAL_RESPONSIBLE_NAME_HINTS = [
  "FINANCEIRO",
  "FATURAMENTO",
  "SETOR",
  "COBRANCA",
  "COBRANÇA",
] as const;

/**
 * `true` se o nome fornecido indica um setor administrativo (não um vendedor).
 * A comparação é feita sobre o `normalizeSellerIdentityName` (sem acento,
 * maiúsculo, sem pontuação) para pegar variações de digitação.
 */
export function isForbiddenCommercialResponsibleName(
  name: string | null | undefined
): boolean {
  if (!name) return false;
  if (isSellerIdOnlyLabel(name)) return true;
  const canonical = normalizeSellerIdentityName(name);
  if (!canonical) return false;
  return FORBIDDEN_COMMERCIAL_RESPONSIBLE_NAME_HINTS.some((hint) =>
    canonical.includes(normalizeSellerIdentityName(hint))
  );
}

/**
 * Shape mínimo consumido por `crmSalesOrderMetricsService` para preencher
 * `order.Customer.CrmCustomerCommercialOwner`. É o subset do model Prisma
 * usado pelo motor de métricas.
 */
export type CommercialResponsibleInjection = {
  sellerCanonicalName: string | null;
  sellerResponsibleName: string | null;
  sellerIdentityKey: string | null;
  sellerExternalId: number | null;
  isActive: boolean;
} | null;

function resolvedOwnerToInjection(
  owner: ResolvedCustomerCommercialOwner | undefined | null
): CommercialResponsibleInjection {
  if (!owner) return null;
  if (owner.source === "NONE") return null;

  const canonical = owner.sellerCanonicalName?.trim() ?? null;
  const responsible = owner.sellerResponsibleName?.trim() ?? null;

  // Guard: nunca retornar FINANCEIRO/FATURAMENTO como responsável comercial.
  if (
    isForbiddenCommercialResponsibleName(canonical) ||
    isForbiddenCommercialResponsibleName(responsible)
  ) {
    return null;
  }

  return {
    sellerCanonicalName: canonical,
    sellerResponsibleName: responsible,
    sellerIdentityKey: owner.sellerIdentityKey,
    sellerExternalId: owner.sellerExternalId,
    isActive: true,
  };
}

/**
 * Resultado do resolver: mapa `customerId → injection` (ou `null` quando o
 * cliente não tem responsável válido). IDs sem entrada no mapa também
 * significam "sem responsável" — o consumidor deve tratar ambos os casos igual.
 */
export type CommercialResponsibleMap = Map<string, CommercialResponsibleInjection>;

/**
 * Busca em BATCH os responsáveis comerciais para um conjunto de `customerId`s.
 *
 * - Consulta APENAS `CrmCustomerCommercialOwner` (nunca `SalesOrder`).
 * - Retorna vazio se `customerIds` está vazio (não faz round-trip).
 * - Se o resolver `loadManualCommercialOwnersForCustomers` falhar (ex.: banco
 *   inacessível durante degradação), captura o erro e retorna map vazio — o
 *   dashboard mostra "Sem responsável" em vez de derrubar tudo com 500.
 */
export async function resolveCommercialResponsibleMap(
  prisma: PrismaClient,
  customerIds: readonly string[]
): Promise<CommercialResponsibleMap> {
  const uniqueIds = Array.from(
    new Set(customerIds.filter((id): id is string => typeof id === "string" && id.length > 0))
  );
  if (uniqueIds.length === 0) return new Map();

  try {
    const manualMap = await loadManualCommercialOwnersForCustomers(uniqueIds);
    const out: CommercialResponsibleMap = new Map();
    for (const customerId of uniqueIds) {
      const owner = manualMap.get(customerId) ?? null;
      out.set(customerId, resolvedOwnerToInjection(owner));
    }
    return out;
  } catch (err) {
    // Falha de resolver não pode derrubar o dashboard. Loga e devolve vazio —
    // é preferível mostrar "Sem responsável" a mostrar 500.
    // eslint-disable-next-line no-console
    console.warn(
      "[crmCommercialResponsibleResolver] Falha ao resolver responsáveis comerciais em batch. Continuando com map vazio.",
      err instanceof Error ? { message: err.message } : { err }
    );
    // Prisma client desatualizado ou model ausente cai aqui.
    void prisma; // parâmetro reservado para futura injeção de client alternativo
    return new Map();
  }
}
