/**
 * Textos e rótulos de apresentação da Inteligência da Carteira.
 * Não altera cálculo nem classificação — só UX / leigo.
 */

export const INTELLIGENCE_SCREEN_TITLE = "Inteligência da Carteira";

export const INTELLIGENCE_SCREEN_INTRO =
  "Esta tela mostra a maturidade da carteira comercial: o que já virou financeiro, o que ainda é pedido e o que precisa revisão.";

export const INTELLIGENCE_SCREEN_WARNING =
  "Pedido de venda não é dinheiro confirmado até virar CR.";

export const INTELLIGENCE_READING_GUIDE =
  "Leitura rápida: total da carteira → já virou financeiro → carteira provável → precisa validação → onde está o risco.";

/** Títulos amigáveis por chave de card/status (override visual). */
export const INTELLIGENCE_CARD_DISPLAY_TITLE: Record<string, string> = {
  CARTEIRA_TOTAL_ANALISADA: "Carteira total",
  RECEBIDO: "Já recebido",
  CR_ABERTO: "Já virou financeiro",
  FATURADO_SEM_CR: "Faturado, ainda sem CR",
  CARTEIRA_FUTURA_PROVAVEL: "Ainda só pedido (futuro)",
  CARTEIRA_PRESENTE_ATENCAO: "Ainda só pedido (atenção)",
  CARTEIRA_VENCIDA_BLOQUEADA: "Precisa validação",
  NF_CABECALHO_MAIOR_PEDIDO: "NF maior que o pedido",
  DIVERGENCIA_TECNICA: "Alerta de divergência",
  SEM_EVIDENCIA: "Sem evidência suficiente",
  RISCO_SUPERESTIMACAO: "Não tratar como caixa confiável",
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
  DIVERGENCIA_TECNICA: "Pode coexistir com o status",
  NF_CABECALHO_MAIOR_PEDIDO: "Não soma carteira — só alerta",
  SEM_EVIDENCIA: "Falta informação na importação",
  RISCO_SUPERESTIMACAO: "Mesmo valor do bloqueado",
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
  CARTEIRA_VENCIDA_BLOQUEADA: "Precisa validação",
  DIVERGENCIA_TECNICA: "Alerta de divergência",
  SEM_EVIDENCIA: "Sem evidência suficiente",
};

export const INTELLIGENCE_ACCORDION_HINT: Record<string, string> = {
  RECEBIDO: "Baixa evidenciada",
  CR_ABERTO: "Já é financeiro confirmado",
  FATURADO_SEM_CR: "Falta virar Contas a Receber",
  CARTEIRA_FUTURA_PROVAVEL: "Carteira provável",
  CARTEIRA_PRESENTE_ATENCAO: "Carteira provável — olhar de perto",
  CARTEIRA_VENCIDA_BLOQUEADA: "Não tratar como caixa confiável",
  DIVERGENCIA_TECNICA: "Alerta — não substitui o status",
  SEM_EVIDENCIA: "Revisar importação",
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
