/**
 * Raw Nomus sanitizado do PD 02130 — estrutura real do servidor (debug 2026-06).
 * Status do item apenas como código numérico: itensPedido[].status = 6 (Cancelado).
 * Sem situacaoItemPedido, produto.codigo ou quantidadeCancelada no sync real.
 */
export const PD_02130_SANITIZED_NOMUS_RAW = {
  codigoPedido: "PD 02130",
  idPedido: 2130,
  dataEmissao: "23/01/2026",
  dataPrevisaoEntrega: "23/01/2026",
  itensPedido: [
    {
      id: 9600,
      item: "00010",
      status: 6,
      idProduto: 253,
      quantidade: "4",
      dataEntrega: "23/01/2026 00:00:00",
      valorUnitario: "90",
    },
  ],
  nfes: [],
} as const;

export const PD_02130_SANITIZED_DB_ITEM = {
  id: "item-pd-02130",
  externalProductId: 253,
  skuSnapshot: "630.01AA",
  productNameSnapshot: "Filtro de Água Aqua Vitae CRISTAL",
  quantity: 4,
} as const;

export const PD_02130_SANITIZED_ORDER = {
  id: "so-pd-02130",
  orderCode: "PD 02130",
  status: "SENT_TO_NOMUS",
  issueDate: new Date(2026, 0, 23),
  expectedDeliveryDate: new Date(2026, 0, 23),
  totalNetValue: 360,
  responsible: "Vendedor",
  companyIssuer: "Empresa",
  nomusRawResponse: PD_02130_SANITIZED_NOMUS_RAW,
  Customer: { companyName: "Cliente Sanitizado", tradeName: null, taxId: null },
  items: [PD_02130_SANITIZED_DB_ITEM],
} as const;

/** Raw com objeto aninhado (formato alternativo observado em outros ambientes). */
export const PD_02130_NESTED_STATUS_NOMUS_RAW = {
  itensPedido: [
    {
      item: "00010",
      idProduto: 184726,
      produto: {
        id: 184726,
        codigo: "630.01AA",
        descricao: "Filtro de Água Aqua Vitae CRISTAL",
      },
      quantidade: 1,
      quantidadeCancelada: 1,
      situacaoItemPedido: {
        id: 9,
        descricao: "Cancelado",
        nome: "Cancelado",
      },
    },
  ],
  nfes: [],
} as const;
