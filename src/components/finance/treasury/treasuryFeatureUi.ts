/**
 * Constantes de UI da Central de Tesouraria.
 * Sem imports de server/Prisma.
 */

export const TREASURY_UI_BASE_PATH = "/finance/treasury" as const;

export const TREASURY_UI_LABEL = "Central de Tesouraria" as const;

export const TREASURY_UI_SECTIONS = [
  {
    id: "home",
    path: TREASURY_UI_BASE_PATH,
    label: "Visão geral",
  },
] as const;
