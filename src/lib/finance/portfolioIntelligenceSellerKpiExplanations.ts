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
    whatItMeans: "Vendedor do pedido de venda, quando a importação trouxe essa informação.",
    howWeCalculate: "Agrupamos pedidos pelo vendedor do SalesOrder/Nomus. Sem dado → “Sem vendedor informado”.",
    whatIsIncluded: "Nome ou ID Nomus do vendedor do pedido.",
    whatIsExcluded: "Responsável comercial do CRM e regras de comissão.",
    howToInterpret: "Use para qualidade da carteira comercial — não para apuração de comissão.",
  },
  orderValue: {
    whatItMeans: "Soma do valor oficial dos pedidos do vendedor no filtro atual.",
    howWeCalculate: "Σ orderValue dos pedidos do vendedor (um pedido conta uma vez).",
    whatIsIncluded: "Valor oficial do pedido.",
    whatIsExcluded: "Cabeçalho de NF e duplicatas.",
    howToInterpret: "Tamanho da carteira sob responsabilidade comercial do vendedor.",
  },
  ordersCount: {
    whatItMeans: "Quantidade de pedidos do vendedor no filtro.",
    howWeCalculate: "Contagem distinta de pedidos agrupados no vendedor.",
    whatIsIncluded: "Todos os pedidos do recorte.",
    whatIsExcluded: "Itens avulsos sem pedido.",
    howToInterpret: "Volume operacional, não só valor.",
  },
  receivableValue: {
    whatItMeans: "Quanto desses pedidos já aparece em Contas a Receber.",
    howWeCalculate: "Σ receivableTotalValue rateado aos pedidos do vendedor.",
    whatIsIncluded: "Títulos CR vinculados na conciliação.",
    whatIsExcluded: "Pedidos sem CR.",
    howToInterpret: "Evidência financeira já gerada — não é comissão.",
  },
  conversionCrValuePct: {
    whatItMeans: "Fatia em valor dos pedidos que já têm CR.",
    howWeCalculate: "Σ valor dos pedidos com CR ÷ valor total do vendedor × 100.",
    whatIsIncluded: "Pedidos com CR aberto ou recebido.",
    whatIsExcluded: "Pedidos só em carteira/NF sem título.",
    howToInterpret: "Quanto da carteira já entrou no financeiro.",
  },
  conversionCrQtyPct: {
    whatItMeans: "Percentual de pedidos que já têm CR.",
    howWeCalculate: "Qtd pedidos com CR ÷ qtd pedidos × 100.",
    whatIsIncluded: "Pedidos com evidência de CR.",
    whatIsExcluded: "Pedidos sem título.",
    howToInterpret: "Conversão operacional por quantidade.",
  },
  documentConvertedValue: {
    whatItMeans: "Valor de pedidos que já têm documento de saída.",
    howWeCalculate: "Σ orderValue dos pedidos com documento de estoque/saída.",
    whatIsIncluded: "Pedidos com evidência de documento.",
    whatIsExcluded: "NF só cabeçalho sem documento.",
    howToInterpret: "Sinal de atendimento físico/faturamento operacional.",
  },
  conversionDocValuePct: {
    whatItMeans: "Participação em valor dos pedidos com documento de saída.",
    howWeCalculate: "Valor com documento ÷ valor total do vendedor × 100.",
    whatIsIncluded: "Pedidos com stock document.",
    whatIsExcluded: "Pedidos sem documento.",
    howToInterpret: "Quão avançada está a carteira em evidência de saída.",
  },
  receivedValue: {
    whatItMeans: "Quanto já foi baixado/recebido nos CRs dos pedidos.",
    howWeCalculate: "Σ receivedValue dos pedidos do vendedor.",
    whatIsIncluded: "Baixas materializadas na conciliação.",
    whatIsExcluded: "Previsão de recebimento sem baixa.",
    howToInterpret: "Caixa já realizado ligado a esses pedidos.",
  },
  receiptRatePct: {
    whatItMeans: "Taxa de recebimento sobre o CR do vendedor.",
    howWeCalculate: "Valor recebido ÷ valor total de CR × 100.",
    whatIsIncluded: "Pedidos com CR.",
    whatIsExcluded: "Pedidos sem CR (denominador zero → sem taxa).",
    howToInterpret: "Eficiência de cobrança/baixa — não é meta de comissão.",
  },
  stuckWithoutNfCrValue: {
    whatItMeans: "Valor ainda só em pedido, sem NF e sem CR.",
    howWeCalculate: "Σ orderValue onde não há NF e não há CR.",
    whatIsIncluded: "Carteira sem evidência fiscal/financeira.",
    whatIsExcluded: "Pedidos já faturados ou com CR.",
    howToInterpret: "Fila que precisa de evolução comercial ou revisão.",
  },
  blockedValue: {
    whatItMeans: "Valor em carteira vencida/bloqueada (sem evolução há tempo).",
    howWeCalculate: "Σ orderValue com status CARTEIRA_VENCIDA_BLOQUEADA.",
    whatIsIncluded: "Pedidos antigos sem NF/doc/CR.",
    whatIsExcluded: "CR aberto e pedidos futuros/presentes.",
    howToInterpret: "Principal risco de superestimar a carteira do vendedor.",
  },
  operationalFulfillmentPct: {
    whatItMeans: "Percentual de pedidos do vendedor totalmente atendidos no eixo operacional.",
    howWeCalculate: "Qtd totalmente atendidos ÷ qtd pedidos do vendedor × 100.",
    whatIsIncluded: "Atendimento item a item (com ou sem excedente).",
    whatIsExcluded: "Não substitui conversão em CR nem altera carteira.",
    howToInterpret: "Cobertura operacional — eixo paralelo ao financeiro.",
  },
  excessValue: {
    whatItMeans: "Valor estimado de quantidade excedente nos documentos do vendedor.",
    howWeCalculate: "Σ valor estimado do excedente por pedido.",
    whatIsIncluded: "Somente a fatia excedente dos documentos.",
    whatIsExcluded: "Não entra na carteira total nem no valor oficial do pedido.",
    howToInterpret: "Alerta de risco — não tratar como dinheiro adicional.",
  },
  ordersWithProductOutside: {
    whatItMeans: "Quantidade de pedidos com produto no documento fora do pedido.",
    howWeCalculate: "Contagem de pedidos com alerta de produto fora.",
    whatIsIncluded: "Pedidos com itens de documento não pertencentes ao pedido.",
    whatIsExcluded: "Não aumenta o valor do pedido.",
    howToInterpret: "Pode indicar vínculo cruzado ou NF com itens de outros pedidos.",
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
    whatIsExcluded: "Não usa regras de comissão.",
    howToInterpret: "Acima de 80 é saudável; abaixo de 40 pede atenção.",
  },
  mainBottleneck: {
    whatItMeans: "Maior bolsão de valor que trava a qualidade da carteira.",
    howWeCalculate:
      "Comparamos vencido/bloqueado, sem NF/CR, faturado sem CR, presente, divergência e futura; fica o maior.",
    whatIsIncluded: "Buckets de maturidade/alerta por valor.",
    whatIsExcluded: "Comissões e metas comerciais externas.",
    howToInterpret: "Priorize ação no gargalo — um foco por vez.",
  },
};
