/**
 * Sincroniza o vínculo vendedor-Nomus do AppUser (Admin > Usuários) com o
 * cadastro canônico CommissionPerson.
 *
 * Sem isso, escolher um ID Nomus no login de um vendedor só afeta o escopo
 * de acesso dele (AppUser.externalSellerId) — Propostas, Pedidos de Venda,
 * Comissões e CRM continuam mostrando "Vendedor não mapeado" porque esses
 * módulos resolvem o nome via CommissionPerson.nomusPersonId
 * (resolveNomusOrderSeller em commissionNomusOrderSellerResolver.ts), não via
 * AppUser. Este sync faz o vínculo do login também criar/reativar essa
 * identidade canônica, do mesmo jeito que já existe para vendedores antigos
 * (ex.: GISLENE LIMA / nomusPersonId 464).
 *
 * Cobre apenas o ID Nomus primário (o menor da lista, mesma convenção de
 * resolvePrimaryExternalSellerId em adminUserSellerLink.ts). Um vendedor com
 * múltiplos IDs Nomus vinculados ao login (externalSellerIds) tem só o
 * primário garantido aqui — IDs adicionais exigiriam CommissionPersonAlias
 * com o "source" que os resolvedores de pedido realmente consultam, o que
 * não foi coberto nesta mudança.
 */
import type { PrismaClient } from "@prisma/client";
import { upsertCommissionPersonFromImport } from "./commissionPersonResolution.server.js";

type DbClient = Pick<PrismaClient, "commissionPerson">;

export type CommissionPersonAppUserSyncResult =
  | { action: "created" | "updated" | "reactivated" | "unchanged"; personId: string }
  | {
      action: "skipped";
      reason: "NOT_SELLER_ROLE" | "MISSING_SELLER_ID" | "MISSING_NAME";
    };

export async function syncCommissionPersonFromAppUserSellerLink(
  db: DbClient,
  input: {
    role: string | null | undefined;
    primaryExternalSellerId: number | null;
    sellerResponsibleName: string | null;
  }
): Promise<CommissionPersonAppUserSyncResult> {
  if (input.role !== "SELLER") {
    return { action: "skipped", reason: "NOT_SELLER_ROLE" };
  }
  if (input.primaryExternalSellerId == null || input.primaryExternalSellerId <= 0) {
    return { action: "skipped", reason: "MISSING_SELLER_ID" };
  }
  const name = input.sellerResponsibleName?.trim();
  if (!name) {
    return { action: "skipped", reason: "MISSING_NAME" };
  }

  const result = await upsertCommissionPersonFromImport(db, {
    type: "SELLER",
    nomusPersonId: input.primaryExternalSellerId,
    name,
    source: "NOMUS",
  });
  return { action: result.action, personId: result.personId };
}
