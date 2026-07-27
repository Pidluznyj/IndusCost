/**
 * Constantes de UI da Central de Tesouraria.
 * Sem imports de server/Prisma — só contratos client-safe.
 */

import {
  TREASURY_MODULE_LABEL,
  TREASURY_PROJECTION_LAYERS,
} from "../../../lib/treasury/contracts/treasuryContracts.js";

export const TREASURY_UI_BASE_PATH = "/finance/treasury" as const;

export const TREASURY_UI_LABEL = TREASURY_MODULE_LABEL;

/** Camadas de projeção expostas na UI (contrato compartilhado). */
export const TREASURY_UI_PROJECTION_LAYERS = TREASURY_PROJECTION_LAYERS;

export const TREASURY_UI_SECTIONS = [
  {
    id: "home",
    path: TREASURY_UI_BASE_PATH,
    label: "Visão geral",
  },
  {
    id: "accounts",
    path: `${TREASURY_UI_BASE_PATH}/accounts`,
    label: "Contas financeiras",
  },
  {
    id: "receivables",
    path: `${TREASURY_UI_BASE_PATH}/receivables`,
    label: "Contas a receber",
  },
  {
    id: "payables",
    path: `${TREASURY_UI_BASE_PATH}/payables`,
    label: "Contas a pagar",
  },
  {
    id: "agenda",
    path: `${TREASURY_UI_BASE_PATH}/agenda`,
    label: "Agenda financeira",
  },
  {
    id: "projections",
    path: `${TREASURY_UI_BASE_PATH}/projections`,
    label: "Comparação de cenários",
  },
  {
    id: "transfers",
    path: `${TREASURY_UI_BASE_PATH}/transfers`,
    label: "Transferências",
  },
  {
    id: "bank-movements",
    path: `${TREASURY_UI_BASE_PATH}/bank-movements`,
    label: "Movimentos bancários",
  },
  {
    id: "exceptions",
    path: `${TREASURY_UI_BASE_PATH}/exceptions`,
    label: "Exceções",
  },
  {
    id: "closing",
    path: `${TREASURY_UI_BASE_PATH}/closing`,
    label: "Fechamento diário",
  },
  {
    id: "reports",
    path: `${TREASURY_UI_BASE_PATH}/reports`,
    label: "Relatórios",
  },
] as const;
