/**
 * Chaves de acesso da Tesouraria (constantes).
 * Seed/contrato completo fica no prompt de permissões — aqui só o contrato local.
 * Sem Prisma.
 */

export const TREASURY_RESOURCE_KEY = "finance.treasury" as const;

export const TREASURY_ACTIONS = {
  view: "view",
  create: "create",
  update: "update",
  execute: "execute",
  manage: "manage",
  export: "export",
} as const;

export type TreasuryAction = (typeof TREASURY_ACTIONS)[keyof typeof TREASURY_ACTIONS];
