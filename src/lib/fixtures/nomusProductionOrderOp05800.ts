/**
 * Fixture sanitizada — OP real confirmada no Nomus.
 * GET /rest/ordens?query=nome=="OP 05800 - 003"
 * Pedido cruzado: /rest/pedidos/2530 → PD 02534 / item 11324.
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
  empresa: "KOPPETEL",
  idEmpresa: 1,
  setorEstoque: "PRODUCAO",
  dataAbertura: "10/03/2026 08:15:00",
  dataEncerramento: "12/03/2026 17:40:22",
  dataPrevista: "12/03/2026 18:00:00",
  dataAlteracao: "12/03/2026 17:40:22",
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

export const NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED = {
  externalId: 30347,
  name: "OP 05800 - 003",
  quantity: 15400,
  externalSalesOrderId: 2530,
  externalSalesOrderItemId: 11324,
  itemNumber: "00010",
  linkedQuantity: 15000,
} as const;
