/**
 * Constantes de UI da Central de Tesouraria.
 * Sem imports de server/Prisma — só contratos client-safe.
 *
 * Navegação padrão: TREASURY_UI_PRIMARY_SECTIONS (Hoje / Contas / Conferir banco / Próximos dias).
 * Catálogo avançado preservado: TREASURY_UI_ADVANCED_SECTIONS.
 */

import {
  TREASURY_MODULE_LABEL,
  TREASURY_PROJECTION_LAYERS,
} from "../../../lib/treasury/contracts/treasuryContracts.js";
import {
  TREASURY_UI_ADVANCED_HUB_PATH,
  TREASURY_UI_ADVANCED_SECTIONS,
  TREASURY_UI_PRIMARY_SECTIONS,
  TREASURY_SIMPLE_UI_BASE_PATH,
} from "../../../lib/treasury/treasurySimpleNavigation.js";

export const TREASURY_UI_BASE_PATH = TREASURY_SIMPLE_UI_BASE_PATH;

export const TREASURY_UI_LABEL = TREASURY_MODULE_LABEL;

/** Camadas de projeção expostas na UI (contrato compartilhado). */
export const TREASURY_UI_PROJECTION_LAYERS = TREASURY_PROJECTION_LAYERS;

export {
  TREASURY_UI_PRIMARY_SECTIONS,
  TREASURY_UI_ADVANCED_SECTIONS,
  TREASURY_UI_ADVANCED_HUB_PATH,
};

/**
 * Catálogo completo de seções (primárias + avançadas + aliases de deep-link).
 * Usado por rollout/landing/caracterização — não é a barra principal.
 */
export const TREASURY_UI_SECTIONS = [
  {
    id: "home",
    path: TREASURY_UI_BASE_PATH,
    label: "Hoje",
  },
  ...TREASURY_UI_PRIMARY_SECTIONS,
  ...TREASURY_UI_ADVANCED_SECTIONS,
  {
    id: "advanced",
    path: TREASURY_UI_ADVANCED_HUB_PATH,
    label: "Recursos avançados",
  },
] as const;
