import type { WikiFlowStep, WikiModuleCard } from "@/src/lib/systemGuide/types";

export const SYSTEM_WIKI_QUICK_START: string[] = [
  "Faça login com o usuário fornecido pelo administrador.",
  "Confira no menu lateral quais módulos seu perfil pode acessar.",
  "Revise parâmetros globais em Configurações (se tiver permissão) antes de confiar em custos e preços.",
  "Mantenha cadastros de Suprimentos, Pessoas e Máquinas atualizados — eles alimentam a engenharia de produto.",
  "Cadastre ou sincronize produtos em Produtos; valide estrutura (BOM) e processo antes de formar preço.",
  "Use Formação de Preço para simular margens; gere propostas em Propostas quando o preço estiver validado.",
  "Para frota: cadastre veículos e motoristas, configure o link público em Configurações da Frota e acompanhe reservas.",
  "Em dúvida, use a busca deste Manual ou consulte o Glossário.",
];

export const SYSTEM_WIKI_MAIN_FLOWS: WikiFlowStep[] = [
  {
    title: "Do custo ao preço de venda",
    steps: [
      "Cadastre premissas (Suprimentos, Pessoas, Máquinas, Custos Indiretos, Tributos).",
      "Em Produtos, defina BOM e roteiro; abra a aba de custo e valide o CIU.",
      "Em Formação de Preço, simule preço com margem, impostos, frete e comissão.",
      "Gere tabelas comerciais (Atacado, Varejo) se tiver permissão de geração/publicação.",
      "Monte a proposta comercial com cliente e itens precificados.",
    ],
  },
  {
    title: "Integração diária com Nomus",
    steps: [
      "Acesse Configurações → Logs de Sincronização Nomus.",
      "Verifique a saúde das últimas execuções (clientes, produtos, propostas, pedidos, financeiro).",
      "Execute dry-run ou preview quando disponível antes de apply.",
      "Após apply, valide em Produtos, Clientes ou Financeiro conforme o alvo sincronizado.",
      "Para divergências de engenharia, use Manutenção Nomus dentro de Produtos.",
    ],
  },
  {
    title: "Reserva de veículo pelo QR público",
    steps: [
      "Administrador ativa e copia o link público em Gestão de Frota → Configurações.",
      "Usuário externo acessa o link, informa CPF e dados solicitados.",
      "Seleciona período (pode escolher vários slots no mesmo dia, quando disponível).",
      "Envia solicitação; gestor aprova motorista (se novo) e depois a reserva em Solicitações QR.",
      "Na data, motorista faz check-in pelo QR fixo do veículo; na devolução, check-out.",
    ],
  },
  {
    title: "Proposta aprovada → pedido interno",
    steps: [
      "Aprove a proposta no módulo Propostas.",
      "Gere ou acompanhe o pedido de venda vinculado em Pedidos de venda.",
      "Use indicadores e inteligência de matéria-prima para planejar produção/compras.",
      "Envio automático ao Nomus pode estar em implantação — verifique o status na tela do pedido.",
    ],
  },
];

export const SYSTEM_WIKI_MODULE_CARDS: WikiModuleCard[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    description: "Visão executiva, operação e funil comercial.",
    badge: "operacional",
    sectionAnchor: "dashboard",
  },
  {
    id: "products",
    title: "Produtos e Engenharia",
    description: "BOM, processo, análise de custo e Manutenção Nomus.",
    badge: "operacional",
    sectionAnchor: "engenharia",
  },
  {
    id: "pricing",
    title: "Formação de Preço",
    description: "Simulação, tabelas Atacado/Varejo e margens.",
    badge: "operacional",
    sectionAnchor: "comercial-precificacao",
  },
  {
    id: "nomus",
    title: "Integração Nomus",
    description: "Sincronização e manutenção de engenharia.",
    badge: "integracao",
    sectionAnchor: "integracao-nomus",
  },
  {
    id: "finance",
    title: "Financeiro",
    description: "Contas a receber e a pagar do Nomus.",
    badge: "financeiro",
    sectionAnchor: "financeiro",
  },
  {
    id: "fleet",
    title: "Gestão de Frota",
    description: "Veículos, reservas, QR público e checklists.",
    badge: "frota",
    sectionAnchor: "gestao-frota",
  },
  {
    id: "commercial",
    title: "Comercial",
    description: "Clientes, propostas, pedidos e CRM.",
    badge: "operacional",
    sectionAnchor: "comercial-precificacao",
  },
  {
    id: "admin",
    title: "Administração",
    description: "Usuários, perfis e permissões.",
    badge: "administrativo",
    sectionAnchor: "administracao",
  },
  {
    id: "settings",
    title: "Configurações",
    description: "Parâmetros globais, Nomus e tabelas de preço.",
    badge: "administrativo",
    sectionAnchor: "configuracoes",
  },
  {
    id: "glossary",
    title: "Glossário",
    description: "Siglas e termos usados no IndusCost.",
    badge: "operacional",
    sectionAnchor: "glossario",
  },
];
