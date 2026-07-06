import type { SystemGuideSection } from "@/src/lib/systemGuide/types";

export const SYSTEM_GUIDE_SECTIONS: SystemGuideSection[] = [
  {
    anchor: "visao-geral",
    title: "Visão geral",
    intro:
      "O IndusCost conecta engenharia de produto, custos, comercial, financeiro e frota em um fluxo único de gestão. Este guia descreve somente o que está disponível hoje nas telas do sistema.",
    badge: "operacional",
    entries: [
      {
        anchor: "visao-geral-plataforma",
        title: "Escopo do sistema",
        objective:
          "Orientar o uso do IndusCost com foco operacional, sem expor detalhes técnicos internos.",
        badge: "operacional",
        whoUses: "Gestão industrial, custos, comercial, financeiro, frota e administração.",
        whereToAccess: "Menu lateral > Guia do Sistema.",
        permissions: "Perfil com acesso ao módulo Guia do Sistema.",
        features: [
          "Navegação por tópicos com busca textual.",
          "Conteúdo organizado por áreas do menu real.",
          "Explicação de regras de negócio e erros comuns.",
          "Referência de integrações e itens em implantação.",
        ],
        basicFlow: [
          "Abra o Guia do Sistema no menu lateral.",
          "Navegue pelo índice por módulo.",
          "Use a busca para localizar termos específicos.",
          "Consulte regras e alertas antes de operar os módulos.",
        ],
        importantFields: ["Título do tópico", "Objetivo", "Fluxo básico", "Regras de negócio", "Alertas"],
        businessRules: [
          "O guia deve refletir o comportamento atual das telas.",
          "Quando houver divergência, a tela operacional prevalece.",
          "Fluxos marcados como em implantação não devem ser tratados como concluídos.",
        ],
        commonErrors: [
          "Assumir que toda função descrita em roadmap já está ativa.",
          "Ignorar alertas de permissão por perfil.",
        ],
        examples: [
          "Antes de formar preço, consultar Engenharia e Comercial/Precificação.",
          "Antes de abrir acesso externo da frota, revisar notas de segurança.",
        ],
        securityNotes: [
          "Compartilhe conteúdo do guia conforme política interna de confidencialidade.",
          "Não divulgar links públicos de QR para pessoas não autorizadas.",
        ],
        notes: [
          "A estrutura deste guia acompanha os módulos ativos do menu lateral.",
          "Itens futuros ficam explicitamente marcados para evitar interpretação incorreta.",
        ],
        relatedModules: ["Dashboard", "Guia do Sistema", "Configurações"],
        relatedAnchors: ["dashboard", "configuracoes", "perguntas-frequentes"],
        tags: ["onboarding", "manual", "governanca"],
        alerts: [
          {
            type: "tip",
            text: "Use este guia como referência operacional diária para alinhamento entre áreas.",
          },
        ],
      },
    ],
  },
  {
    anchor: "dashboard",
    title: "Dashboard",
    intro:
      "O Dashboard oferece visão executiva, operação e funil comercial em abas distintas.",
    badge: "operacional",
    entries: [
      {
        anchor: "dashboard-abas-principais",
        title: "Leitura gerencial por abas",
        objective: "Acompanhar desempenho macro e apoiar decisões rápidas do dia a dia.",
        badge: "operacional",
        whoUses: "Diretoria, coordenação comercial, custos e operação.",
        whereToAccess: "Menu lateral > Dashboard.",
        permissions: "Acesso ao módulo Dashboard conforme perfil.",
        features: [
          "Aba executivo para visão consolidada.",
          "Aba operacao para acompanhamento operacional.",
          "Aba funil para acompanhamento comercial.",
          "Filtro de ano na aba executiva.",
        ],
        basicFlow: [
          "Abra o Dashboard.",
          "Selecione a aba conforme o foco da análise (executivo, operacao ou funil).",
          "Na aba executiva, ajuste o filtro de ano.",
          "Cruze os indicadores com Comercial, Engenharia e Relatórios para decisão.",
        ],
        importantFields: ["Aba ativa", "Ano (executivo)", "Indicadores consolidados"],
        businessRules: [
          "O filtro de ano se aplica à visão executiva.",
          "A leitura do funil deve ser validada com status reais de propostas.",
        ],
        commonErrors: [
          "Analisar resultado sem revisar o ano selecionado na aba executiva.",
          "Usar funil comercial sem conferir atualização de propostas.",
        ],
        examples: [
          "Comparar dois anos na aba executiva para observar variação de performance.",
          "Usar aba funil para reunião semanal de vendas.",
        ],
        securityNotes: [
          "Não compartilhar capturas de indicadores com dados sensíveis fora do time autorizado.",
        ],
        notes: [
          "Os números dependem da qualidade dos lançamentos e cadastros nos módulos de origem.",
        ],
        relatedModules: ["Propostas", "Relatórios", "Formação de Preço"],
        relatedAnchors: ["comercial-precificacao", "indicadores-relatorios"],
        tags: ["dashboard", "indicadores", "gestao"],
        alerts: [
          {
            type: "attention",
            text: "Sempre valide o contexto (aba e período) antes de apresentar resultados.",
          },
        ],
      },
    ],
  },
  {
    anchor: "engenharia",
    title: "Engenharia",
    intro:
      "Concentra Produtos e análise de custo industrial para suportar formação de preço e propostas.",
    badge: "operacional",
    entries: [
      {
        anchor: "engenharia-produtos-modulo",
        title: "Produtos e estrutura técnica",
        objective:
          "Cadastrar e analisar produtos com estrutura, processo e histórico para basear decisões de custo e preço.",
        badge: "operacional",
        whoUses: "Engenharia de produto, PCP, custos e pré-vendas técnicas.",
        whereToAccess: "Menu lateral > Produtos.",
        permissions: "Acesso ao módulo Produtos conforme perfil de engenharia/custos.",
        features: [
          "Abas principais: Produtos e Manutenção Nomus.",
          "No cadastro/modal de produto: info, bom, routing, tree, cost, composition e history.",
          "Visão de composição para entendimento de estrutura e custo.",
          "Histórico para rastrear mudanças relevantes do produto.",
        ],
        basicFlow: [
          "Abra Produtos e selecione a aba Produtos.",
          "Localize ou cadastre o item.",
          "Revise informações gerais em info.",
          "Monte estrutura em bom e processo em routing.",
          "Valide estrutura visual em tree e custo em cost/composition.",
          "Use history para conferir alterações antes de aprovar uso comercial.",
        ],
        importantFields: [
          "Código do produto",
          "Descrição",
          "Estrutura (BOM)",
          "Roteiro (routing)",
          "Custo (cost)",
        ],
        businessRules: [
          "Produto sem estrutura e processo consistentes compromete formação de preço.",
          "A análise de custo deve ser revisada antes de uso em propostas.",
        ],
        commonErrors: [
          "Montar BOM sem revisar unidade e quantidade.",
          "Aprovar item comercial sem validar aba cost.",
        ],
        examples: [
          "Atualizar BOM após troca de matéria-prima e revalidar custo.",
          "Revisar routing quando há alteração de processo produtivo.",
        ],
        securityNotes: [
          "Restringir edição de engenharia a perfis autorizados.",
          "Controlar acesso a histórico para rastreabilidade interna.",
        ],
        notes: [
          "A aba Manutenção Nomus fica dentro do módulo Produtos e é detalhada em seção própria.",
        ],
        relatedModules: ["Suprimentos", "Máquinas", "Pessoas/RH", "Formação de Preço", "Propostas"],
        relatedAnchors: ["manutencao-nomus", "comercial-precificacao", "cadastros"],
        tags: ["produtos", "bom", "routing", "custo"],
        alerts: [
          {
            type: "tip",
            text: "Padronize revisão por checklist interno antes de liberar produto para o comercial.",
          },
        ],
      },
      {
        anchor: "engenharia-analise-custo-ciu",
        title: "Análise de custo (CIU e CIF)",
        objective:
          "Interpretar corretamente o custo industrial sem duplicar leitura entre BOM e cards analíticos.",
        badge: "operacional",
        whoUses: "Custos, engenharia, controladoria e formação de preço.",
        whereToAccess: "Menu lateral > Produtos > análise de custo do produto.",
        permissions: "Acesso de leitura de custos no módulo Produtos.",
        features: [
          "CIU composto por MP + HH + HM.",
          "CIF tratado separadamente do CIU.",
          "Componentes fabricados podem mostrar CIU completo na linha da BOM.",
          "Cards analíticos separam MP e conversão para leitura gerencial.",
        ],
        basicFlow: [
          "Abra o produto e vá para a visão de custo.",
          "Confira CIU total e suas parcelas (MP, HH, HM).",
          "Analise CIF separadamente.",
          "Nos componentes fabricados, compare linha da BOM com cards de custo.",
          "Valide se a leitura de MP e conversão é de decomposição, não de duplicidade.",
        ],
        importantFields: ["CIU", "MP", "HH", "HM", "CIF", "Cards de composição"],
        businessRules: [
          "CIU = MP + HH + HM.",
          "CIF não integra o CIU; é apresentado em separado.",
          "Quando um componente fabricado aparece com CIU completo na BOM e separado nos cards, não há duplicação de custo.",
        ],
        commonErrors: [
          "Somar CIU da linha da BOM com MP/conversão dos cards como se fossem valores adicionais.",
          "Interpretar CIF como parcela do CIU.",
        ],
        examples: [
          "Componente fabricado na BOM mostra CIU total; cards apenas decompõem entre MP e conversão.",
        ],
        securityNotes: [
          "Resultados de custo devem ser compartilhados somente com áreas autorizadas.",
        ],
        notes: [
          "A leitura correta evita decisões equivocadas de margem e preço de venda.",
        ],
        relatedModules: ["Formação de Preço", "Simulações", "Relatórios"],
        relatedAnchors: ["comercial-precificacao", "simulacoes", "indicadores-relatorios"],
        tags: ["ciu", "cif", "mp", "hh", "hm", "componente-fabricado"],
        alerts: [
          {
            type: "attention",
            text: "Não trate decomposição de custo como soma adicional; isso gera superavaliação do produto.",
          },
        ],
      },
    ],
  },
  {
    anchor: "comercial-precificacao",
    title: "Comercial e precificação",
    intro:
      "Reúne formação de preço, propostas, pedidos de venda, clientes e CRM Comercial.",
    badge: "operacional",
    entries: [
      {
        anchor: "comercial-formacao-preco",
        title: "Formação de Preço",
        objective:
          "Simular e publicar preços em modos unitário e lote, respeitando permissões comerciais.",
        badge: "operacional",
        whoUses: "Comercial, pricing, controladoria e gestão.",
        whereToAccess: "Menu lateral > Formação de Preço.",
        permissions:
          "Permissões amigáveis: simular preço, gerar tabelas e publicar tabelas (pricing.simulate, pricing.generate_tables, pricing.publish_tables).",
        features: [
          "Modo UNIT para simulação unitária.",
          "Modo BATCH para processamento em lote.",
          "Tabelas comerciais ATACADO, VAREJO_1, VAREJO_2 e VAREJO_3.",
          "Controle por permissões para simulação, geração e publicação.",
        ],
        basicFlow: [
          "Abra Formação de Preço.",
          "Escolha UNIT ou BATCH.",
          "Configure premissas comerciais e execute a simulação.",
          "Se autorizado, gere tabelas de preço.",
          "Se autorizado, publique a tabela para uso comercial.",
        ],
        importantFields: ["Modo (UNIT/BATCH)", "Tabela alvo", "Margem", "Resultado da simulação"],
        businessRules: [
          "Somente perfis com permissão podem simular, gerar ou publicar tabelas.",
          "Tabelas devem seguir a política comercial vigente da empresa.",
        ],
        commonErrors: [
          "Tentar publicar tabela sem permissão de publicação.",
          "Misturar cenário de UNIT com decisão de lote sem validação.",
        ],
        examples: [
          "Gerar VAREJO_2 para canal específico e publicar após aprovação da gestão.",
        ],
        securityNotes: [
          "Permissões de preço devem ser restritas devido ao impacto financeiro direto.",
        ],
        notes: [
          "Valide engenharia e custos antes de fechar qualquer tabela comercial.",
        ],
        relatedModules: ["Produtos", "Propostas", "Clientes", "CRM Comercial"],
        relatedAnchors: ["engenharia", "integracao-nomus"],
        tags: ["precificacao", "tabelas", "atacado", "varejo"],
        alerts: [
          {
            type: "permission",
            text: "Simular, gerar e publicar tabelas são ações distintas de permissão.",
          },
        ],
      },
      {
        anchor: "comercial-propostas-pedidos-clientes",
        title: "Propostas, pedidos de venda, clientes e CRM",
        objective:
          "Gerir ciclo comercial desde o cadastro do cliente até proposta aprovada e pedido interno.",
        badge: "operacional",
        whoUses: "Equipe comercial, coordenação de vendas e pós-venda interno.",
        whereToAccess:
          "Menu lateral > Clientes, CRM Comercial, Propostas e Pedidos de venda.",
        permissions: "Acesso comercial conforme perfil e responsabilidade da carteira.",
        features: [
          "Cadastro e manutenção de clientes.",
          "Acompanhamento comercial no CRM.",
          "Emissão e gestão de propostas.",
          "Geração de pedido de venda interno a partir de proposta aprovada.",
        ],
        basicFlow: [
          "Cadastre ou atualize o cliente.",
          "Conduza relacionamento e oportunidades no CRM Comercial.",
          "Gere e negocie a proposta.",
          "Ao aprovar, acompanhe a criação do pedido de venda interno.",
          "Monitore o pedido até o fechamento do fluxo interno.",
        ],
        importantFields: ["Cliente", "Status da proposta", "Valor negociado", "Status do pedido"],
        businessRules: [
          "Pedido de venda nasce internamente a partir de proposta aprovada.",
          "Envio de pedido para Nomus via POST está em implantação.",
        ],
        commonErrors: [
          "Considerar o envio ao Nomus como automático em todos os cenários.",
          "Aprovar proposta sem validar preço e condições comerciais.",
        ],
        examples: [
          "Proposta aprovada gera pedido interno; integração externa depende do estágio de implantação.",
        ],
        securityNotes: [
          "Dados de clientes e negociações devem respeitar política de privacidade interna.",
        ],
        notes: [
          "Marcação operacional: envio de pedido para Nomus está em implantação no momento.",
        ],
        relatedModules: ["Formação de Preço", "Dashboard", "Relatórios", "Integração Nomus"],
        relatedAnchors: ["integracao-nomus", "dashboard", "indicadores-relatorios"],
        tags: ["propostas", "pedidos", "clientes", "crm"],
        statusNote: "Envio de pedidos de venda ao Nomus está em implantação.",
        alerts: [
          {
            type: "attention",
            text: "Pedido interno funciona hoje; integração de envio ao Nomus ainda está em implantação.",
          },
        ],
      },
    ],
  },
  {
    anchor: "integracao-nomus",
    title: "Integração Nomus",
    intro:
      "Consolida a sincronização de dados entre IndusCost e Nomus nas áreas que dependem de integração.",
    badge: "integracao",
    entries: [
      {
        anchor: "integracao-nomus-visao",
        title: "Sincronizações com Nomus",
        objective:
          "Acompanhar e validar dados sincronizados para manter consistência entre sistemas.",
        badge: "integracao",
        whoUses: "Administração do sistema, engenharia e financeiro.",
        whereToAccess: "Menu lateral > Configurações > nomusSync.",
        permissions: "Perfil com acesso à configuração de sincronização Nomus.",
        features: [
          "Área dedicada de sincronização Nomus no hub de Configurações.",
          "Base para atualização de produtos, clientes e financeiro conforme integração ativa.",
          "Suporte operacional para conciliação com módulos consumidores.",
        ],
        basicFlow: [
          "Acesse Configurações e abra nomusSync.",
          "Verifique estado das sincronizações executadas.",
          "Revise impactos em Produtos, Clientes e Financeiro.",
          "Trate divergências operacionais pela rotina da equipe responsável.",
        ],
        importantFields: ["Status de sincronização", "Data/hora", "Módulo impactado"],
        businessRules: [
          "Dados sincronizados devem ser conferidos no módulo funcional de destino.",
          "Falhas de integração exigem revisão antes de decisões comerciais/financeiras.",
        ],
        commonErrors: [
          "Usar dados sem confirmar sincronização recente.",
          "Ajustar manualmente em módulo destino sem avaliar origem da divergência.",
        ],
        examples: [
          "Após sincronização financeira, validar títulos em Financeiro.",
          "Após sincronização de produtos, revisar manutenção em Produtos.",
        ],
        securityNotes: [
          "Acesso a integração deve ficar restrito a perfis administrativos.",
        ],
        notes: [
          "A integração é operacionalmente crítica para consistência entre áreas.",
        ],
        relatedModules: ["Produtos", "Financeiro", "Clientes", "Configurações"],
        relatedAnchors: ["manutencao-nomus", "financeiro", "configuracoes"],
        tags: ["nomus", "sincronizacao", "integracao"],
        alerts: [
          {
            type: "attention",
            text: "Sempre valide no módulo destino antes de concluir que a sincronização foi suficiente.",
          },
        ],
      },
    ],
  },
  {
    anchor: "manutencao-nomus",
    title: "Manutenção Nomus (em Produtos)",
    intro:
      "Área especializada dentro de Produtos para manutenção e diagnóstico da engenharia ligada ao Nomus.",
    badge: "integracao",
    entries: [
      {
        anchor: "manutencao-nomus-subabas",
        title: "Subabas da Manutenção Nomus",
        objective:
          "Corrigir pendências e validar engenharia integrada com apoio de análises direcionadas.",
        badge: "integracao",
        whoUses: "Engenharia de produto e responsáveis pela integração.",
        whereToAccess: "Menu lateral > Produtos > aba Manutenção Nomus.",
        permissions: "Acesso ao módulo Produtos com permissão de manutenção de integração.",
        features: [
          "Subabas: Visão Geral, Pendências, BOM efetiva, Impacto de custo, Plano de aplicação, Importar produto, Eng. Nomus avançado e Diagnóstico técnico.",
          "Visão consolidada para identificar inconsistências de engenharia.",
          "Apoio ao planejamento de aplicação de correções.",
        ],
        basicFlow: [
          "Abra Produtos e entre na aba Manutenção Nomus.",
          "Use Visão Geral e Pendências para priorizar correções.",
          "Valide BOM efetiva e Impacto de custo.",
          "Monte o Plano de aplicação.",
          "Quando necessário, use Importar produto, Eng. Nomus avançado e Diagnóstico técnico.",
        ],
        importantFields: ["Pendência", "BOM efetiva", "Impacto de custo", "Plano de aplicação"],
        businessRules: [
          "Correções devem ser avaliadas por impacto de custo antes de aplicação.",
          "Diagnóstico técnico orienta tratativas de consistência de engenharia.",
        ],
        commonErrors: [
          "Aplicar correções sem revisar impacto de custo.",
          "Importar produto sem validar pendências prévias.",
        ],
        examples: [
          "Resolver pendência de estrutura, revisar impacto e só então aplicar plano.",
        ],
        securityNotes: [
          "Alterações de manutenção devem seguir governança de aprovação técnica.",
        ],
        notes: [
          "Manutenção Nomus está no módulo Produtos; não confundir com Manutenção Predial do menu lateral.",
        ],
        relatedModules: ["Produtos", "Integração Nomus", "Formação de Preço"],
        relatedAnchors: ["integracao-nomus", "cadastros", "engenharia"],
        tags: ["manutencao-nomus", "bom-efetiva", "diagnostico"],
        alerts: [
          {
            type: "attention",
            text: "Este item pertence à Engenharia em Produtos, não ao módulo Manutenção Predial.",
          },
        ],
      },
    ],
  },
  {
    anchor: "financeiro",
    title: "Financeiro",
    intro:
      "Módulo financeiro com foco em contas a receber e contas a pagar sincronizados do Nomus.",
    badge: "financeiro",
    entries: [
      {
        anchor: "financeiro-contas-sincronizadas",
        title: "Contas a receber e a pagar",
        objective: "Conferir títulos financeiros vindos da sincronização com Nomus.",
        badge: "financeiro",
        whoUses: "Financeiro, controladoria e gestão administrativa.",
        whereToAccess: "Menu lateral > Financeiro.",
        permissions: "Acesso ao módulo Financeiro conforme perfil do time financeiro.",
        features: [
          "Visão de contas a receber sincronizadas do Nomus.",
          "Visão de contas a pagar sincronizadas do Nomus.",
          "Base para acompanhamento de obrigações e recebimentos.",
        ],
        basicFlow: [
          "Abra Financeiro.",
          "Consulte contas a receber.",
          "Consulte contas a pagar.",
          "Se houver divergência, confirme status da integração Nomus.",
        ],
        importantFields: ["Tipo de conta", "Valor", "Vencimento", "Situação"],
        businessRules: [
          "Dados financeiros exibidos dependem da sincronização ativa com Nomus.",
          "Conciliação deve considerar atualização mais recente.",
        ],
        commonErrors: [
          "Tratar ausência de título como erro sem verificar sincronização.",
          "Tomar decisão de caixa sem revisar data de atualização.",
        ],
        examples: [
          "Validar títulos a pagar do dia após rotina de sincronização.",
        ],
        securityNotes: [
          "Dados financeiros são sensíveis e devem ficar restritos ao time autorizado.",
        ],
        notes: [
          "A origem operacional dos dados é a integração com Nomus.",
        ],
        relatedModules: ["Integração Nomus", "Relatórios", "Dashboard"],
        relatedAnchors: ["integracao-nomus", "indicadores-relatorios", "dashboard"],
        tags: ["financeiro", "contas-a-receber", "contas-a-pagar"],
        alerts: [
          {
            type: "tip",
            text: "Antes de fechar análise financeira, confirme a última sincronização com Nomus.",
          },
        ],
      },
    ],
  },
  {
    anchor: "gestao-frota",
    title: "Gestão de Frota",
    intro:
      "Gestão completa de veículos, motoristas, reservas, solicitações por QR e manutenção da frota.",
    badge: "frota",
    entries: [
      {
        anchor: "frota-navegacao-principal",
        title: "Navegação e operação interna da frota",
        objective:
          "Operar reservas e controle de uso dos veículos com visão de manutenção e governança.",
        badge: "frota",
        whoUses: "Gestores de frota, administrativo de transporte e motoristas internos.",
        whereToAccess: "Menu lateral > Gestão de Frota.",
        permissions: "Acesso às telas da frota conforme perfil.",
        features: [
          "Navegação principal: Visão Geral, Veículos, Motoristas, Reservas, Solicitações QR, Checklists, Manutenção e Configurações.",
          "Abas Avançado (financeiras): Relatórios, Custos e Ocorrências.",
          "Rota /fleet/field para uso móvel em campo.",
        ],
        basicFlow: [
          "Acesse Gestão de Frota.",
          "Cadastre e mantenha veículos e motoristas.",
          "Acompanhe Reservas e Solicitações QR.",
          "Monitore Checklists e Manutenção.",
          "Use /fleet/field para operação em campo quando necessário.",
        ],
        importantFields: ["Veículo", "Motorista", "Período de reserva", "Checklist", "Ocorrência"],
        businessRules: [
          "Abas financeiras em Avançado dependem de permissão canFinancial.",
          "Operação em campo deve seguir fluxo de check-in/check-out.",
        ],
        commonErrors: [
          "Tentar abrir abas financeiras sem perfil canFinancial.",
          "Liberar uso de veículo sem checklist adequado.",
        ],
        examples: [
          "Gestor usa Reservas e Solicitações QR para aprovações diárias.",
          "Equipe de campo registra checklist pela rota móvel.",
        ],
        securityNotes: [
          "Controle de acesso da frota deve respeitar segregação entre operação e financeiro.",
        ],
        notes: [
          "As abas financeiras do grupo Avançado exigem permissão específica canFinancial.",
        ],
        relatedModules: ["frota-reserva-publica", "frota-checklist-qr", "configuracoes"],
        relatedAnchors: ["frota-reserva-publica", "frota-checklist-qr", "configuracoes"],
        tags: ["frota", "reservas", "checklists", "field"],
        statusNote: "Abas Avançado financeiras visíveis somente com canFinancial.",
        alerts: [
          {
            type: "permission",
            text: "Relatórios, Custos e Ocorrências (Avançado) exigem permissão canFinancial.",
          },
        ],
      },
    ],
  },
  {
    anchor: "frota-reserva-publica",
    title: "Frota - reserva pública",
    intro:
      "Permite solicitação pública de reserva por QR/link, com aprovação interna posterior.",
    badge: "frota",
    entries: [
      {
        anchor: "frota-reserva-qr-publico",
        title: "Reserva por QR público",
        objective:
          "Receber solicitações de reserva de veículo sem login, mantendo aprovação e controle pela equipe interna.",
        badge: "frota",
        whoUses: "Solicitantes externos autorizados e equipe interna de aprovação.",
        whereToAccess:
          "Público via QR/link de reserva; gestão interna em Gestão de Frota > Solicitações QR e Reservas.",
        permissions:
          "Abertura do canal público depende de configuração da frota por perfil autorizado.",
        features: [
          "Formulário público para solicitação de reserva.",
          "Triagem e aprovação interna de solicitações QR.",
          "Conversão da solicitação aprovada em reserva operacional.",
        ],
        basicFlow: [
          "Administrador disponibiliza QR/link público.",
          "Solicitante envia dados e período no formulário público.",
          "Equipe interna avalia em Solicitações QR.",
          "Após aprovação, reserva segue no fluxo normal da frota.",
        ],
        importantFields: ["Solicitante", "Documento", "Período", "Veículo solicitado", "Status da solicitação"],
        businessRules: [
          "Canal público não substitui aprovação interna.",
          "Somente solicitações aprovadas devem virar reserva.",
        ],
        commonErrors: [
          "Divulgar link público sem controle interno.",
          "Aprovar solicitação sem validar disponibilidade do veículo.",
        ],
        examples: [
          "Visitante autorizado solicita reserva e aguarda aprovação da gestão de frota.",
        ],
        securityNotes: [
          "Controle a divulgação de links/QR públicos para evitar uso indevido.",
        ],
        notes: [
          "Este fluxo é público na entrada e interno na aprovação.",
        ],
        relatedModules: ["Gestão de Frota", "frota-checklist-qr", "configuracoes"],
        relatedAnchors: ["gestao-frota", "frota-checklist-qr", "configuracoes"],
        tags: ["frota", "qr-publico", "reserva"],
        alerts: [
          {
            type: "attention",
            text: "Link público deve ser tratado como informação sensível e compartilhado com critério.",
          },
        ],
      },
    ],
  },
  {
    anchor: "frota-checklist-qr",
    title: "Frota - checklist QR",
    intro:
      "Fluxo de retirada e devolução do veículo com checklist via QR para rastreabilidade operacional.",
    badge: "frota",
    entries: [
      {
        anchor: "frota-checklist-operacao",
        title: "Check-in e check-out por QR",
        objective:
          "Garantir controle de condições do veículo no início e fim do uso.",
        badge: "frota",
        whoUses: "Motoristas e equipe gestora da frota.",
        whereToAccess:
          "QR do veículo para uso operacional; acompanhamento interno em Gestão de Frota > Checklists.",
        permissions: "Uso operacional conforme política da frota e reserva aprovada.",
        features: [
          "Checklist de retirada (check-in).",
          "Checklist de devolução (check-out).",
          "Registro de ocorrências e avarias para acompanhamento.",
        ],
        basicFlow: [
          "Motorista autorizado realiza check-in pelo QR do veículo.",
          "Sistema registra condição inicial e libera uso conforme regras.",
          "Na devolução, motorista realiza check-out pelo QR.",
          "Equipe interna acompanha eventuais avarias em Checklists.",
        ],
        importantFields: ["Reserva", "Veículo", "Motorista", "Check-in", "Check-out", "Observações de avaria"],
        businessRules: [
          "Checklist deve representar o estado real do veículo.",
          "Check-in e check-out fecham o ciclo operacional da reserva.",
        ],
        commonErrors: [
          "Não registrar checklist completo na devolução.",
          "Registrar check-in sem motorista autorizado.",
        ],
        examples: [
          "Motorista retira veículo com check-in e devolve ao fim do período com check-out.",
        ],
        securityNotes: [
          "QR fixo do veículo não deve ser adulterado nem compartilhado fora do processo.",
        ],
        notes: [
          "Rastreabilidade do checklist apoia manutenção preventiva e gestão de ocorrências.",
        ],
        relatedModules: ["Gestão de Frota", "frota-reserva-publica", "configuracoes"],
        relatedAnchors: ["gestao-frota", "frota-reserva-publica"],
        tags: ["checklist", "checkin", "checkout", "qr"],
        alerts: [
          {
            type: "common-error",
            text: "Ausência de check-out dificulta controle de uso e condição do veículo.",
          },
        ],
      },
    ],
  },
  {
    anchor: "cadastros",
    title: "Cadastros operacionais",
    intro:
      "Base de dados para custeio e operação: pessoas/RH, máquinas, suprimentos, compras e manutenção predial.",
    badge: "operacional",
    entries: [
      {
        anchor: "cadastros-base-operacao",
        title: "Cadastros que alimentam custo e operação",
        objective: "Manter consistência dos dados mestres usados nos demais módulos.",
        badge: "operacional",
        whoUses: "RH, engenharia, suprimentos, compras e facilities.",
        whereToAccess:
          "Menu lateral > Pessoas/RH, Máquinas, Suprimentos, Compras e Manutenção Predial.",
        permissions: "Permissões por módulo conforme perfil de cada área.",
        features: [
          "Pessoas/RH para base de mão de obra.",
          "Máquinas para base operacional de equipamentos.",
          "Suprimentos para materiais e insumos.",
          "Compras para demandas de aquisição.",
          "Manutenção Predial para gestão de facilities.",
        ],
        basicFlow: [
          "Atualize cadastros de Pessoas/RH, Máquinas e Suprimentos.",
          "Registre demandas em Compras conforme necessidade da operação.",
          "Acompanhe rotinas de Manutenção Predial para infraestrutura.",
          "Revalide impacto em Engenharia, Simulações e Comercial.",
        ],
        importantFields: ["Código", "Descrição", "Status", "Classificação", "Responsável"],
        businessRules: [
          "Cadastros desatualizados geram distorção em custos e planejamento.",
          "Manutenção Predial é módulo de facilities do sidebar e não corresponde à Manutenção Nomus.",
        ],
        commonErrors: [
          "Confundir Manutenção Predial com manutenção de integração da engenharia.",
          "Ignorar atualização de suprimentos antes de simular preço.",
        ],
        examples: [
          "Ajustar cadastro de máquina e refletir revisão em custo de produto.",
        ],
        securityNotes: [
          "Controle de edição deve seguir responsabilidade de cada área funcional.",
        ],
        notes: [
          "Compras e Manutenção Predial têm objetivos operacionais distintos dentro do menu.",
        ],
        relatedModules: ["Engenharia", "Simulações", "Formação de Preço", "manutencao-nomus"],
        relatedAnchors: ["engenharia", "simulacoes", "comercial-precificacao", "manutencao-nomus"],
        tags: ["cadastros", "rh", "maquinas", "suprimentos", "compras", "facilities"],
        alerts: [
          {
            type: "attention",
            text: "No menu lateral, Manutenção Predial é facilities; manutenção de integração fica em Produtos.",
          },
        ],
      },
    ],
  },
  {
    anchor: "simulacoes",
    title: "Simulações",
    intro:
      "Ambiente para testar cenários de custo e comercial antes de consolidar decisões.",
    badge: "operacional",
    entries: [
      {
        anchor: "simulacoes-cenarios-negocio",
        title: "Simulação de cenários",
        objective:
          "Avaliar impactos de premissas em custo e preço sem comprometer imediatamente o fluxo operacional.",
        badge: "operacional",
        whoUses: "Custos, comercial, engenharia e gestão.",
        whereToAccess: "Menu lateral > Simulações.",
        permissions: "Acesso ao módulo Simulações conforme perfil.",
        features: [
          "Análise de cenários com foco em decisão.",
          "Apoio para validação prévia de premissas.",
        ],
        basicFlow: [
          "Acesse Simulações.",
          "Defina cenário com premissas relevantes.",
          "Compare resultados com base atual.",
          "Leve cenário validado para decisão em preço ou engenharia.",
        ],
        importantFields: ["Premissas", "Resultado comparativo", "Cenário salvo"],
        businessRules: [
          "Simulação é apoio à decisão; validação final ocorre nos módulos operacionais.",
        ],
        commonErrors: [
          "Usar cenário não validado como regra definitiva de preço.",
        ],
        examples: [
          "Simular variação de custo antes de atualizar tabela comercial.",
        ],
        securityNotes: [
          "Cenários estratégicos devem ser restritos a perfis de decisão.",
        ],
        notes: [
          "Resultados devem ser confrontados com Engenharia e Formação de Preço.",
        ],
        relatedModules: ["Engenharia", "Formação de Preço", "Relatórios"],
        relatedAnchors: ["engenharia", "comercial-precificacao", "indicadores-relatorios"],
        tags: ["simulacoes", "cenario", "analise"],
        alerts: [
          {
            type: "tip",
            text: "Use simulações para antecipar impacto antes de publicar preços.",
          },
        ],
      },
    ],
  },
  {
    anchor: "indicadores-relatorios",
    title: "Indicadores e relatórios",
    intro:
      "Consolida análises operacionais e gerenciais para acompanhar desempenho do negócio.",
    badge: "operacional",
    entries: [
      {
        anchor: "indicadores-relatorios-uso",
        title: "Leitura analítica do negócio",
        objective:
          "Acompanhar performance por indicadores e relatórios para apoiar decisões táticas e estratégicas.",
        badge: "operacional",
        whoUses: "Gestão, comercial, custos e controladoria.",
        whereToAccess: "Menu lateral > Relatórios (e indicadores contextuais dos módulos).",
        permissions: "Acesso de leitura analítica conforme perfil.",
        features: [
          "Relatórios para acompanhamento de resultado e operação.",
          "Indicadores por contexto de módulo, quando disponíveis.",
          "Apoio à comparação entre períodos e carteiras.",
        ],
        basicFlow: [
          "Abra Relatórios.",
          "Defina recortes de análise conforme necessidade.",
          "Cruze resultados com Dashboard e Comercial.",
          "Compartilhe conclusões com as áreas responsáveis.",
        ],
        importantFields: ["Período", "Recorte analítico", "Métrica principal", "Comparativo"],
        businessRules: [
          "Análise deve considerar contexto de período e origem dos dados.",
        ],
        commonErrors: [
          "Comparar períodos sem padronizar recorte.",
          "Interpretar indicador fora do contexto do módulo de origem.",
        ],
        examples: [
          "Analisar evolução comercial e confrontar com funil do Dashboard.",
        ],
        securityNotes: [
          "Relatórios com dados comerciais/financeiros exigem compartilhamento controlado.",
        ],
        notes: [
          "A qualidade da análise depende da consistência dos módulos alimentadores.",
        ],
        relatedModules: ["Dashboard", "Comercial e precificação", "Financeiro", "Engenharia"],
        relatedAnchors: ["dashboard", "comercial-precificacao", "financeiro", "engenharia"],
        tags: ["relatorios", "indicadores", "analise"],
        alerts: [
          {
            type: "attention",
            text: "Sempre valide o período e o contexto antes de comparar indicadores.",
          },
        ],
      },
    ],
  },
  {
    anchor: "administracao",
    title: "Administração",
    intro:
      "Área administrativa para gestão de acesso, perfis e governança de uso do sistema.",
    badge: "administrativo",
    entries: [
      {
        anchor: "administracao-usuarios-perfis",
        title: "Usuários e perfis de acesso",
        objective:
          "Garantir que cada pessoa tenha apenas as permissões necessárias para sua função.",
        badge: "administrativo",
        whoUses: "Administradores do sistema e liderança responsável por acessos.",
        whereToAccess: "Menu lateral > Configurações > security.",
        permissions: "Perfil administrativo com gestão de usuários e perfis.",
        features: [
          "Gestão de usuários ativos no sistema.",
          "Gestão de perfis de acesso por função.",
          "Controle de permissões para módulos críticos (preço, financeiro, integração, frota avançada).",
        ],
        basicFlow: [
          "Acesse Configurações > security.",
          "Cadastre ou ajuste usuário.",
          "Associe perfil de acesso adequado.",
          "Revise permissões especiais conforme necessidade.",
        ],
        importantFields: ["Usuário", "Perfil", "Permissões especiais", "Status de acesso"],
        businessRules: [
          "Permissões devem seguir princípio de menor privilégio.",
          "Acesso financeiro e de publicação de preços exige controle reforçado.",
        ],
        commonErrors: [
          "Conceder perfil amplo sem necessidade operacional.",
          "Não revisar permissões após mudança de função.",
        ],
        examples: [
          "Conceder canFinancial apenas para responsáveis por análise financeira da frota.",
        ],
        securityNotes: [
          "Realize auditoria periódica de acessos e perfis.",
        ],
        notes: [
          "A gestão de acessos centraliza segurança operacional do IndusCost.",
        ],
        relatedModules: ["configuracoes", "gestao-frota", "comercial-precificacao", "financeiro"],
        relatedAnchors: ["configuracoes", "gestao-frota", "comercial-precificacao", "financeiro"],
        tags: ["administracao", "usuarios", "permissoes", "seguranca"],
        alerts: [
          {
            type: "permission",
            text: "Atribua permissões especiais somente quando houver justificativa de negócio.",
          },
        ],
      },
    ],
  },
  {
    anchor: "configuracoes",
    title: "Configurações",
    intro:
      "Hub central de parâmetros e governança do sistema, com áreas ativas e áreas futuras sinalizadas.",
    badge: "administrativo",
    entries: [
      {
        anchor: "configuracoes-hub-central",
        title: "Hub de Configurações",
        objective:
          "Centralizar parâmetros globais, identidade, operação, sincronização e segurança do sistema.",
        badge: "administrativo",
        whoUses: "Administração do sistema e responsáveis de cada área.",
        whereToAccess: "Menu lateral > Configurações.",
        permissions: "Perfil administrativo conforme seção do hub.",
        features: [
          "Seções do hub: globals, branding, operational, nomusSync, priceTables, integrations (future), security e system (future).",
          "Configuração de sincronização com Nomus em nomusSync.",
          "Configuração de tabelas comerciais em priceTables.",
          "Gestão de usuários e perfis em security.",
        ],
        basicFlow: [
          "Abra Configurações.",
          "Entre na seção desejada do hub.",
          "Revise e ajuste parâmetros conforme governança interna.",
          "Valide impacto nos módulos consumidores.",
        ],
        importantFields: ["Seção do hub", "Parâmetro", "Valor atual", "Responsável pela alteração"],
        businessRules: [
          "Mudanças em globals e operational podem impactar múltiplos módulos.",
          "integrations é área futura no momento.",
          "system é área futura no momento.",
        ],
        commonErrors: [
          "Tratar sections futuras como funcionalidades já disponíveis.",
          "Alterar parâmetros sem validação prévia das áreas afetadas.",
        ],
        examples: [
          "Ajustar priceTables para alinhar governança de tabelas comerciais.",
        ],
        securityNotes: [
          "Configurações críticas devem ter controle de acesso e rastreabilidade de alteração.",
        ],
        notes: [
          "Sinalizações de futuro evitam uso indevido de funcionalidades ainda não liberadas.",
        ],
        relatedModules: ["integracao-nomus", "administracao", "comercial-precificacao"],
        relatedAnchors: ["integracao-nomus", "administracao", "comercial-precificacao"],
        tags: ["configuracoes", "hub", "globals", "nomusSync", "security"],
        statusNote: "integrations e system permanecem como áreas futuras no hub.",
        alerts: [
          {
            type: "attention",
            text: "As seções integrations e system estão marcadas como future e não devem ser tratadas como ativas.",
          },
        ],
      },
    ],
  },
  {
    anchor: "perguntas-frequentes",
    title: "Perguntas frequentes",
    intro:
      "Respostas rápidas para dúvidas recorrentes de operação e interpretação de regras.",
    badge: "operacional",
    entries: [
      {
        anchor: "faq-principal",
        title: "Dúvidas recorrentes do dia a dia",
        objective: "Reduzir retrabalho com respostas padronizadas para temas críticos.",
        badge: "operacional",
        whoUses: "Todos os usuários do sistema.",
        whereToAccess: "Menu lateral > Guia do Sistema > Perguntas frequentes.",
        permissions: "Acesso ao Guia do Sistema.",
        features: [
          "Explicações objetivas sobre custo, comercial, integração e frota.",
          "Direcionamento para módulos relacionados.",
        ],
        basicFlow: [
          "Abra Perguntas frequentes no guia.",
          "Localize a dúvida por busca ou leitura dos tópicos.",
          "Acesse o módulo relacionado para aplicar a orientação.",
        ],
        importantFields: ["Pergunta", "Resposta", "Módulo relacionado"],
        businessRules: [
          "FAQ complementa o manual e não substitui regras da tela.",
        ],
        commonErrors: [
          "Aplicar resposta genérica sem considerar contexto do módulo.",
        ],
        examples: [
          "Pergunta: CIU está duplicado? Resposta: não, cards decompõem custo já representado na BOM.",
          "Pergunta: pedido vai para Nomus automaticamente? Resposta: envio está em implantação.",
        ],
        securityNotes: [
          "Quando houver tema sensível de acesso, seguir também política de segurança interna.",
        ],
        notes: [
          "Use o glossário para termos técnicos antes de abrir chamado interno.",
        ],
        relatedModules: ["engenharia", "comercial-precificacao", "integracao-nomus", "glossario"],
        relatedAnchors: ["engenharia", "comercial-precificacao", "integracao-nomus", "glossario"],
        tags: ["faq", "duvidas", "suporte"],
        alerts: [
          {
            type: "tip",
            text: "Se a dúvida persistir após o FAQ, envolva o responsável do módulo correspondente.",
          },
        ],
      },
    ],
  },
  {
    anchor: "glossario",
    title: "Glossário",
    intro:
      "Consulta rápida de siglas e termos de negócio usados no IndusCost.",
    badge: "operacional",
    entries: [
      {
        anchor: "glossario-consulta",
        title: "Termos e siglas do sistema",
        objective:
          "Direcionar o usuário para o componente de glossário com definições padronizadas.",
        badge: "operacional",
        whoUses: "Todos os usuários, especialmente em onboarding.",
        whereToAccess: "Menu lateral > Guia do Sistema > Glossário.",
        permissions: "Acesso ao Guia do Sistema.",
        features: [
          "Lista de termos e siglas relevantes do sistema.",
          "Definições de referência para alinhamento entre áreas.",
        ],
        basicFlow: [
          "Abra a seção Glossário no Guia do Sistema.",
          "Procure o termo desejado.",
          "Retorne ao módulo de origem com a definição validada.",
        ],
        importantFields: ["Termo", "Definição", "Relacionamentos"],
        businessRules: [
          "As definições do glossário devem ser utilizadas como referência padrão interna.",
        ],
        commonErrors: [
          "Usar interpretações informais sem consultar a definição oficial.",
        ],
        examples: [
          "Consultar CIU, CIF, BOM e conversão antes de discutir custo com o comercial.",
        ],
        securityNotes: [
          "Glossário não deve expor dados sensíveis, apenas conceitos de negócio.",
        ],
        notes: [
          "Entrada única desta seção aponta para o componente dedicado de glossário.",
        ],
        relatedModules: ["Guia do Sistema"],
        relatedAnchors: ["perguntas-frequentes"],
        tags: ["glossario", "termos", "siglas"],
        alerts: [
          {
            type: "tip",
            text: "Use o glossário sempre que surgir ambiguidade de terminologia entre áreas.",
          },
        ],
      },
    ],
  },
];
