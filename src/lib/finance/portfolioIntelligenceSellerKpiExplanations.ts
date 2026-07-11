/** Explicações leigas dos KPIs por vendedor (não usam comissões). */
export type SellerKpiExplanation = {
  whatItMeans: string;
  howWeCalculate: string;
  whatIsIncluded: string;
  whatIsExcluded: string;
  howToInterpret: string;
};

export const SELLER_KPI_EXPLANATIONS: Record<string, SellerKpiExplanation> = {
  sellerName: {
    whatItMeans: "Vendedor comercial do pedido de venda, conforme importação Nomus/SalesOrder.",
    howWeCalculate:
      "Agrupamos pedidos pelo vendedor do SalesOrder. Sem nome/ID → “Sem vendedor informado”.",
    whatIsIncluded: "Nome ou ID Nomus do vendedor do pedido.",
    whatIsExcluded: "Responsável do CRM e qualquer regra de remuneração.",
    howToInterpret: "Use para qualidade da carteira comercial sob o vendedor do pedido.",
  },
  orderValue: {
    whatItMeans: "Total vendido em pedidos do vendedor no filtro atual.",
    howWeCalculate: "Σ valor oficial dos pedidos (um pedido conta uma vez).",
    whatIsIncluded: "Valor oficial do pedido.",
    whatIsExcluded: "Cabeçalho de NF, excedente e produto fora do pedido.",
    howToInterpret: "Tamanho da carteira comercial — não é caixa confirmado.",
  },
  ordersCount: {
    whatItMeans: "Quantidade de pedidos do vendedor no filtro.",
    howWeCalculate: "Contagem distinta de pedidos do agrupamento.",
    whatIsIncluded: "Todos os pedidos do recorte.",
    whatIsExcluded: "Itens avulsos sem pedido.",
    howToInterpret: "Volume operacional, além do valor.",
  },
  receivableValue: {
    whatItMeans: "Valor dos pedidos que já virou Contas a Receber.",
    howWeCalculate: "Σ valor de CR rateado aos pedidos do vendedor.",
    whatIsIncluded: "Títulos vinculados na conciliação.",
    whatIsExcluded: "Pedidos ainda sem CR.",
    howToInterpret: "Evidência financeira formalizada.",
  },
  conversionCrValuePct: {
    whatItMeans: "% de conversão pedido → CR por valor.",
    howWeCalculate: "Σ valor dos pedidos com CR ÷ valor total do vendedor × 100.",
    whatIsIncluded: "Pedidos com CR aberto ou recebido.",
    whatIsExcluded: "Pedidos só em carteira/documento sem título.",
    howToInterpret: "Quanto da carteira já entrou no financeiro. Baixo = gargalo de formalização.",
  },
  conversionCrQtyPct: {
    whatItMeans: "% de conversão pedido → CR por quantidade.",
    howWeCalculate: "Qtd pedidos com CR ÷ qtd pedidos × 100.",
    whatIsIncluded: "Pedidos com evidência de CR.",
    whatIsExcluded: "Pedidos sem título.",
    howToInterpret: "Conversão operacional por volume de pedidos.",
  },
  documentConvertedValue: {
    whatItMeans: "Valor de pedidos que já têm documento de saída.",
    howWeCalculate: "Σ valor dos pedidos com documento de estoque/saída.",
    whatIsIncluded: "Pedidos com evidência de documento.",
    whatIsExcluded: "NF só de cabeçalho sem documento.",
    howToInterpret: "Sinal de atendimento físico/faturamento operacional.",
  },
  conversionDocValuePct: {
    whatItMeans: "Participação em valor dos pedidos com documento de saída.",
    howWeCalculate: "Valor com documento ÷ valor total do vendedor × 100.",
    whatIsIncluded: "Pedidos com stock document.",
    whatIsExcluded: "Pedidos sem documento.",
    howToInterpret: "Quão avançada está a carteira em evidência de saída.",
  },
  operationalFulfillmentPct: {
    whatItMeans: "% de atendimento operacional da carteira do vendedor.",
    howWeCalculate:
      "Média do % de atendimento ponderada pelo valor do pedido; se indisponível, usa % totalmente atendidos.",
    whatIsIncluded: "Cobertura item a item do mapa de atendimento.",
    whatIsExcluded: "Não altera valor de carteira nem substitui conversão em CR.",
    howToInterpret: "Eixo operacional paralelo ao financeiro — 100% não significa dinheiro no caixa.",
  },
  receivedValue: {
    whatItMeans: "Valor já baixado/recebido nos CRs dos pedidos.",
    howWeCalculate: "Σ valor recebido dos pedidos do vendedor.",
    whatIsIncluded: "Baixas materializadas na conciliação.",
    whatIsExcluded: "Previsão de recebimento sem baixa.",
    howToInterpret: "Caixa já realizado ligado a esses pedidos.",
  },
  receiptRatePct: {
    whatItMeans: "Taxa de recebimento sobre o CR do vendedor.",
    howWeCalculate: "Valor recebido ÷ valor total de CR × 100.",
    whatIsIncluded: "Pedidos com CR.",
    whatIsExcluded: "Pedidos sem CR (denominador zero → sem taxa).",
    howToInterpret: "Eficiência de cobrança/baixa sobre o que já é título.",
  },
  openReceivableValue: {
    whatItMeans: "Valor ainda em Contas a Receber aberto.",
    howWeCalculate: "Σ openReceivableValue dos pedidos do vendedor.",
    whatIsIncluded: "Saldo aberto de títulos vinculados.",
    whatIsExcluded: "Parcelas já baixadas e pedidos sem CR.",
    howToInterpret: "Direito financeiro ainda a receber — não é pedido futuro.",
  },
  futureProbableValue: {
    whatItMeans: "Valor em carteira futura provável.",
    howWeCalculate: "Σ valor com status CARTEIRA_FUTURA_PROVAVEL.",
    whatIsIncluded: "Pedidos com previsão à frente e evidência operacional mínima.",
    whatIsExcluded: "CR aberto, recebido e carteira vencida.",
    howToInterpret: "Carteira operacional de horizonte futuro — acompanhar, não tratar como caixa.",
  },
  presentAttentionValue: {
    whatItMeans: "Valor em carteira presente / atenção.",
    howWeCalculate: "Σ valor com status CARTEIRA_PRESENTE_ATENCAO.",
    whatIsIncluded: "Pedidos na janela próxima que pedem acompanhamento.",
    whatIsExcluded: "Futuro provável e vencido/bloqueado.",
    howToInterpret: "Prioridade de gestão de curto prazo.",
  },
  stuckWithoutNfCrValue: {
    whatItMeans: "Valor ainda só em pedido, sem NF e sem CR.",
    howWeCalculate: "Σ valor onde não há NF e não há CR.",
    whatIsIncluded: "Carteira sem evidência fiscal/financeira.",
    whatIsExcluded: "Pedidos já faturados ou com CR.",
    howToInterpret: "Fila que precisa de evolução comercial ou revisão de vínculo.",
  },
  blockedValue: {
    whatItMeans: "Valor em carteira vencida/bloqueada.",
    howWeCalculate: "Σ valor com status CARTEIRA_VENCIDA_BLOQUEADA.",
    whatIsIncluded: "Pedidos antigos sem evolução suficiente.",
    whatIsExcluded: "CR aberto e pedidos futuros/presentes.",
    howToInterpret: "Principal risco de superestimar a carteira — não tratar como caixa confiável.",
  },
  overdueWithoutDocumentCount: {
    whatItMeans: "Pedidos com entrega vencida sem documento de saída.",
    howWeCalculate:
      "Conta pedidos com previsão de entrega já vencida (ou status vencido/bloqueado) e sem documento de saída.",
    whatIsIncluded: "Pedidos sem evidência operacional de saída após o prazo.",
    whatIsExcluded: "Pedidos com documento, mesmo que o CR ainda falte.",
    howToInterpret: "Gargalo operacional clássico: prazo passou e não há saída registrada.",
  },
  partiallyAttendedCount: {
    whatItMeans: "Pedidos parcialmente atendidos no eixo operacional.",
    howWeCalculate: "Contagem com status OP_PARCIALMENTE_ATENDIDO.",
    whatIsIncluded: "Pedidos com cobertura parcial de itens.",
    whatIsExcluded: "Totalmente atendidos e não atendidos.",
    howToInterpret: "Há entrega, mas a carteira ainda não fechou o atendimento.",
  },
  ordersWithExcessCount: {
    whatItMeans: "Pedidos com quantidade excedente no documento.",
    howWeCalculate:
      "Contagem com alerta QUANTIDADE_EXCEDENTE_DOCUMENTO ou excesso materializado.",
    whatIsIncluded: "Pedidos em que o documento ultrapassa a quantidade do pedido.",
    whatIsExcluded: "O excedente não soma valor de carteira.",
    howToInterpret: "Alerta técnico/operacional — revisar vínculo e quantidade.",
  },
  excessValue: {
    whatItMeans: "Valor estimado de quantidade excedente nos documentos.",
    howWeCalculate: "Σ valor estimado do excedente por pedido.",
    whatIsIncluded: "Somente a fatia excedente dos documentos.",
    whatIsExcluded: "Não entra na carteira total nem no valor oficial do pedido.",
    howToInterpret: "Alerta de risco — não tratar como dinheiro adicional.",
  },
  ordersWithProductOutside: {
    whatItMeans: "Pedidos com produto no documento fora do pedido.",
    howWeCalculate: "Contagem com alerta PRODUTO_FORA_DO_PEDIDO ou valor fora materializado.",
    whatIsIncluded: "Itens de documento que não pertencem ao pedido.",
    whatIsExcluded: "Não aumenta o valor do pedido nem a carteira.",
    howToInterpret: "Pode indicar vínculo cruzado ou documento com itens de outros pedidos.",
  },
  lowConfidenceValuePct: {
    whatItMeans: "Quanto da carteira está com confiança baixa ou muito baixa.",
    howWeCalculate: "Σ valor com confiança BAIXA/MUITO_BAIXA ÷ valor total × 100.",
    whatIsIncluded: "Pedidos com pouca evidência ou risco alto.",
    whatIsExcluded: "Pedidos com confiança média/alta.",
    howToInterpret: "Qualidade da evidência — quanto maior, mais revisão.",
  },
  averageConfidence: {
    whatItMeans: "Confiança média da carteira do vendedor, ponderada por valor.",
    howWeCalculate: "Σ (confiança × valor) ÷ Σ valor.",
    whatIsIncluded: "Todos os pedidos do vendedor no filtro.",
    whatIsExcluded: "Não usa regras de remuneração comercial.",
    howToInterpret: "Acima de 80 é saudável; abaixo de 40 pede atenção.",
  },
  mainBottleneck: {
    whatItMeans: "Principal gargalo de qualidade da carteira do vendedor.",
    howWeCalculate:
      "Prioridade fixa: (1) muitos pedidos vencidos sem documento; (2) baixa conversão para CR; (3) muitos documentos sem CR; (4) muitos pedidos parciais; (5) excesso/produto fora; senão sem gargalo relevante.",
    whatIsIncluded: "Sinais de atraso operacional, conversão financeira e desvios de atendimento.",
    whatIsExcluded: "Alertas técnicos não somam carteira; o gargalo é diagnóstico, não valor extra.",
    howToInterpret: "Priorize a ação no primeiro gargalo da lista — um foco por vez.",
  },
};

/** Chaves obrigatórias dos 18 KPIs + identidade do vendedor. */
export const SELLER_KPI_REQUIRED_EXPLAIN_KEYS = [
  "sellerName",
  "orderValue",
  "ordersCount",
  "receivableValue",
  "conversionCrValuePct",
  "conversionCrQtyPct",
  "documentConvertedValue",
  "operationalFulfillmentPct",
  "receivedValue",
  "openReceivableValue",
  "futureProbableValue",
  "presentAttentionValue",
  "blockedValue",
  "overdueWithoutDocumentCount",
  "partiallyAttendedCount",
  "ordersWithExcessCount",
  "ordersWithProductOutside",
  "averageConfidence",
  "mainBottleneck",
] as const;
