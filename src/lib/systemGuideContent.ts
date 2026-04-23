/**
 * =============================================================================
 * MANUTENÇÃO DO GUIA DO SISTEMA (IndusCost)
 * =============================================================================
 * Este arquivo é a FONTE ÚNICA do texto do manual funcional exibido em /guide.
 *
 * Convenção de governança (obrigatória para evoluções):
 * - Sempre que um módulo, tela, fluxo ou regra visível ao usuário for criado(a),
 *   alterado(a) ou removido(a), atualize a entrada correspondente aqui no mesmo PR/commit.
 * - Não duplique conteúdo em outros componentes: importe apenas deste módulo.
 * - Mantenha linguagem de negócio; não exponha identificadores técnicos, nomes de
 *   campos internos ou detalhes de implementação desnecessários ao usuário final.
 * - Rotas citadas no texto devem refletir as rotas reais em App.tsx / Sidebar.
 *
 * Tipagem: mantém estrutura previsível e revisões seguras em TypeScript.
 * =============================================================================
 */

export type SystemGuideEntry = {
  /** Identificador estável para âncoras na página (não exibido ao usuário). */
  anchor: string;
  title: string;
  objective: string;
  features: string[];
  basicFlow: string[];
  notes: string[];
  /** Nomes amigáveis de módulos relacionados, quando ajudar o leitor. */
  relatedModules?: string[];
};

export type SystemGuideSection = {
  anchor: string;
  title: string;
  intro?: string;
  entries: SystemGuideEntry[];
};

export const SYSTEM_GUIDE_MAINTENANCE_HINT =
  "Alterações de funcionalidade devem refletir em src/lib/systemGuideContent.ts (Guia do Sistema).";

export const SYSTEM_GUIDE_SECTIONS: SystemGuideSection[] = [
  {
    anchor: "visao-geral",
    title: "Visão geral",
    intro:
      "O IndusCost integra cadastros de custo, engenharia de produto (estrutura e processo), comercial (clientes e propostas) e análises (forma de preço, simulações e relatórios). Use este guia como referência oficial do que existe hoje na interface.",
    entries: [
      {
        anchor: "visao-geral-induscost",
        title: "O que é o IndusCost",
        objective:
          "Apoiar decisões de margem, preço de venda e planejamento industrial, conectando custos, produto e comercial em um só ambiente.",
        features: [
          "Navegação por módulos no menu lateral.",
          "Telas de cadastro e operação alinhadas ao fluxo típico: premissas → produto → precificação → propostas → acompanhamento.",
          "Indicadores contextuais em vários módulos (botão dedicado no cabeçalho, quando disponível).",
          "Tours guiados em telas principais para primeiro uso.",
        ],
        basicFlow: [
          "Defina ou revise premissas em Configurações e nos cadastros de custo (pessoas, máquinas, suprimentos, indiretos, tributos).",
          "Cadastre produtos com estrutura (lista de materiais) e processo na Engenharia de Produto.",
          "Use Formação de Preço e Simulações para política de margem e cenários.",
          "Opere clientes e propostas comerciais; acompanhe resultados no Dashboard e em Relatórios.",
        ],
        notes: [
          "Este guia descreve apenas o que está disponível na aplicação; não substitui políticas internas da empresa.",
        ],
      },
    ],
  },
  {
    anchor: "modulos-navegacao",
    title: "Módulos e navegação",
    intro:
      "O menu lateral lista os módulos principais. Cada item abre uma rota dedicada dentro do layout padrão do sistema.",
    entries: [
      {
        anchor: "menu-lateral",
        title: "Menu principal",
        objective: "Acessar rapidamente cada área funcional sem alterar o contexto global da sessão.",
        features: [
          "Itens com rótulos em português (Dashboard, Colaboradores, Máquinas, etc.).",
          "Destaque visual do módulo ativo.",
          "Barra recolhível para ganho de espaço em telas menores.",
        ],
        basicFlow: ["Clique no módulo desejado no menu lateral.", "Use o conteúdo na área principal; volte ao menu para trocar de módulo."],
        notes: ["A ordem dos itens segue a prioridade de uso típica da operação; não indica dependência técnica obrigatória entre todos os itens."],
      },
    ],
  },
  {
    anchor: "cadastros",
    title: "Cadastros",
    intro:
      "Cadastros base alimentam custos, engenharia e comercial. Mantê-los atualizados evita distorção em preço e propostas.",
    entries: [
      {
        anchor: "cad-colaboradores",
        title: "Colaboradores",
        objective: "Registrar pessoas e custos de mão de obra direta usados nos cálculos de produto.",
        features: ["Listagem e edição de registros.", "Parâmetros de custo alinhados ao papel na operação."],
        basicFlow: ["Abra Colaboradores no menu.", "Inclua ou edite registros conforme a política de RH e custeio da empresa."],
        notes: ["Os valores impactam custo de hora-homem onde aplicável na engenharia."],
        relatedModules: ["Engenharia de Produto", "Relatórios"],
      },
      {
        anchor: "cad-maquinas",
        title: "Máquinas (centro de trabalho)",
        objective: "Representar ativos produtivos e custos de máquina/hora (depreciação e operação).",
        features: ["Cadastro de centros de trabalho.", "Premissas de custo horário para processos."],
        basicFlow: ["Acesse Máquinas.", "Cadastre ou ajuste equipamentos e custos conforme controlegem da empresa."],
        notes: ["Essencial para custo de processo quando o roteiro usa tempo de máquina."],
        relatedModules: ["Engenharia de Produto"],
      },
      {
        anchor: "cad-suprimentos",
        title: "Suprimentos",
        objective: "Gerir matérias-primas, insumos e custos de aquisição utilizados na estrutura de produtos e em compras.",
        features: ["Catálogo de materiais com classificação e status.", "Base de custo para explosão de necessidades e simulações."],
        basicFlow: ["Abra Suprimentos.", "Mantenha preços e dados de referência atualizados com compras e engenharia."],
        notes: ["Qualidade do cadastro afeta diretamente custo de produto e solicitações de compra."],
        relatedModules: ["Compras", "Engenharia de Produto", "Simulações"],
      },
      {
        anchor: "cad-clientes",
        title: "Clientes",
        objective: "Centralizar a carteira: dados cadastrais, segmentação e apoio ao relacionamento comercial.",
        features: [
          "Cadastro e busca de clientes.",
          "Importação de dados quando disponível na tela.",
          "Visão comercial ampliada (por exemplo, contexto de negócio ao redor do cliente), quando acionada na interface.",
        ],
        basicFlow: ["Acesse Clientes.", "Inclua ou edite clientes; use importação conforme necessidade e formato suportado."],
        notes: ["Clientes são vinculados às propostas comerciais para análise e relatórios."],
        relatedModules: ["Propostas", "Relatórios"],
      },
    ],
  },
  {
    anchor: "custos",
    title: "Custos",
    intro: "Custos indiretos, OPEX e tributos compõem a estrutura econômica além do custo direto de produto.",
    entries: [
      {
        anchor: "custos-indiretos-opex",
        title: "Custos indiretos e OPEX",
        objective: "Registrar despesas fixas, custos indiretos de fabricação e rateios administrativos que entram no custeio.",
        features: ["Cadastro e gestão de itens de custo indireto.", "Apoio a rateios usados na formação de custo total."],
        basicFlow: ["Abra Custos Indiretos no menu.", "Inclua ou revise lançamentos conforme plano de contas e política de rateio interna."],
        notes: ["Evita subestimar preço mínimo quando a estrutura indireta é relevante."],
        relatedModules: ["Formação de Preço", "Engenharia de Produto"],
      },
      {
        anchor: "tributos",
        title: "Tributos (configuração fiscal)",
        objective: "Configurar regras de tributação sobre venda usadas na formação de preço e fluxos comerciais.",
        features: ["Cadastro de regras fiscais aplicáveis.", "Associação aos cenários de precificação onde a interface permitir."],
        basicFlow: ["Acesse Tributos.", "Mantenha regras coerentes com o regime e a operação fiscal da empresa."],
        notes: ["Alterações aqui impactam margem líquida após impostos nas telas que consomem essas regras."],
        relatedModules: ["Formação de Preço", "Propostas"],
      },
    ],
  },
  {
    anchor: "engenharia",
    title: "Engenharia e estrutura",
    intro: "A engenharia define o produto técnico e econômico: lista de materiais, processos e custo calculado.",
    entries: [
      {
        anchor: "engenharia-produto",
        title: "Engenharia de Produto (Produtos)",
        objective: "Definir produtos e componentes com estrutura (lista de materiais), roteiro/processos e análise de custo.",
        features: [
          "Alternância entre visão de produtos e componentes.",
          "Detalhamento por abas no cadastro (informações, estrutura, processo, custos e análises conforme a tela).",
          "Indicadores de engenharia e inteligência de demanda de matéria-prima a partir de propostas (atalhos no cabeçalho quando existirem).",
          "Exportação de dados de engenharia quando a ação estiver disponível na lista.",
        ],
        basicFlow: [
          "Abra Produtos.",
          "Cadastre ou edite um item; preencha estrutura e processo.",
          "Revise custo e alertas exibidos pela tela antes de usar o item em preço ou proposta.",
        ],
        notes: [
          "O motor de custo pode considerar processo padrão do componente e, quando aplicável, o roteiro — conforme mensagens e regras exibidas na própria tela.",
        ],
        relatedModules: ["Suprimentos", "Colaboradores", "Máquinas", "Custos indiretos", "Formação de Preço", "Propostas"],
      },
    ],
  },
  {
    anchor: "simulacoes",
    title: "Simulações",
    intro: "Ambiente para cenários e análises sem substituir o cadastro definitivo até a decisão.",
    entries: [
      {
        anchor: "modulo-simulacoes",
        title: "Cenários e simulações",
        objective: "Avaliar variações de mercado, eficiência e viabilidade, incluindo simulação de novo produto com composição e relatório.",
        features: [
          "Área de cenários e área de simulação de novo produto (conforme abas da tela).",
          "Comparação e relatório quando disponíveis na interface.",
          "Indicadores de simulações gravadas (atalho no cabeçalho).",
        ],
        basicFlow: ["Acesse Simulações.", "Escolha o modo adequado (cenário ou novo produto).", "Preencha premissas, analise resultados e salve quando fizer sentido."],
        notes: ["Útil para resposta rápida a ‘e se…?’ sem alterar cadastros produtivos até a aprovação."],
        relatedModules: ["Suprimentos", "Engenharia de Produto", "Formação de Preço"],
      },
    ],
  },
  {
    anchor: "comercial-precificacao",
    title: "Propostas e formação de preço",
    intro: "Comercial une cliente, produto e política de margem em orçamentos; a forma de preço apoia a decisão antes da proposta.",
    entries: [
      {
        anchor: "formacao-preco",
        title: "Formação de preço",
        objective: "Simular preço com markup, impostos, frete, comissão e margem líquida, por produto ou em lote, com visão de composição quando aplicável.",
        features: [
          "Modo unitário e modo em lote (quando exibidos na tela).",
          "Filtros e faixas para localizar combinações produto × regra fiscal.",
          "Indicadores de cobertura de premissas (atalho no cabeçalho).",
        ],
        basicFlow: ["Abra Formação de Preço.", "Selecione produto e regra fiscal.", "Ajuste margem, comissão e variáveis comerciais; interprete o resultado antes de fixar tabela ou proposta."],
        notes: ["Ajuste tributos em Tributos para alinhar cenários fiscais."],
        relatedModules: ["Tributos", "Engenharia de Produto", "Propostas"],
      },
      {
        anchor: "propostas",
        title: "Propostas comerciais",
        objective: "Registrar orçamentos e negociações com status, itens, valores e margens alinhados ao fluxo B2B.",
        features: [
          "Lista e formulário de proposta com status (rascunho, análise, enviada, aprovada, etc.).",
          "Itens com custo, preço sugerido/negociado, impostos, frete e comissão conforme a tela.",
          "Indicadores consolidados do funil (atalho no cabeçalho).",
          "Análises e painéis auxiliares quando os botões ou abas estiverem disponíveis.",
        ],
        basicFlow: [
          "Acesse Propostas.",
          "Crie ou edite uma proposta; vincule cliente e itens.",
          "Acompanhe status e valores; use indicadores para visão agregada.",
        ],
        notes: ["Condições de frete (por exemplo CIF ou FOB) seguem o que estiver selecionável no formulário."],
        relatedModules: ["Clientes", "Engenharia de Produto", "Formação de Preço", "Dashboard", "Relatórios"],
      },
    ],
  },
  {
    anchor: "compras",
    title: "Compras",
    intro: "Registro de demanda de compra; não substitui processos externos de pedido, recebimento ou financeiro além do escopo atual da tela.",
    entries: [
      {
        anchor: "modulo-compras",
        title: "Solicitações de compra",
        objective: "Formalizar necessidade de compra com prioridade, centro de custo e classificação da demanda.",
        features: ["Requisições com itens e status.", "Priorização e classificação conforme opções da interface.", "Indicadores das solicitações registradas (atalho no cabeçalho)."],
        basicFlow: ["Abra Compras.", "Inclua uma solicitação com itens e dados exigidos pelo formulário.", "Acompanhe status até encerramento interno previsto na tela."],
        notes: [
          "A própria interface indica o escopo da fase atual (por exemplo, sem pedido ao fornecedor ou fluxo financeiro completo nesta etapa).",
        ],
        relatedModules: ["Suprimentos"],
      },
    ],
  },
  {
    anchor: "indicadores-relatorios",
    title: "Indicadores e relatórios",
    intro: "Consolidação gerencial e operacional: painel inicial, indicadores por módulo e relatórios com filtros.",
    entries: [
      {
        anchor: "dashboard",
        title: "Dashboard gerencial",
        objective: "Visão rápida de operação/financeiro e de funil de vendas em abas distintas.",
        features: [
          "Aba de operação e finanças com indicadores agregados e composição de custo.",
          "Aba de funil comercial com propostas e pipeline.",
        ],
        basicFlow: ["Abra Dashboard.", "Alterne entre as abas conforme a decisão (operacional x comercial)."],
        notes: ["Dados dependem da qualidade dos cadastros e das propostas atualizadas."],
        relatedModules: ["Propostas", "Relatórios"],
      },
      {
        anchor: "indicadores-modulos",
        title: "Indicadores por módulo",
        objective: "Oferecer painéis específicos de cobertura e totais onde o botão de indicadores aparece no cabeçalho.",
        features: [
          "Acesso via botão no módulo correspondente (compras, propostas, clientes, simulações, engenharia, formação de preço, etc.).",
        ],
        basicFlow: ["No módulo desejado, clique em Indicadores (ou equivalente) no topo.", "Interprete totais e alertas exibidos."],
        notes: ["Cada painel reflete apenas o módulo ao qual está associado."],
      },
      {
        anchor: "relatorios",
        title: "Relatórios e BI",
        objective: "Analisar desempenho com filtros por período, cliente, responsável, status, produto e faixas de valor.",
        features: [
          "Abas: Executivo, Comercial, Clientes e ABC, Produtos e mix, Custos e preço.",
          "Exportação ou impressão quando o botão existir na tela.",
        ],
        basicFlow: ["Abra Relatórios.", "Defina filtros.", "Navegue pelas abas para a leitura desejada."],
        notes: ["Interpretação deve considerar o recorte de datas e filtros aplicados."],
        relatedModules: ["Propostas", "Clientes", "Engenharia de Produto"],
      },
    ],
  },
  {
    anchor: "configuracoes",
    title: "Configurações",
    intro: "Parâmetros globais e estrutura operacional; parte da área pode exigir acesso administrativo temporário conforme o ambiente.",
    entries: [
      {
        anchor: "modulo-configuracoes",
        title: "Configurações do sistema",
        objective: "Ajustar parâmetros corporativos usados nos cálculos e definir cargos, encargos e componentes de folha quando disponível.",
        features: [
          "Hub com seções (gerais, operacional, integrações futuras, segurança futura, sistema futuro) conforme a tela.",
          "Gestão de cargos e componentes de folha na parte operacional liberada.",
        ],
        basicFlow: ["Abra Configurações.", "Revise parâmetros globais e estrutura operacional com perfil autorizado.", "Salve alterações conforme os formulários."],
        notes: [
          "Quando o bootstrap administrativo estiver habilitado, a tela pode solicitar login administrativo temporário antes de exibir o conteúdo completo — comportamento descrito na própria interface.",
          "Integrações e permissionamento avançado podem constar como preparação futura na tela.",
        ],
        relatedModules: ["Colaboradores", "Todos os módulos que consomem parâmetros globais"],
      },
    ],
  },
  {
    anchor: "regras-importantes",
    title: "Regras e observações importantes",
    intro: "Boas práticas para uso consistente do sistema.",
    entries: [
      {
        anchor: "governanca-dados",
        title: "Qualidade e ordem de uso",
        objective: "Reduzir erro de margem e de proposta mantendo premissas alinhadas.",
        features: [],
        basicFlow: [
          "Atualize cadastros de custo antes de fechar tabelas de preço.",
          "Revise engenharia antes de aprovar propostas com itens novos.",
          "Use simulações para mudanças grandes antes de alterar cadastro produtivo.",
        ],
        notes: [
          "Este guia acompanha o código: atualize-o junto com mudanças de produto (ver comentário no topo de systemGuideContent.ts).",
          "Em caso de divergência entre este texto e a tela, prevalece o comportamento da aplicação.",
        ],
      },
    ],
  },
];
