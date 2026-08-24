/**
 * Nome de exibição do responsável comercial na Satisfação.
 *
 * O snapshot do convite guarda o contexto da época — mas quando o vendedor
 * ainda não estava mapeado, o CRM gravava o placeholder "Vendedor ID N".
 * A exibição deve seguir o MESMO motor oficial que CRM/Pedidos/Comissões
 * usam (CommissionPerson.nomusPersonId via
 * loadCommissionSellerIdentityContext): assim, quando o mapeamento é feito
 * depois, o nome aparece retroativamente — sem reescrever snapshot.
 *
 * Precedência de exibição:
 *   1. nome resolvido pelo motor oficial (por externalSellerId);
 *   2. snapshot, SE não for placeholder;
 *   3. null (a UI mostra "—").
 */

import type { PrismaClient } from "@prisma/client";
import { loadCommissionSellerIdentityContext } from "../commissions/commissionSellerIdentity.server.js";
import { buildSalesOrderNomusSellerDto } from "../salesOrderNomusSellerDisplay.js";

/** Snapshot que é claramente um placeholder de vendedor não mapeado. */
export function isSellerPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^vendedor(\s+nomus)?(\s+n[aã]o\s+mapeado)?[:\s]*id\s*\d+$/i.test(name.trim());
}

export type SatisfactionResponsibleInput = {
  responsibleCommercialIdSnapshot: number | null;
  responsibleCommercialNameSnapshot: string | null;
};

/**
 * Resolve em LOTE (um contexto para a página inteira — sem N+1) o nome de
 * exibição do responsável comercial de cada linha.
 */
export async function resolveSatisfactionResponsibleNames<
  T extends SatisfactionResponsibleInput,
>(
  prisma: Pick<PrismaClient, "commissionPerson" | "commissionPersonAlias">,
  rows: readonly T[]
): Promise<Map<T, string | null>> {
  const out = new Map<T, string | null>();
  const needsEngine = rows.some((r) => r.responsibleCommercialIdSnapshot != null);

  let ctx: Awaited<ReturnType<typeof loadCommissionSellerIdentityContext>> | null = null;
  if (needsEngine) {
    try {
      ctx = await loadCommissionSellerIdentityContext(prisma);
    } catch {
      // Falha do contexto não pode derrubar a listagem — cai no snapshot.
      ctx = null;
    }
  }

  for (const row of rows) {
    let name: string | null = null;
    if (ctx && row.responsibleCommercialIdSnapshot != null) {
      const dto = buildSalesOrderNomusSellerDto(
        { externalSellerId: row.responsibleCommercialIdSnapshot, issueDate: null },
        ctx
      );
      name = dto.name;
    }
    if (!name) {
      const snapshot = row.responsibleCommercialNameSnapshot;
      name = snapshot && !isSellerPlaceholderName(snapshot) ? snapshot : null;
    }
    out.set(row, name);
  }
  return out;
}
