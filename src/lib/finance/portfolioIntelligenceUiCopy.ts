/**
 * Textos e rótulos de apresentação da Inteligência da Carteira.
 * Não altera cálculo nem classificação — só UX / leigo.
 */

export const INTELLIGENCE_SCREEN_TITLE = "Inteligência da Carteira";

export const INTELLIGENCE_SCREEN_INTRO =
  "Esta central mostra a maturidade da carteira: o que já virou financeiro, o que ainda é pedido e o que precisa revisão técnica/comercial.";

export const INTELLIGENCE_SCREEN_WARNING =
  "Pedido de venda não é dinheiro confirmado até virar CR.";

export const INTELLIGENCE_ALERTS_NOTICE =
  "Alertas técnicos não são valores adicionais; eles sinalizam risco ou divergência em pedidos já classificados. Alerta — pode coexistir com outro status. Não soma carteira.";

export const INTELLIGENCE_AXIS_LEGEND =
  "Financeiro = CR/baixa · Operacional = pedido versus documentos de saída · Alerta = risco de vínculo, excesso, preço ou cabeçalho.";

export const INTELLIGENCE_READING_GUIDE =
  "Leitura: financeiro confirmado → carteira operacional → alertas técnicos (sem somar carteira).";

/** Títulos amigáveis por chave de card/status (override visual). */
export const INTELLIGENCE_CARD_DISPLAY_TITLE: Record<string, string> = {
  CARTEIRA_TOTAL_ANALISADA: "Carteira total",
  RECEBIDO: "Já recebido",
  CR_ABERTO: "Já virou financeiro / CR aberto",
  FATURADO_SEM_CR: "Faturado, ainda sem CR",
  CARTEIRA_FUTURA_PROVAVEL: "Ainda só pedido — futuro",
  CARTEIRA_PRESENTE_ATENCAO: "Ainda só pedido — atenção",
  CARTEIRA_VENCIDA_BLOQUEADA: "Carteira vencida bloqueada",
  NF_CABECALHO_MAIOR_PEDIDO: "NF maior que pedido",
  DIVERGENCIA_TECNICA: "Alerta de divergência",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "Quantidade excedente",
  PRODUTO_FORA_DO_PEDIDO: "Produto fora do pedido",
  SEM_EVIDENCIA: "Sem evidência suficiente",
  RISCO_SUPERESTIMACAO: "Risco de superestimação",
  CONVERSAO_PEDIDOS_CR_QTD: "% pedidos que viraram CR",
  CONVERSAO_DOC_SAIDA_QTD: "% com documento de saída",
  TAXA_RECEBIMENTO_CR: "Taxa de recebimento",
  CONFIANCA_MEDIA_CARTEIRA: "Confiança média",
};

export const INTELLIGENCE_CARD_SUBTITLE: Record<string, string> = {
  CARTEIRA_TOTAL_ANALISADA: "Soma única dos pedidos no filtro",
  RECEBIDO: "Dinheiro já baixado",
  CR_ABERTO: "Já é Contas a Receber",
  FATURADO_SEM_CR: "Saiu nota/doc., falta CR",
  CARTEIRA_FUTURA_PROVAVEL: "Previsão à frente",
  CARTEIRA_PRESENTE_ATENCAO: "Janela próxima — acompanhar",
  CARTEIRA_VENCIDA_BLOQUEADA: "Pedido antigo sem evolução",
  DIVERGENCIA_TECNICA: "Alerta — não soma carteira",
  NF_CABECALHO_MAIOR_PEDIDO: "Alerta — não soma carteira",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "Alerta — não soma carteira",
  PRODUTO_FORA_DO_PEDIDO: "Alerta — não soma carteira",
  SEM_EVIDENCIA: "Falta informação na importação",
  RISCO_SUPERESTIMACAO: "Alerta — mesmo valor do bloqueado",
  CONVERSAO_PEDIDOS_CR_QTD: "Quantidade convertida",
  CONVERSAO_DOC_SAIDA_QTD: "Quantidade com saída",
  TAXA_RECEBIMENTO_CR: "Do CR já baixado",
  CONFIANCA_MEDIA_CARTEIRA: "Ponderada pelo valor",
};

export const INTELLIGENCE_ACCORDION_DISPLAY_TITLE: Record<string, string> = {
  RECEBIDO: "Já recebido",
  CR_ABERTO: "Já virou financeiro (CR aberto)",
  FATURADO_SEM_CR: "Faturado, ainda sem CR",
  CARTEIRA_FUTURA_PROVAVEL: "Ainda só pedido — futuro",
  CARTEIRA_PRESENTE_ATENCAO: "Ainda só pedido — atenção",
  CARTEIRA_VENCIDA_BLOQUEADA: "Carteira vencida bloqueada",
  SEM_EVIDENCIA: "Sem evidência suficiente",
  DIVERGENCIA_TECNICA: "Alerta de divergência",
  NF_CABECALHO_MAIOR_PEDIDO: "NF maior que pedido",
};

export const INTELLIGENCE_ACCORDION_HINT: Record<string, string> = {
  RECEBIDO: "Baixa evidenciada",
  CR_ABERTO: "Já é financeiro confirmado",
  FATURADO_SEM_CR: "Falta virar Contas a Receber",
  CARTEIRA_FUTURA_PROVAVEL: "Carteira operacional — futuro",
  CARTEIRA_PRESENTE_ATENCAO: "Carteira operacional — atenção",
  CARTEIRA_VENCIDA_BLOQUEADA: "Não tratar como caixa confiável",
  SEM_EVIDENCIA: "Revisar importação",
  DIVERGENCIA_TECNICA: "Alerta — pode coexistir; não soma carteira",
  NF_CABECALHO_MAIOR_PEDIDO: "Alerta — cabeçalho ≠ valor do pedido",
};

/** Cards da “leitura em 10 segundos” (destaque visual). */
export const INTELLIGENCE_HERO_CARD_KEYS = [
  "CARTEIRA_TOTAL_ANALISADA",
  "CR_ABERTO",
  "RECEBIDO",
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
  "RISCO_SUPERESTIMACAO",
] as const;

export function intelligenceCardTitle(key: string, apiTitle?: string): string {
  return INTELLIGENCE_CARD_DISPLAY_TITLE[key] ?? apiTitle ?? key;
}

export function intelligenceAccordionTitle(key: string): string {
  return INTELLIGENCE_ACCORDION_DISPLAY_TITLE[key] ?? key;
}

export const CONFIDENCE_DISPLAY: Record<
  string,
  { label: string; hint: string; className: string }
> = {
  ALTA: {
    label: "Alta confiança",
    hint: "Evidência forte",
    className: "border-emerald-200/90 bg-emerald-50 text-emerald-900",
  },
  MEDIA: {
    label: "Confiança média",
    hint: "Usar com contexto",
    className: "border-sky-200/90 bg-sky-50 text-sky-900",
  },
  BAIXA: {
    label: "Confiança baixa",
    hint: "Revisar com cuidado",
    className: "border-amber-200/90 bg-amber-50 text-amber-950",
  },
  MUITO_BAIXA: {
    label: "Confiança muito baixa",
    hint: "Não tratar como caixa confiável",
    className: "border-rose-200/80 bg-rose-50/90 text-rose-900",
  },
};

export function confidenceDisplay(label: string | null | undefined) {
  const key = (label ?? "").toUpperCase();
  return (
    CONFIDENCE_DISPLAY[key] ?? {
      label: label || "Confiança",
      hint: "",
      className: "border-border bg-muted/50 text-muted-foreground",
    }
  );
}
