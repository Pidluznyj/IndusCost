/**
 * Raw Nomus sanitizado do PD 02130 (estrutura real observada no sync).
 * Status do item em objeto aninhado + código do produto em produto.codigo.
 * Sem dados sensíveis de cliente.
 */
export const PD_02130_SANITIZED_NOMUS_RAW = {
  codigoPedido: "PD 02130",
  idPedido: 2130,
  dataEmissao: "23/01/2026",
  dataPrevisaoEntrega: "23/01/2026",
  observacoes: null,
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
      valorUnitario: 360,
      valorTotal: 360,
      quantidadeCancelada: 1,
      quantidadeAtendida: 0,
      quantidadeFaturada: 0,
      situacaoItemPedido: {
        id: 9,
        descricao: "Cancelado",
        nome: "Cancelado",
      },
    },
  ],
  nfes: [],
} as const;

export const PD_02130_SANITIZED_DB_ITEM = {
  id: "item-pd-02130",
  externalProductId: 184726,
  skuSnapshot: "630.01AA",
  productNameSnapshot: "Filtro de Água Aqua Vitae CRISTAL",
  quantity: 1,
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
