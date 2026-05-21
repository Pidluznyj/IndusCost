import type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";

export type NomusMaintenanceStepInfo = {
  title: string;
  description: string;
  observe: string;
  nextStep: string;
};

export const NOMUS_MAINTENANCE_STEP_COPY: Record<NomusMaintenanceTab, NomusMaintenanceStepInfo> = {
  overview: {
    title: "Visão Geral",
    description:
      "Resumo da situação do produto. Use esta tela para saber se há pendências, impacto de custo e qual o próximo passo.",
    observe: "Status geral, opcionais, revisão local, custos em preview e avisos principais.",
    nextStep: "Siga a próxima ação recomendada ou abra a aba indicada nos atalhos abaixo.",
  },
  pending: {
    title: "Pendências",
    description: "Resolva decisões humanas: opcionais de precificação e itens locais do IndusCost.",
    observe: "Opcionais pendentes ou desatualizados e itens locais aguardando inclusão/exclusão.",
    nextStep: "Após resolver, confira a BOM efetiva e o impacto de custo.",
  },
  "effective-pricing-bom": {
    title: "BOM efetiva",
    description:
      "Mostra quais itens entram ou saem da precificação considerando Nomus, opcionais e decisões locais.",
    observe: "Linhas incluídas, excluídas e em revisão; status da BOM efetiva.",
    nextStep: "Se estiver pronta, abra Impacto de custo para comparar custos em preview.",
  },
  "cost-impact": {
    title: "Impacto de custo",
    description:
      "Compara o custo atual com o custo simulado pela BOM efetiva. É apenas preview.",
    observe: "Totais, diferença em R$ e %, e linhas com maior variação.",
    nextStep: "Revise o plano de aplicação (simulação) antes de qualquer decisão futura.",
  },
  "apply-plan": {
    title: "Plano de aplicação",
    description: "Mostra o que poderia ser alterado futuramente. Nenhuma alteração é aplicada.",
    observe: "Ações simuladas, bloqueios, opcionais e classificação de risco.",
    nextStep: "Use o diagnóstico técnico para auditar divergências linha a linha.",
  },
  "product-import": {
    title: "Importar produto do Nomus",
    description:
      "Fluxo para produto oficial Nomus ainda ausente no IndusCost. Cria cadastro e ProductBOM inicial para simulação — separado da aplicação de BOM em produto existente.",
    observe:
      "Produto principal, componentes a criar/usar, BOM planejada, opcionais pendentes e itens sem custo.",
    nextStep:
      "Após importar com confirmação explícita, abra o cadastro e a Análise de Custo (pode ficar incompleta).",
  },
  "engineering-sync": {
    title: "Atualizar engenharia pelo Nomus",
    description:
      "Mantém Produto e ProductBOM alinhados com o Nomus. Cria/atualiza linhas, remove itens que saíram da BOM Nomus e marca o produto como controlado pelo Nomus.",
    observe:
      "Diferenças por linha (antes/depois), bloqueios por ambiguidade ou opcional pendente, pendências de custo/roteiro.",
    nextStep:
      "Aplique com confirmação textual. Custo/preço não são publicados automaticamente — revise depois.",
  },
  diagnostic: {
    title: "Diagnóstico técnico",
    description: "Mostra a comparação detalhada entre Nomus e IndusCost para auditoria.",
    observe: "Comparação de linhas, classificação técnica e resumo do plano simulado.",
    nextStep: "Volte às pendências se houver bloqueios ou opcionais em aberto.",
  },
};
