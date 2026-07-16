/**
 * Fixture sanitizada — OP real confirmada no Nomus (OP-14.1).
 * GET /rest/ordens?query=nome=="OP 05800 - 003"
 * Pedido cruzado: /rest/pedidos/2530 → PD 02534 / item 11324.
 *
 * Datas oficiais confirmadas em produção (America/Sao_Paulo):
 * - dataHoraCriacao / Liberacao / InicialPlanejada / Entrega / Edicao
 */

import type { JsonObject } from "@/src/lib/nomusProductionOrdersParsers.js";

export const NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE: JsonObject = {
  id: 30347,
  nome: "OP 05800 - 003",
  status: "Encerrada",
  tipo: "Injeção",
  prioridade: "Normal",
  produto: "311.32AA",
  descricaoProduto: "Produto fixture OP 05800",
  informacaoAdicionalProduto: "Info adicional sanitizada",
  quantidade: "15.400",
  unidade: "PC",
  idProduto: 391,
  idConfiguracaoProduto: 12,
  codigoConfiguracaoProduto: "CFG-311",
  /** Formato real observado em produção: código + nome. */
  empresa: "02 - KOPPETEL",
  idEmpresa: 2,
  setorEstoque: "PRODUCAO",
  dataHoraCriacao: "23/06/2026 00:00:00",
  dataHoraLiberacao: "23/06/2026 10:55:11",
  dataHoraInicialPlanejada: "24/06/2026 17:00:00",
  dataHoraEntrega: "08/07/2026 17:00:00",
  dataHoraEdicao: "14/07/2026 00:00:00",
  // Campo desconhecido — parser não deve quebrar.
  campoDesconhecidoNomus: { nested: true, valor: "ok" },
  itensPedido: [
    {
      id: 11324,
      idPedido: 2530,
      item: "00010",
      nomeCliente: "Esmaltec S/A",
      quantidade: "15.000",
    },
  ],
};

/** Conversões UTC esperadas (parede America/Sao_Paulo → Instant). */
export const NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED_DATES = {
  openedAt: "2026-06-23T03:00:00.000Z",
  releasedAt: "2026-06-23T13:55:11.000Z",
  plannedAt: "2026-06-24T20:00:00.000Z",
  deliveryAt: "2026-07-08T20:00:00.000Z",
  nomusUpdatedAt: "2026-07-14T03:00:00.000Z",
  closedAt: null,
} as const;

export const NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED = {
  externalId: 30347,
  name: "OP 05800 - 003",
  quantity: 15400,
  externalSalesOrderId: 2530,
  externalSalesOrderItemId: 11324,
  itemNumber: "00010",
  linkedQuantity: 15000,
  /** Cruzamento documentado: GET /rest/pedidos/2530 */
  salesOrderCode: "PD 02534",
} as const;
