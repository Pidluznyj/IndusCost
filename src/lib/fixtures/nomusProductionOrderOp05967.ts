/**
 * Fixture sanitizada — OP 05967 - 001 (quantidade decimal fina).
 * Usada para garantir preservação de 0,002925 e mapeamento de datas/empresa.
 */

import type { JsonObject } from "@/src/lib/nomusProductionOrdersParsers.js";

export const NOMUS_PRODUCTION_ORDER_OP_05967_FIXTURE: JsonObject = {
  id: 31001,
  nome: "OP 05967 - 001",
  status: "Liberada",
  tipo: "Injeção",
  prioridade: "Normal",
  produto: "999.99XX",
  descricaoProduto: "Produto fixture OP 05967 (decimal)",
  quantidade: "0,002925",
  unidade: "KG",
  idProduto: 9999,
  empresa: "02 - KOPPETEL",
  idEmpresa: 2,
  setorEstoque: "PRODUCAO",
  dataHoraCriacao: "10/07/2026 08:00:00",
  dataHoraLiberacao: "10/07/2026 09:30:00",
  dataHoraInicialPlanejada: "11/07/2026 17:00:00",
  dataHoraEntrega: "20/07/2026 17:00:00",
  dataHoraEdicao: "15/07/2026 12:00:00",
  itensPedido: [],
};

export const NOMUS_PRODUCTION_ORDER_OP_05967_EXPECTED_DATES = {
  openedAt: "2026-07-10T11:00:00.000Z",
  releasedAt: "2026-07-10T12:30:00.000Z",
  plannedAt: "2026-07-11T20:00:00.000Z",
  deliveryAt: "2026-07-20T20:00:00.000Z",
  nomusUpdatedAt: "2026-07-15T15:00:00.000Z",
  closedAt: null,
} as const;

export const NOMUS_PRODUCTION_ORDER_OP_05967_EXPECTED = {
  externalId: 31001,
  name: "OP 05967 - 001",
  quantity: 0.002925,
  companyName: "02 - KOPPETEL",
  externalCompanyId: 2,
} as const;
