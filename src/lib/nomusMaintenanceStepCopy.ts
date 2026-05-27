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
      "Sem produto: use a Central Engenharia Nomus como fila principal. Com produto selecionado: resumo e atalhos para as etapas de revisão.",
    observe:
      "Status do produto, próxima ação recomendada e atalhos. BOM efetiva e impacto de custo são análises prévias.",
    nextStep:
      "Atualize a Central Engenharia, abra um produto bloqueado, resolva pendências e aplique somente quando o preview permitir.",
  },
  pending: {
    title: "Pendências",
    description:
      "Decisões humanas antes de aplicar BOM: opcionais de precificação e itens locais somente IndusCost.",
    observe: "Opcionais pendentes ou desatualizados e itens locais aguardando decisão.",
    nextStep: "Salve as decisões aqui; depois confira BOM efetiva e impacto de custo (preview).",
  },
  "effective-pricing-bom": {
    title: "BOM efetiva",
    description:
      "Análise prévia: quais itens entram na precificação considerando Nomus, opcionais e decisões locais. Não altera ProductBOM.",
    observe: "Linhas incluídas, excluídas e em revisão; status da BOM efetiva.",
    nextStep: "Se estiver pronta, abra Impacto de custo (também preview) antes do plano de aplicação.",
  },
  "cost-impact": {
    title: "Impacto de custo",
    description:
      "Compara o custo atual com o custo simulado pela BOM efetiva. Somente preview — não altera custo oficial nem preço.",
    observe: "Totais, diferença em R$ e %, e linhas com maior variação.",
    nextStep: "Revise o plano de aplicação: simulação legada e, se liberado, aplicação controlada com confirmação.",
  },
  "apply-plan": {
    title: "Plano de aplicação",
    description:
      "Duas camadas: (1) simulação do plano legado (read-only) e (2) aplicação controlada da BOM efetiva, somente com confirmação explícita quando canApply=true.",
    observe:
      "Primeiro a tabela de simulação; abaixo, o bloco de aplicação controlada com texto de confirmação obrigatório.",
    nextStep:
      "Resolva bloqueios em Pendências antes de aplicar. Use Diagnóstico técnico só se precisar auditar linha a linha.",
  },
  "product-import": {
    title: "Importar produto do Nomus",
    description:
      "Para produto Nomus ainda ausente no IndusCost. Cria cadastro e estrutura inicial — ação real com confirmação explícita.",
    observe:
      "Produto principal, componentes a criar/usar, BOM planejada, opcionais pendentes e itens sem custo.",
    nextStep:
      "Após importar, volte à Visão Geral e siga o fluxo: Pendências → BOM efetiva → Plano de aplicação.",
  },
  "engineering-sync": {
    title: "Atualizar engenharia pelo Nomus (avançado)",
    description:
      "Ferramenta técnica/administrativa de reconciliação em lote. Pode criar, atualizar e remover linhas de ProductBOM com confirmação.",
    observe:
      "Plano de sincronização por linha, bloqueios e resultado após apply. Preferir o fluxo operacional padrão na maioria dos casos.",
    nextStep:
      "Fluxo recomendado: Central Engenharia → Pendências → BOM efetiva → Plano de aplicação (aplicação controlada).",
  },
  diagnostic: {
    title: "Diagnóstico técnico",
    description:
      "Área de suporte técnico e auditoria. Não é etapa obrigatória do fluxo operacional do estagiário.",
    observe: "Comparação detalhada Nomus × IndusCost, classificação técnica e relatórios em lote.",
    nextStep: "Use apenas para investigação ou suporte. Para operação diária, use a Central Engenharia.",
  },
};

export type NomusOperationalWorkflowStep = {
  title: string;
  description: string;
};

/** Passos do fluxo operacional exibidos na Visão Geral. */
export const NOMUS_OPERATIONAL_WORKFLOW_STEPS: NomusOperationalWorkflowStep[] = [
  {
    title: "Atualize a Central Engenharia",
    description: "Atualize o painel da Central Engenharia Nomus pelo botão no painel.",
  },
  {
    title: "Abra produtos bloqueados",
    description: "Escolha um produto na fila de bloqueados ou pela busca.",
  },
  {
    title: "Resolva pendências",
    description: "Trate opcionais de precificação e itens locais somente IndusCost.",
  },
  {
    title: "Confira a BOM efetiva",
    description: "Revise a análise prévia antes de qualquer aplicação.",
  },
  {
    title: "Confira impacto de custo",
    description: "Compare o custo simulado com o atual — também é preview.",
  },
  {
    title: "Aplique somente quando permitido",
    description: "Use a aplicação controlada apenas com confirmação explícita.",
  },
  {
    title: "Revalide se saiu de bloqueado",
    description: "Volte à Central Engenharia e confirme que o produto foi liberado.",
  },
];
