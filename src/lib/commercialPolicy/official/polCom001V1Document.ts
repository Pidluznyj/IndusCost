/** Conteúdo extraído do documento oficial POL-COM-001 v1.0. Não reescrever. */
export type OfficialPolicyBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "bullet"; text: string }
  | { type: "term"; term: string; definition: string };

export type OfficialPolicyChapter = {
  id: string;
  title: string;
  blocks: OfficialPolicyBlock[];
};

export const POL_COM_001_CHAPTERS: OfficialPolicyChapter[] = [
  {
    "id": "capa",
    "title": "Capa",
    "blocks": [
      {
        "type": "paragraph",
        "text": "POLÍTICA COMERCIAL E DE"
      },
      {
        "type": "paragraph",
        "text": "COMISSIONAMENTO"
      },
      {
        "type": "paragraph",
        "text": "Regras de Comissão de Vendas, Alçadas Comerciais, Campanhas, Carteiras, Coberturas e Supervisão"
      },
      {
        "type": "paragraph",
        "text": "Código"
      },
      {
        "type": "paragraph",
        "text": "POL-COM-001"
      },
      {
        "type": "paragraph",
        "text": "Versão"
      },
      {
        "type": "paragraph",
        "text": "1.0"
      },
      {
        "type": "paragraph",
        "text": "Classificação"
      },
      {
        "type": "paragraph",
        "text": "POLÍTICA OFICIAL — USO INTERNO E RESTRITO"
      },
      {
        "type": "paragraph",
        "text": "Área responsável"
      },
      {
        "type": "paragraph",
        "text": "Comercial / Administração"
      },
      {
        "type": "paragraph",
        "text": "Aprovador"
      },
      {
        "type": "paragraph",
        "text": "Diretoria"
      },
      {
        "type": "paragraph",
        "text": "Data de aprovação"
      },
      {
        "type": "paragraph",
        "text": "____/____/________"
      },
      {
        "type": "paragraph",
        "text": "Data de vigência"
      },
      {
        "type": "paragraph",
        "text": "____/____/________"
      },
      {
        "type": "paragraph",
        "text": "Empresa / CNPJ"
      },
      {
        "type": "paragraph",
        "text": "14.055.501/0001-80 Koppetel Comercio de Plásticos LTDA"
      },
      {
        "type": "paragraph",
        "text": "Esta Política consolida as regras corporativas de gestão comercial e comissionamento aplicáveis às funções abrangidas, com critérios objetivos de carteira, cobertura, atribuição de vendas, margem, cálculo, registro, conferência e revisão. Sua aplicação observará a legislação, os instrumentos contratuais e as normas aplicáveis."
      }
    ]
  },
  {
    "id": "1-objetivo",
    "title": "1. OBJETIVO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Estabelecer critérios uniformes, objetivos, prospectivos, verificáveis e auditáveis para a organização comercial, a responsabilidade por clientes e oportunidades, a cobertura temporária, a atribuição de vendas, a apuração de comissões, a remuneração variável do Supervisor Comercial, as alçadas de margem, as campanhas comerciais, a rastreabilidade e a solução de divergências."
      },
      {
        "type": "paragraph",
        "text": "A finalidade desta Política é assegurar continuidade do atendimento ao cliente, previsibilidade na aplicação das regras, tratamento uniforme das situações equivalentes e capacidade de reconstruir, posteriormente, os elementos objetivos de cada operação."
      }
    ]
  },
  {
    "id": "2-abrangencia",
    "title": "2. ABRANGÊNCIA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Esta Política aplica-se às pessoas formalmente abrangidas pela estrutura comercial da empresa e elegíveis às regras aqui estabelecidas, incluindo Vendedores, Executivos de Contas, Consultores Comerciais, funções equivalentes de venda e a Supervisão Comercial, conforme suas atribuições."
      },
      {
        "type": "paragraph",
        "text": "A Política disciplina critérios e processos comerciais. Condições específicas previstas em instrumentos individuais, normas coletivas, campanhas válidas ou legislação aplicável deverão ser observadas quando incidirem sobre determinada situação."
      }
    ]
  },
  {
    "id": "3-principios",
    "title": "3. PRINCÍPIOS",
    "blocks": [
      {
        "type": "bullet",
        "text": "clientes, leads, oportunidades, propostas, preços, históricos, cadastros, canais e informações comerciais são ativos da empresa;"
      },
      {
        "type": "bullet",
        "text": "a atribuição de cliente ou carteira representa responsabilidade comercial e não propriedade pessoal do cliente;"
      },
      {
        "type": "bullet",
        "text": "a comissão será determinada pela operação específica, pela classificação do cliente, pela Margem Oficial, pela Matriz vigente e pela efetiva atuação comercial registrada;"
      },
      {
        "type": "bullet",
        "text": "a mera digitação, cadastramento, faturamento ou processamento administrativo não define, por si só, a atribuição da comissão;"
      },
      {
        "type": "bullet",
        "text": "a cobertura de ausência tem finalidade de continuidade do atendimento e não constitui, por si só, transferência definitiva de carteira ou penalidade;"
      },
      {
        "type": "bullet",
        "text": "vendas específicas materialmente iniciadas antes de uma cobertura devem ser preservadas, enquanto novas demandas surgidas durante a cobertura seguem as regras da Seção 8;"
      },
      {
        "type": "bullet",
        "text": "o tempo de relacionamento do cliente com a empresa não reduz nem deprecia, por si só, o percentual de comissão;"
      },
      {
        "type": "bullet",
        "text": "campanhas, tabelas e revisões somente produzem efeitos conforme sua vigência formal e não serão utilizadas para reclassificar retroativamente operações já concluídas ou comissões já adquiridas;"
      },
      {
        "type": "bullet",
        "text": "nenhuma comissão já adquirida será utilizada como sanção, multa ou instrumento disciplinar;"
      },
      {
        "type": "bullet",
        "text": "a solução de divergências deverá utilizar registros objetivos, com decisão documentada e instância de revisão quando necessária."
      }
    ]
  },
  {
    "id": "4-definicoes",
    "title": "4. DEFINIÇÕES",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Termo"
      },
      {
        "type": "paragraph",
        "text": "Definição"
      },
      {
        "type": "term",
        "term": "Pedido de Venda (PV)",
        "definition": "Registro operacional da venda no sistema oficial da empresa, contendo cliente, itens, quantidades, preços, condições comerciais, Margem Oficial e responsável registrado. O PV é elemento relevante de prova operacional, mas não substitui a análise dos registros da negociação quando houver divergência de atribuição."
      },
      {
        "type": "term",
        "term": "Item de Venda",
        "definition": "Linha individual de produto constante no Pedido de Venda, considerada separadamente para determinação da margem, percentual e valor da comissão."
      },
      {
        "type": "term",
        "term": "Valor de Venda do Produto",
        "definition": "Preço de venda do produto constante no Item de Venda multiplicado pela quantidade correspondente, conforme os critérios de base definidos nesta Política."
      },
      {
        "type": "term",
        "term": "Margem Oficial",
        "definition": "Percentual de margem do Item de Venda calculado pela metodologia oficial de custos e preços vigente e registrado no sistema no momento da aprovação comercial."
      },
      {
        "type": "term",
        "term": "Matriz Normativa de Comissão",
        "definition": "Tabela vigente, integrante desta Política por meio do Anexo I, que relaciona faixas de Margem Oficial, percentuais de comissão e alçadas."
      },
      {
        "type": "term",
        "term": "Cliente Comercial Comissionável",
        "definition": "Cliente cujas vendas estão sujeitas às regras de comissão desta Política."
      },
      {
        "type": "term",
        "term": "Conta Institucional Não Comissionável",
        "definition": "Conta previamente classificada pela empresa como não sujeita a comissão individual, salvo campanha ou condição específica formalmente vigente."
      },
      {
        "type": "term",
        "term": "Responsável Comercial",
        "definition": "Vendedor designado pela empresa para a gestão ordinária do relacionamento com determinado cliente, carteira ou oportunidade."
      },
      {
        "type": "term",
        "term": "Vendedor de Cobertura",
        "definition": "Vendedor designado para assegurar continuidade de atendimento durante ausência ou indisponibilidade temporária do Responsável Comercial."
      },
      {
        "type": "term",
        "term": "Evento de Cobertura",
        "definition": "Período registrado, programado ou emergencial, em que a empresa ativa atendimento substituto para determinada carteira, cliente ou canal em razão de ausência ou indisponibilidade temporária."
      },
      {
        "type": "term",
        "term": "Operação Específica Materialmente Iniciada",
        "definition": "Negociação concreta, individualizável e comprovável que, antes do início da cobertura, já possua atuação comercial material ou compromisso comercial firme relacionado à venda específica."
      },
      {
        "type": "term",
        "term": "Atividade Comercial Material",
        "definition": "Ato verificável que faça avançar uma operação específica, como proposta, cotação, negociação de preço, quantidade ou prazo, reunião, amostra, homologação, especificação, retorno material do cliente ou outro desenvolvimento efetivo do negócio."
      },
      {
        "type": "term",
        "term": "Nova Demanda em Cobertura",
        "definition": "Demanda ativa ou passiva surgida durante Evento de Cobertura sem Operação Específica Materialmente Iniciada anteriormente."
      },
      {
        "type": "term",
        "term": "Venda Recorrente",
        "definition": "Nova compra de cliente que possui histórico comercial com a empresa. A recorrência, isoladamente, não caracteriza negociação específica anterior."
      },
      {
        "type": "term",
        "term": "Programação Não Firme",
        "definition": "Forecast, previsão, estimativa ou programação indicativa que ainda dependa de confirmação, liberação, quantidade definitiva, pedido ou outro ato para se converter em venda firme."
      },
      {
        "type": "term",
        "term": "Programação Firme",
        "definition": "Compromisso comercial individualizável, formalmente registrado, em que objeto, quantidade ou obrigação de fornecimento estejam suficientemente definidos para vincular comercialmente a execução posterior."
      },
      {
        "type": "term",
        "term": "Canal Institucional",
        "definition": "E-mail geral, WhatsApp corporativo, telefone empresarial, portal, EDI, formulário do site ou outro canal pertencente à empresa."
      },
      {
        "type": "term",
        "term": "Registro Material",
        "definition": "CRM, e-mail, proposta, cotação, WhatsApp corporativo, documento do cliente, ordem de compra, log de sistema ou outro elemento contemporâneo e verificável."
      },
      {
        "type": "term",
        "term": "Cliente em Revisão de Carteira",
        "definition": "Cliente que atingiu o critério temporal de inatividade e deve passar por validação objetiva antes de eventual reatribuição."
      }
    ]
  },
  {
    "id": "5-classificacao-dos-clientes",
    "title": "5. CLASSIFICAÇÃO DOS CLIENTES",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Todo cliente será classificado, para fins desta Política, como Cliente Comercial Comissionável ou Conta Institucional Não Comissionável. A classificação deverá estar registrada no sistema ou cadastro mestre utilizado pela empresa."
      },
      {
        "type": "heading",
        "text": "5.1. Cliente Comercial Comissionável"
      },
      {
        "type": "paragraph",
        "text": "As vendas atribuídas a Vendedor elegível seguirão a Matriz Normativa de Comissão vigente ou, quando aplicável, campanha ou condição específica formalmente aprovada e previamente comunicada."
      },
      {
        "type": "heading",
        "text": "5.2. Conta Institucional Não Comissionável"
      },
      {
        "type": "paragraph",
        "text": "Determinadas contas estratégicas, institucionais, históricas ou submetidas a modelo comercial específico poderão ser classificadas como não comissionáveis, observados os critérios internos e as condições aplicáveis."
      },
      {
        "type": "paragraph",
        "text": "A classificação deverá ser conhecida antes do início de atuação comercial material em nova operação sujeita a essa condição. Oportunidade já materialmente desenvolvida antes de uma nova classificação não será reclassificada retroativamente para eliminar comissão já atribuída ou adquirida."
      },
      {
        "type": "paragraph",
        "text": "A lista oficial de Contas Institucionais Não Comissionáveis será mantida em cadastro controlado pela empresa. Cópias informais, planilhas locais ou mensagens não substituem o cadastro oficial vigente."
      }
    ]
  },
  {
    "id": "6-base-de-calculo-da-comissao",
    "title": "6. BASE DE CÁLCULO DA COMISSÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A comissão será calculada individualmente por Item de Venda."
      },
      {
        "type": "paragraph",
        "text": "A base monetária é o Valor de Venda do Produto constante no Pedido de Venda, conforme parametrização oficial do sistema. Tributos, fretes, serviços acessórios, descontos, abatimentos ou outros componentes somente integrarão a base quando expressamente previstos na regra vigente e refletidos na parametrização oficial."
      },
      {
        "type": "paragraph",
        "text": "A fórmula padrão é: Comissão do Item = Base de Comissão do Item × Percentual de Comissão aplicável ao Item."
      },
      {
        "type": "paragraph",
        "text": "Quando houver mais de um produto no mesmo Pedido de Venda, cada Item de Venda será enquadrado separadamente segundo sua Margem Oficial e o percentual correspondente."
      },
      {
        "type": "paragraph",
        "text": "Alterações posteriores na metodologia de custos ou no custo de referência não recalculam retroativamente a comissão de Pedido de Venda já aprovado, ressalvado erro material comprovado ou alteração efetiva do próprio negócio."
      }
    ]
  },
  {
    "id": "7-margem-oficial-matriz-de-comissao-precificacao-e-alcadas",
    "title": "7. MARGEM OFICIAL, MATRIZ DE COMISSÃO, PRECIFICAÇÃO E ALÇADAS",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A Margem Oficial utilizada para enquadramento será a margem registrada no Item de Venda no momento da aprovação comercial do Pedido de Venda, calculada conforme a metodologia oficial de custos e preços vigente."
      },
      {
        "type": "paragraph",
        "text": "A Matriz Normativa de Comissão e Alçada integra esta Política por meio do Anexo I e constitui a única fonte oficial dos percentuais de comissão por faixa de margem. Tabelas copiadas em mensagens, apresentações, planilhas particulares ou documentos antigos não substituem a versão vigente do Anexo I."
      },
      {
        "type": "paragraph",
        "text": "A Matriz poderá ser revisada ao longo do tempo em razão de custos, condições de mercado, estratégia comercial, rentabilidade, mix de produtos ou outros fatores econômicos relevantes. Toda revisão deverá possuir número de versão, data de aprovação, data de vigência e comunicação formal aos abrangidos antes de produzir efeitos."
      },
      {
        "type": "paragraph",
        "text": "Uma nova versão da Matriz será aplicada prospectivamente conforme sua data de vigência e não reclassificará retroativamente Pedido de Venda já aprovado, comissão já adquirida ou operação protegida pela regra de transição aplicável."
      },
      {
        "type": "paragraph",
        "text": "Venda com Margem Oficial inferior a 35,00% somente poderá ser aprovada mediante a alçada prevista na Matriz. Uma vez regularmente autorizada, a margem inferior não poderá ser utilizada, por si só, para negar a comissão prevista para a operação."
      },
      {
        "type": "paragraph",
        "text": "Para enquadramento em faixa, será considerado o percentual de margem com duas casas decimais, adotando-se arredondamento aritmético convencional conforme parametrização oficial do sistema."
      }
    ]
  },
  {
    "id": "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    "title": "8. VENDAS RECORRENTES, OEM, COBERTURA E CANAIS DE ENTRADA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A atribuição da comissão observará a operação comercial específica e a efetiva atuação registrada, não sendo suficiente, por si só, a mera digitação, cadastro, emissão, faturamento, processamento administrativo ou operacionalização do Pedido de Venda."
      },
      {
        "type": "heading",
        "text": "8.1. Responsável Comercial e carteira"
      },
      {
        "type": "paragraph",
        "text": "Enquanto estiver em atividade e disponível, o Responsável Comercial permanecerá responsável pelo relacionamento e pelas oportunidades de sua carteira, inclusive nas vendas recorrentes e nas demandas recebidas por e-mail geral, WhatsApp corporativo, telefone, portal, EDI, atendimento interno ou outro canal institucional."
      },
      {
        "type": "paragraph",
        "text": "A existência de Responsável Comercial não impede a empresa de assegurar continuidade de atendimento durante sua ausência ou indisponibilidade temporária."
      },
      {
        "type": "paragraph",
        "text": "A carteira constitui atribuição comercial e organizacional da empresa e não se confunde com direito automático à comissão sobre toda e qualquer operação futura realizada por determinado cliente."
      },
      {
        "type": "heading",
        "text": "8.2. Ausência ou indisponibilidade temporária"
      },
      {
        "type": "paragraph",
        "text": "Durante férias, folga, licença, afastamento, atestado, falta, treinamento, viagem ou qualquer outra situação de ausência ou indisponibilidade temporária do Responsável Comercial, a empresa poderá direcionar o atendimento a outro Vendedor para garantir a continuidade do serviço ao cliente."
      },
      {
        "type": "paragraph",
        "text": "Em ausências programadas, o Evento de Cobertura deverá ser registrado antes do início. Em ausências não programadas, o registro deverá ocorrer no mesmo dia útil ou assim que operacionalmente possível, indicando período, Vendedor de Cobertura e carteiras ou canais abrangidos."
      },
      {
        "type": "paragraph",
        "text": "A cobertura:"
      },
      {
        "type": "bullet",
        "text": "não implica transferência definitiva da carteira;"
      },
      {
        "type": "bullet",
        "text": "não retira do Responsável Comercial sua condição de responsável pelo cliente após o retorno, salvo redistribuição formal da empresa;"
      },
      {
        "type": "bullet",
        "text": "não constitui punição ou redução de carteira em razão da ausência;"
      },
      {
        "type": "bullet",
        "text": "não autoriza o Vendedor de Cobertura a prospectar deliberadamente clientes ativos da carteira durante a ausência, salvo orientação expressa da empresa ou regra específica de reativação/prospecção."
      },
      {
        "type": "heading",
        "text": "8.3. Venda já materialmente iniciada antes da ausência"
      },
      {
        "type": "paragraph",
        "text": "Permanecerá atribuída ao Responsável Comercial original a operação que, antes da ausência, já possua negociação específica materialmente iniciada e comprovável."
      },
      {
        "type": "paragraph",
        "text": "Podem demonstrar negociação materialmente iniciada, entre outros:"
      },
      {
        "type": "bullet",
        "text": "proposta comercial ou cotação específica emitida;"
      },
      {
        "type": "bullet",
        "text": "negociação registrada de preço, quantidade, prazo, aplicação ou condição comercial;"
      },
      {
        "type": "bullet",
        "text": "atividade registrada no CRM demonstrando avanço real da operação;"
      },
      {
        "type": "bullet",
        "text": "e-mail ou WhatsApp corporativo que demonstre atuação comercial efetiva sobre aquela operação específica;"
      },
      {
        "type": "bullet",
        "text": "pedido em formação efetivamente tratado e vinculado à negociação;"
      },
      {
        "type": "bullet",
        "text": "projeto, programação firme ou compromisso comercial individualizável relacionado à venda posteriormente formalizada."
      },
      {
        "type": "paragraph",
        "text": "A simples existência de relacionamento histórico com o cliente, tabela de preço previamente negociada, compras anteriores, condição comercial habitual, cadastro de carteira ou mera chegada de mensagem a uma caixa corporativa não caracteriza, isoladamente, negociação específica já materialmente iniciada."
      },
      {
        "type": "heading",
        "text": "8.4. Nova demanda surgida durante a cobertura"
      },
      {
        "type": "paragraph",
        "text": "Quando, durante a ausência ou indisponibilidade do Responsável Comercial, surgir nova demanda comercial que não possua proposta, negociação específica ou oportunidade materialmente iniciada anteriormente, o Vendedor de Cobertura que efetivamente assumir, conduzir e concluir a operação fará jus à atribuição comercial e à comissão correspondente àquela venda, observadas as demais regras desta Política."
      },
      {
        "type": "paragraph",
        "text": "Essa regra aplica-se também a demanda passiva, recompra espontânea, cliente recorrente ou cliente OEM pertencente à carteira do Responsável Comercial ausente."
      },
      {
        "type": "paragraph",
        "text": "Não é necessário que o Vendedor de Cobertura tenha originado o cliente ou realizado prospecção ativa. Uma nova compra poderá ser considerada nova demanda ainda que exija pouca negociação por utilizar preços, especificações ou condições já conhecidas, desde que aquela operação específica não estivesse materialmente iniciada antes da cobertura."
      },
      {
        "type": "paragraph",
        "text": "Considera-se atendimento comercial efetivo, conforme o caso, a atuação material na nova operação, podendo envolver:"
      },
      {
        "type": "bullet",
        "text": "recebimento, entendimento e tratamento da necessidade;"
      },
      {
        "type": "bullet",
        "text": "análise de produto, quantidade, aplicação ou disponibilidade;"
      },
      {
        "type": "bullet",
        "text": "definição ou confirmação de condição comercial;"
      },
      {
        "type": "bullet",
        "text": "cotação ou negociação;"
      },
      {
        "type": "bullet",
        "text": "esclarecimentos e comunicação com o cliente;"
      },
      {
        "type": "bullet",
        "text": "acompanhamento necessário à conclusão do pedido;"
      },
      {
        "type": "bullet",
        "text": "coordenação da operação até o fechamento."
      },
      {
        "type": "paragraph",
        "text": "A simples recepção ou encaminhamento de mensagem, digitação do pedido ou execução de tarefa administrativa sobre uma venda já materialmente formada antes da cobertura não transfere sua atribuição."
      },
      {
        "type": "heading",
        "text": "8.5. Data de surgimento da demanda e mensagens não tratadas"
      },
      {
        "type": "paragraph",
        "text": "Para demandas recebidas por Canal Institucional, a referência primária de entrada será o timestamp original do canal, com seu identificador técnico quando disponível."
      },
      {
        "type": "paragraph",
        "text": "Mensagem recebida antes do início de uma cobertura e localizada ou tratada somente depois não será automaticamente considerada venda do Responsável Comercial nem, por outro lado, apropriada automaticamente pelo Vendedor de Cobertura apenas por ter sido localizada durante a ausência."
      },
      {
        "type": "paragraph",
        "text": "Nessa situação, a atribuição deverá ser submetida ao Supervisor Comercial e considerar, no mínimo: data e hora de entrada; disponibilidade do Responsável à época; existência de negociação específica anterior; registros de atuação; motivo da falta de tratamento; SLA do canal; e atividade efetivamente realizada para converter a demanda em venda."
      },
      {
        "type": "paragraph",
        "text": "A mera chegada de uma programação, forecast, e-mail ou solicitação à caixa corporativa não equivale, por si só, a atividade comercial material."
      },
      {
        "type": "heading",
        "text": "8.6. Vendas recorrentes e pedidos repetitivos"
      },
      {
        "type": "paragraph",
        "text": "O fato de um cliente ser recorrente, OEM ou possuir histórico de compras não determina, isoladamente, a atribuição da comissão."
      },
      {
        "type": "paragraph",
        "text": "Para cada nova operação deverá ser verificado se:"
      },
      {
        "type": "paragraph",
        "text": "I — a venda específica já havia sido materialmente iniciada pelo Responsável Comercial antes da ausência; caso em que a operação permanece vinculada a ele;"
      },
      {
        "type": "paragraph",
        "text": "ou"
      },
      {
        "type": "paragraph",
        "text": "II — trata-se de nova demanda surgida durante a ausência, sem negociação específica anterior; caso em que a operação será atribuída ao Vendedor de Cobertura que efetivamente realizar a venda."
      },
      {
        "type": "paragraph",
        "text": "Assim, uma recompra espontânea ou novo pedido realizado pelo cliente durante a ausência não será automaticamente considerado venda do Responsável Comercial apenas por decorrer de relacionamento histórico com sua carteira."
      },
      {
        "type": "heading",
        "text": "8.7. Retorno do Responsável Comercial"
      },
      {
        "type": "paragraph",
        "text": "Encerrada a ausência ou indisponibilidade, o cliente permanecerá ou retornará normalmente à responsabilidade do Responsável Comercial original, salvo decisão organizacional formal da empresa em sentido diverso."
      },
      {
        "type": "paragraph",
        "text": "A comissão da venda específica regularmente atribuída ao Vendedor de Cobertura durante a ausência não será transferida retroativamente pelo simples retorno do Responsável Comercial."
      },
      {
        "type": "heading",
        "text": "8.8. Retorno durante negociação em andamento"
      },
      {
        "type": "paragraph",
        "text": "Se o Responsável Comercial retornar antes da conclusão de nova oportunidade legitimamente assumida e materialmente conduzida pelo Vendedor de Cobertura, a transição deverá ser registrada no CRM."
      },
      {
        "type": "paragraph",
        "text": "Quando houver participação material relevante de ambos, poderá ser definida divisão objetiva da comissão, preferencialmente antes da conclusão da venda. Na ausência de definição prévia, os Registros Materiais serão utilizados para determinar a contribuição de cada participante."
      },
      {
        "type": "heading",
        "text": "8.9. Programações, forecasts e previsões"
      },
      {
        "type": "paragraph",
        "text": "Previsões, forecasts, programações não firmes e estimativas de consumo não geram comissão por si sós."
      },
      {
        "type": "paragraph",
        "text": "Quando tais documentos forem apenas indicativos de necessidades futuras e ainda dependerem de nova confirmação, liberação, pedido ou definição de quantidade, cada operação será analisada quando efetivamente convertida em venda."
      },
      {
        "type": "paragraph",
        "text": "Quando, antes da cobertura, existir compromisso comercial firme, individualizável, formalmente registrado e materialmente conduzido pelo Responsável Comercial, as liberações que constituam mera execução daquele compromisso permanecerão comercialmente vinculadas a ele."
      },
      {
        "type": "paragraph",
        "text": "A vinculação comercial prevista acima não antecipa, por si só, o momento de aquisição, exigibilidade ou pagamento da comissão, que seguirá as regras aplicáveis."
      },
      {
        "type": "heading",
        "text": "8.10. Contratos e pedidos guarda-chuva"
      },
      {
        "type": "paragraph",
        "text": "A existência de contrato, programa de fornecimento, preço-mestre ou pedido guarda-chuva não determina, isoladamente, a atribuição de cada liberação."
      },
      {
        "type": "paragraph",
        "text": "Quando a liberação decorrer automaticamente de obrigação firme de volume ou de negócio previamente concluído e exigir apenas execução logística ou administrativa, a mera operacionalização por outro profissional não transfere a atribuição."
      },
      {
        "type": "paragraph",
        "text": "Quando cada liberação posterior representar decisão autônoma de nova compra e exigir nova atuação comercial, sem obrigação firme anterior, será aplicada a regra vigente para a nova demanda."
      },
      {
        "type": "heading",
        "text": "8.11. Canais institucionais e SLA mínimo"
      },
      {
        "type": "paragraph",
        "text": "E-mails gerais, WhatsApp corporativo, telefones comerciais, portais, EDI, formulários de site e demais canais institucionais pertencem à empresa e não são de titularidade pessoal de qualquer Vendedor."
      },
      {
        "type": "paragraph",
        "text": "O recebimento da demanda por determinado canal, aparelho ou caixa de entrada não define, por si só, a comissão."
      },
      {
        "type": "paragraph",
        "text": "Toda demanda comercial recebida por Canal Institucional deverá ser triada e receber responsável identificado até o final do próximo dia útil, salvo contingência documentada. Demanda sem responsável após esse prazo deverá ser escalada ao Supervisor Comercial; demanda sem atividade por dois dias úteis deverá possuir próximo passo ou justificativa registrada."
      },
      {
        "type": "paragraph",
        "text": "O procedimento operacional poderá estabelecer SLAs mais rigorosos para clientes, canais ou situações específicas."
      },
      {
        "type": "heading",
        "text": "8.12. Registro e solução de divergências"
      },
      {
        "type": "paragraph",
        "text": "A atribuição de oportunidade em cobertura, transferência ou nova demanda deverá ser registrada obrigatoriamente no CRM ou sistema comercial antes da aprovação final do Pedido de Venda. Em indisponibilidade técnica comprovada, o registro deverá ser regularizado no primeiro dia útil possível, com justificativa."
      },
      {
        "type": "paragraph",
        "text": "Eventual divergência sobre atribuição de cliente, venda ou comissão deverá ser submetida ao Supervisor Comercial e, quando necessário, ao RH, Administração ou Diretoria."
      },
      {
        "type": "paragraph",
        "text": "Nenhum integrante da equipe deverá alterar unilateralmente a atribuição de uma operação já registrada. A decisão deverá considerar elementos objetivos, sem presunção automática em favor do Responsável Comercial ou do Vendedor de Cobertura, e deverá permanecer registrada."
      },
      {
        "type": "paragraph",
        "text": "A presente regra de cobertura tem por finalidade garantir continuidade do atendimento e atribuir cada operação conforme o trabalho comercial efetivamente realizado. Sua aplicação não constitui penalização pela ausência, não implica perda definitiva da carteira e não modifica operações já materialmente desenvolvidas antes do afastamento."
      }
    ]
  },
  {
    "id": "9-campanhas-e-condicoes-comerciais-especificas",
    "title": "9. CAMPANHAS E CONDIÇÕES COMERCIAIS ESPECÍFICAS",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A empresa poderá instituir campanhas ou condições específicas para negócios futuros, com o objetivo de incentivar produtos, linhas, clientes, canais, regiões, volumes, lançamentos, ocupação de capacidade, recuperação de mercado ou outras estratégias comerciais."
      },
      {
        "type": "paragraph",
        "text": "Toda campanha deverá possuir identificação, versão, vigência, escopo, percentual ou fórmula, condições, alçadas, regra de cumulatividade e comunicação prévia aos abrangidos."
      },
      {
        "type": "paragraph",
        "text": "Campanhas poderão criar incentivo adicional ou condição específica. Quando uma campanha estabelecer percentual inferior ao previsto na Matriz vigente para situação equivalente, sua implantação dependerá de aprovação expressa da Diretoria e validação prévia de aderência às condições aplicáveis, não alcançando retroativamente oportunidades ou vendas anteriores à comunicação."
      },
      {
        "type": "paragraph",
        "text": "Na ausência de regra clara para sobreposição ou conflito de campanhas, prevalecerá a Matriz Normativa vigente."
      },
      {
        "type": "paragraph",
        "text": "Conta Institucional Não Comissionável poderá ser temporariamente comissionada por campanha específica. Encerrada a campanha, restabelece-se a classificação vigente para os negócios futuros."
      }
    ]
  },
  {
    "id": "10-responsabilidade-comercial-e-carteira",
    "title": "10. RESPONSABILIDADE COMERCIAL E CARTEIRA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A carteira de clientes é ativo da empresa. A atribuição de cliente a Vendedor estabelece responsabilidade comercial e não confere propriedade, exclusividade permanente ou direito de retenção indefinida da conta."
      },
      {
        "type": "paragraph",
        "text": "O Responsável Comercial deverá manter acompanhamento ativo, oportunidades, propostas, próximos passos e registros atualizados nos sistemas oficiais."
      },
      {
        "type": "paragraph",
        "text": "A empresa poderá reorganizar carteiras por território, segmento, capacidade, especialização, solicitação do cliente, necessidade operacional ou estratégia comercial, preservando operações específicas já materialmente desenvolvidas e comissões já adquiridas."
      }
    ]
  },
  {
    "id": "11-inatividade-de-cliente-e-revisao-de-carteira",
    "title": "11. INATIVIDADE DE CLIENTE E REVISÃO DE CARTEIRA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "O período de 90 dias corridos sem novo Pedido de Venda aprovado constitui gatilho automático para verificação da condição de Responsável Comercial do cliente."
      },
      {
        "type": "paragraph",
        "text": "Quando, ao final desse período, não houver no CRM registro objetivo, atualizado e suficiente que justifique a ausência temporária de compras — como negociação em andamento, projeto ativo, programação futura confirmada, paralisação temporária informada pelo cliente ou outra circunstância comercial relevante — o cliente deixará automaticamente de possuir Responsável Comercial exclusivo e ficará disponível para redistribuição, prospecção ou reativação conforme as regras desta Política."
      },
      {
        "type": "paragraph",
        "text": "A finalidade dessa regra é preservar a saúde financeira e comercial da empresa, evitando que clientes sem recorrência permaneçam indefinidamente vinculados a uma carteira sem atuação comercial documentada. A retirada da responsabilidade comercial exclusiva não constitui penalidade e não tem como finalidade primária a redistribuição de clientes, mas a preservação do faturamento, da recorrência, do relacionamento comercial e do aproveitamento efetivo da base de clientes da empresa."
      },
      {
        "type": "paragraph",
        "text": "A manutenção do Responsável Comercial após 90 dias sem compra dependerá da existência, no CRM, de registro válido que demonstre motivo comercial objetivo para a inatividade e evidencie acompanhamento efetivo da conta."
      },
      {
        "type": "paragraph",
        "text": "Para ser considerado válido, o registro deverá permitir identificar, conforme aplicável:"
      },
      {
        "type": "paragraph",
        "text": "motivo objetivo da ausência de compras;"
      },
      {
        "type": "paragraph",
        "text": "última interação comercial relevante;"
      },
      {
        "type": "paragraph",
        "text": "negociação, proposta ou oportunidade em andamento;"
      },
      {
        "type": "paragraph",
        "text": "projeto, homologação ou programa de fornecimento ativo;"
      },
      {
        "type": "paragraph",
        "text": "programação futura confirmada;"
      },
      {
        "type": "paragraph",
        "text": "paralisação temporária informada pelo cliente;"
      },
      {
        "type": "paragraph",
        "text": "próximo passo comercial definido;"
      },
      {
        "type": "paragraph",
        "text": "data prevista para nova interação ou evolução da oportunidade."
      },
      {
        "type": "paragraph",
        "text": "Registros genéricos, desatualizados, artificiais, inseridos apenas para manutenção da carteira ou sem evidência de fato comercial concreto não impedirão a aplicação da regra de 90 dias."
      },
      {
        "type": "paragraph",
        "text": "Não existindo registro válido no CRM ao término do período de 90 dias, a retirada da condição de Responsável Comercial exclusivo ocorrerá automaticamente, independentemente de decisão discricionária do Supervisor Comercial."
      },
      {
        "type": "paragraph",
        "text": "Após a retirada da responsabilidade exclusiva, caberá ao Supervisor Comercial definir a destinação comercial do cliente, podendo:"
      },
      {
        "type": "paragraph",
        "text": "atribuí-lo a outro Responsável Comercial;"
      },
      {
        "type": "paragraph",
        "text": "disponibilizá-lo para prospecção;"
      },
      {
        "type": "paragraph",
        "text": "incluí-lo em processo estruturado de reativação;"
      },
      {
        "type": "paragraph",
        "text": "mantê-lo temporariamente em carteira aberta até nova oportunidade comercial."
      },
      {
        "type": "paragraph",
        "text": "Toda nova atribuição deverá ser registrada no CRM ou sistema comercial, com identificação da data e do novo responsável, quando houver."
      },
      {
        "type": "paragraph",
        "text": "A retirada da responsabilidade comercial exclusiva não elimina eventual direito relacionado a negociação específica materialmente iniciada e devidamente registrada antes da reclassificação do cliente. Essas operações permanecerão vinculadas ao responsável que as iniciou, conforme as regras de atribuição de vendas e comissões desta Política."
      },
      {
        "type": "paragraph",
        "text": "A reatribuição produzirá efeitos exclusivamente prospectivos e não afetará comissões já adquiridas nem operações específicas anteriormente preservadas."
      }
    ]
  },
  {
    "id": "12-transferencia-e-redistribuicao-de-clientes",
    "title": "12. TRANSFERÊNCIA E REDISTRIBUIÇÃO DE CLIENTES",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A empresa poderá transferir ou redistribuir clientes por inatividade validada, solicitação do cliente, reorganização de território ou segmento, capacidade de atendimento, mudança de função, desligamento, necessidade operacional, conflito de interesse, indisponibilidade prolongada que exija reorganização ou falhas reiteradas e documentadas de atendimento."
      },
      {
        "type": "paragraph",
        "text": "Quando a transferência decorrer de falhas de atendimento imputáveis ao Responsável Comercial, deverão existir fatos objetivos e documentação suficiente para sustentar a decisão, ressalvadas situações urgentes ou solicitação expressa do cliente."
      },
      {
        "type": "paragraph",
        "text": "A transferência será prospectiva quanto às novas demandas e preservará comissões já adquiridas e operações específicas materialmente desenvolvidas antes da mudança, salvo impossibilidade material de continuidade e decisão fundamentada."
      },
      {
        "type": "paragraph",
        "text": "A transferência de cliente não altera automaticamente sua classificação de comissionamento."
      }
    ]
  },
  {
    "id": "13-negocios-conjuntos-e-divisao-de-comissao",
    "title": "13. NEGÓCIOS CONJUNTOS E DIVISÃO DE COMISSÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Quando dois ou mais Vendedores contribuírem materialmente para o mesmo negócio, a divisão de comissão deverá ser preferencialmente definida e registrada antes da aprovação do Pedido de Venda."
      },
      {
        "type": "paragraph",
        "text": "A ausência de divisão prévia não elimina contribuição material comprovada. Em caso de divergência, a empresa decidirá com base nos Registros Materiais da operação e documentará a razão da divisão adotada."
      },
      {
        "type": "paragraph",
        "text": "A alteração de responsável imediatamente antes da conclusão do negócio não poderá ser utilizada para deslocar artificialmente comissão vinculada à atuação material de outro Vendedor."
      }
    ]
  },
  {
    "id": "14-comissao-do-supervisor-comercial",
    "title": "14. COMISSÃO DO SUPERVISOR COMERCIAL",
    "blocks": [
      {
        "type": "paragraph",
        "text": "O Supervisor Comercial receberá remuneração variável equivalente a 33% do valor das comissões elegíveis efetivamente apuradas para os Vendedores oficialmente vinculados ao seu time, salvo regra formal específica vigente."
      },
      {
        "type": "paragraph",
        "text": "A parcela do Supervisor é adicional suportada pela empresa e não reduz, retém nem é descontada da comissão do Vendedor."
      },
      {
        "type": "paragraph",
        "text": "O Supervisor Comercial não possui, por sua função de supervisão, carteira própria para fins de comissão individual. Sua participação em visita, negociação, formação de preço, recuperação de conta, fechamento ou apoio comercial não transforma a venda em venda própria do Supervisor."
      },
      {
        "type": "paragraph",
        "text": "Em Conta Institucional Não Comissionável, inexistindo comissão do Vendedor, não haverá base para os 33% do Supervisor. Havendo campanha que gere comissão ao Vendedor, os 33% incidirão sobre a comissão efetivamente apurada conforme a regra vigente."
      }
    ]
  },
  {
    "id": "15-proposta-aceitacao-e-formalizacao-da-venda",
    "title": "15. PROPOSTA, ACEITAÇÃO E FORMALIZAÇÃO DA VENDA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Propostas comerciais deverão ser elaboradas, aprovadas, aceitas, recusadas e formalizadas conforme as alçadas, prazos e procedimentos vigentes."
      },
      {
        "type": "paragraph",
        "text": "O Pedido de Venda formaliza, para fins operacionais, as condições comerciais aprovadas, os itens, preços, margens, responsável registrado e regra de comissão aplicável."
      },
      {
        "type": "paragraph",
        "text": "A ausência ou atraso de registro interno não será utilizado, isoladamente, para apagar atuação comercial material comprovada por outros registros contemporâneos."
      }
    ]
  },
  {
    "id": "16-aquisicao-exigibilidade-e-pagamento-da-comissao",
    "title": "16. AQUISIÇÃO, EXIGIBILIDADE E PAGAMENTO DA COMISSÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A atribuição comercial da venda e o cálculo da comissão serão registrados conforme esta Política. O momento de aquisição, exigibilidade e pagamento observará as regras obrigatórias, os instrumentos aplicáveis e a natureza da operação."
      },
      {
        "type": "paragraph",
        "text": "Como regra operacional de processamento, as comissões serão apuradas mensalmente e, quando permitido pelas condições aplicáveis, liberadas proporcionalmente à liquidação dos valores devidos pelo cliente, conforme os recebimentos das parcelas correspondentes à venda."
      },
      {
        "type": "paragraph",
        "text": "O demonstrativo deverá distinguir, sempre que tecnicamente possível, comissão atribuída, comissão apurada, comissão liberada e comissão paga, evitando que atraso de recebimento seja confundido com perda de atribuição da venda."
      },
      {
        "type": "paragraph",
        "text": "Nas vendas parceladas ou de prestações sucessivas, quando a liberação proporcional ao recebimento for aplicável, cada parcela será conciliada com os Itens de Venda correspondentes. Se o recebimento não identificar individualmente os itens, a apropriação será realizada proporcionalmente à base de venda dos itens abrangidos."
      },
      {
        "type": "paragraph",
        "text": "A apuração e o pagamento não poderão contrariar regra legal, contratual ou coletiva de observância obrigatória."
      }
    ]
  },
  {
    "id": "17-cancelamento-inadimplencia-devolucao-e-insolvencia",
    "title": "17. CANCELAMENTO, INADIMPLÊNCIA, DEVOLUÇÃO E INSOLVÊNCIA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A simples inadimplência, cancelamento posterior, devolução, abatimento ou alteração do negócio não produzirá estorno automático de comissão já adquirida."
      },
      {
        "type": "paragraph",
        "text": "Cada ocorrência deverá ser analisada conforme o momento do fato, a situação da venda, os registros disponíveis e as regras obrigatórias aplicáveis."
      },
      {
        "type": "paragraph",
        "text": "Quando houver hipótese juridicamente admitida de estorno, compensação ou ajuste, a empresa deverá apresentar memória de cálculo e permitir conferência pelo interessado antes ou juntamente com o processamento do ajuste."
      },
      {
        "type": "paragraph",
        "text": "Erro material comprovado de cálculo ou pagamento poderá ser corrigido de forma documentada."
      }
    ]
  },
  {
    "id": "18-encerramento-da-relacao-comercial-ou-mudanca-de-funcao",
    "title": "18. ENCERRAMENTO DA RELAÇÃO COMERCIAL OU MUDANÇA DE FUNÇÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "O encerramento da relação profissional ou a mudança de função não elimina, por si só, valores decorrentes de negócios anteriores quando a comissão já tiver sido adquirida ou permanecer exigível conforme as regras aplicáveis."
      },
      {
        "type": "paragraph",
        "text": "A transferência de carteira decorrente de desligamento ou mudança de função será prospectiva quanto às novas demandas, preservadas as operações específicas materialmente desenvolvidas conforme os registros existentes."
      }
    ]
  },
  {
    "id": "19-registros-rastreabilidade-e-demonstrativo",
    "title": "19. REGISTROS, RASTREABILIDADE E DEMONSTRATIVO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A empresa manterá registros suficientes para identificar, quando aplicável: cliente; classificação; Responsável Comercial; Vendedor de Cobertura; Supervisor; Evento de Cobertura; origem e timestamp da demanda; oportunidade; Pedido de Venda; Item de Venda; base de cálculo; Margem Oficial; versão da Matriz; percentual; campanha; alçada; propostas; transferências; divisões; recebimentos; comissão; contestações; decisões e ajustes."
      },
      {
        "type": "paragraph",
        "text": "O CRM ou sistema comercial será a fonte oficial para identificação de oportunidades, responsáveis e mudanças de atribuição. E-mails, WhatsApp e demais canais funcionam como evidência complementar e deverão, quando materialmente relevantes, estar vinculados ao registro da oportunidade."
      },
      {
        "type": "paragraph",
        "text": "O demonstrativo periódico deverá permitir ao Vendedor compreender a origem do valor apurado e solicitar conferência."
      },
      {
        "type": "paragraph",
        "text": "Registros relevantes serão preservados pelo período definido na política corporativa de retenção documental, observadas as necessidades legais, contratuais, fiscais e de exercício regular de direitos."
      }
    ]
  },
  {
    "id": "20-governanca-do-crm-e-mail-comercial-e-canais-corporativos",
    "title": "20. GOVERNANÇA DO CRM, E-MAIL COMERCIAL E CANAIS CORPORATIVOS",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Toda oportunidade comissionável deverá possuir responsável identificado no sistema oficial antes da aprovação final do Pedido de Venda, salvo contingência técnica documentada."
      },
      {
        "type": "paragraph",
        "text": "O registro mínimo de uma demanda comercial deverá conter, quando disponível: cliente; origem; data e hora; responsável; status; referência à oportunidade; referência à proposta ou comunicação relevante; cobertura, quando houver; e justificativa de eventual transferência."
      },
      {
        "type": "paragraph",
        "text": "A caixa de e-mail comercial e demais canais compartilhados deverão possuir rotina de triagem, acompanhamento e escalonamento. Nenhuma mensagem comercial deverá permanecer deliberadamente sem tratamento ou sem responsável com a finalidade de deslocar futura atribuição de venda ou comissão."
      },
      {
        "type": "paragraph",
        "text": "O histórico de alterações de responsável deverá ser preservado sempre que o sistema permitir, evitando sobrescrita sem rastreabilidade."
      }
    ]
  },
  {
    "id": "21-conferencia-e-contestacao",
    "title": "21. CONFERÊNCIA E CONTESTAÇÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Divergências de comissão poderão ser apresentadas com indicação do cliente, Pedido de Venda ou oportunidade, período, item e motivo da contestação, acompanhadas dos registros disponíveis."
      },
      {
        "type": "paragraph",
        "text": "A análise deverá ser realizada por pessoa com alçada suficiente e sem interesse econômico direto no resultado da controvérsia. Quando o Supervisor estiver envolvido na operação ou sua decisão for contestada de forma fundamentada, o tema será escalado ao RH, Administração ou Diretoria."
      },
      {
        "type": "paragraph",
        "text": "A decisão e seus fundamentos deverão ser registrados. Correções procedentes serão processadas na primeira competência tecnicamente possível, observadas as regras aplicáveis."
      }
    ]
  },
  {
    "id": "22-condutas-vedadas",
    "title": "22. CONDUTAS VEDADAS",
    "blocks": [
      {
        "type": "bullet",
        "text": "alterar ou simular preço, custo, margem, data, cliente, responsável, campanha ou condição comercial para obter comissão indevida ou suprimir comissão devida;"
      },
      {
        "type": "bullet",
        "text": "criar registros artificiais para impedir revisão de inatividade ou alterar a atribuição de uma operação;"
      },
      {
        "type": "bullet",
        "text": "reter, ocultar ou atrasar deliberadamente informação comercial para impedir atendimento, cobertura ou correta atribuição da venda;"
      },
      {
        "type": "bullet",
        "text": "alterar responsável ou apropriar-se deliberadamente de oportunidade sem observância do fluxo previsto nesta Política;"
      },
      {
        "type": "bullet",
        "text": "apagar ou ocultar histórico material da oportunidade ou alterar registros sem rastreabilidade quando o sistema disponibilizar histórico;"
      },
      {
        "type": "bullet",
        "text": "combinar divisão informal de comissão sem registro e aprovação;"
      },
      {
        "type": "bullet",
        "text": "aplicar campanha inexistente, vencida ou fora do escopo;"
      },
      {
        "type": "bullet",
        "text": "reclassificar retroativamente cliente ou operação para eliminar comissão já adquirida;"
      },
      {
        "type": "bullet",
        "text": "utilizar comissão adquirida como penalidade disciplinar."
      }
    ]
  },
  {
    "id": "23-confidencialidade-documento-controlado-e-uso-restrito",
    "title": "23. CONFIDENCIALIDADE, DOCUMENTO CONTROLADO E USO RESTRITO",
    "blocks": [
      {
        "type": "heading",
        "text": "23.1. Natureza confidencial e classificação do documento"
      },
      {
        "type": "paragraph",
        "text": "Esta Política é classificada como DOCUMENTO CONTROLADO, DE USO INTERNO E RESTRITO. Seu conteúdo reúne informações comerciais, critérios de precificação, margens, percentuais e regras de comissão, práticas de gestão de carteira, campanhas, canais, critérios de cobertura, procedimentos operacionais, dados de clientes e outros elementos estratégicos que não são destinados à divulgação pública ou ao compartilhamento indiscriminado."
      },
      {
        "type": "paragraph",
        "text": "O acesso a este documento não transfere titularidade sobre as informações nele contidas. O conteúdo permanece de propriedade e controle da empresa e deve ser utilizado exclusivamente para o exercício das atividades profissionais autorizadas."
      },
      {
        "type": "heading",
        "text": "23.2. Informações protegidas"
      },
      {
        "type": "paragraph",
        "text": "São consideradas informações protegidas, entre outras, as regras e faixas de margem, matrizes e percentuais de comissão, critérios de preço e alçada, campanhas, condições comerciais especiais, segmentações, listas e classificações de clientes, carteiras, histórico de oportunidades, estratégias de abordagem, SLAs, critérios de cobertura, regras de atribuição, dados comerciais, relatórios, documentos, telas, exportações e quaisquer informações extraídas dos sistemas corporativos que revelem estratégia, operação, desempenho ou organização comercial."
      },
      {
        "type": "paragraph",
        "text": "A proteção alcança tanto o conteúdo integral desta Política quanto trechos, fotografias, capturas de tela, cópias, anotações, resumos, planilhas, relatórios, mensagens ou qualquer outra forma de reprodução ou derivação que permita reconstruir informação interna relevante."
      },
      {
        "type": "heading",
        "text": "23.3. Uso permitido e princípio da necessidade"
      },
      {
        "type": "paragraph",
        "text": "O profissional poderá acessar e utilizar as informações apenas na medida necessária ao desempenho de suas atribuições, ao atendimento de clientes, à gestão de sua carteira, à conferência de sua própria remuneração variável e ao cumprimento das responsabilidades previstas nesta Política."
      },
      {
        "type": "paragraph",
        "text": "O acesso a dados de terceiros, de outras carteiras, de outros Vendedores, de clientes sem relação com a atividade executada ou a informações estratégicas não necessárias ao trabalho deverá respeitar os controles de permissão, a finalidade profissional e o princípio da necessidade."
      },
      {
        "type": "heading",
        "text": "23.4. Divulgação, compartilhamento e reprodução vedados"
      },
      {
        "type": "paragraph",
        "text": "Sem autorização expressa da Diretoria ou da área formalmente responsável, é vedado divulgar, encaminhar, reproduzir, publicar, disponibilizar, transferir ou compartilhar este documento ou suas informações protegidas com clientes, fornecedores, concorrentes, ex-colaboradores, pessoas externas à empresa ou terceiros sem necessidade profissional autorizada."
      },
      {
        "type": "paragraph",
        "text": "Também é vedado, salvo autorização ou necessidade operacional formalmente reconhecida: encaminhar o documento para e-mail pessoal; armazená-lo em nuvem pessoal; compartilhá-lo por aplicativos pessoais de mensagens; publicar conteúdo em redes sociais; fotografar ou capturar telas para finalidade externa; reproduzir tabelas, faixas, percentuais, listas ou critérios internos em materiais não autorizados; ou utilizar informações estratégicas para finalidade particular, concorrencial ou alheia aos interesses legítimos da empresa."
      },
      {
        "type": "heading",
        "text": "23.5. Impressão, cópias e documentos controlados"
      },
      {
        "type": "paragraph",
        "text": "Cópias impressas ou arquivos exportados deverão ser tratados como cópias controladas. A impressão somente deverá ocorrer quando necessária à finalidade profissional, devendo o responsável preservar a guarda do material e impedir acesso por pessoas não autorizadas."
      },
      {
        "type": "paragraph",
        "text": "Sempre que tecnicamente disponível, cópias geradas pelo sistema poderão conter identificação do usuário, data e hora de emissão, versão do documento, código de controle, hash, marca d’água ou outros elementos de rastreabilidade. A ausência de qualquer desses elementos em cópia informal não retira a natureza confidencial do conteúdo."
      },
      {
        "type": "paragraph",
        "text": "Cópias desatualizadas não substituem a versão oficial vigente. Antes de utilizar documento impresso ou arquivo local para decisão comercial, o profissional deverá confirmar a versão vigente no repositório ou sistema corporativo oficial."
      },
      {
        "type": "heading",
        "text": "23.6. Dever de guarda, segurança e preservação"
      },
      {
        "type": "paragraph",
        "text": "Cada usuário é responsável por adotar cautelas razoáveis para impedir acesso indevido às informações sob sua guarda, incluindo proteção de credenciais, bloqueio de estação ou dispositivo quando não estiver em uso, cuidado com impressão física, armazenamento apenas em locais corporativos autorizados e comunicação imediata de suspeita de perda, acesso indevido ou vazamento."
      },
      {
        "type": "paragraph",
        "text": "Credenciais de acesso ao IndusCost, e-mail corporativo ou demais sistemas não deverão ser compartilhadas. O uso de credencial individual para acesso a informações protegidas vincula o registro técnico ao usuário autenticado, sem prejuízo da apuração dos fatos quando houver indício de uso indevido."
      },
      {
        "type": "heading",
        "text": "23.7. Mudança de função, afastamento e término do vínculo"
      },
      {
        "type": "paragraph",
        "text": "Na mudança de função, afastamento, transferência de área ou término do vínculo profissional, o acesso às informações deverá ser ajustado conforme a necessidade da nova condição. Materiais físicos ou digitais sob guarda do profissional deverão ser devolvidos, eliminados ou mantidos somente quando houver autorização ou obrigação aplicável."
      },
      {
        "type": "paragraph",
        "text": "O dever de confidencialidade sobre informações estratégicas e não públicas subsiste após a perda do acesso ou término do vínculo, na extensão permitida pelos instrumentos aplicáveis e pela legislação, sem prejuízo do exercício regular de direitos."
      },
      {
        "type": "heading",
        "text": "23.8. Incidentes e dever de comunicação"
      },
      {
        "type": "paragraph",
        "text": "Qualquer perda, envio equivocado, acesso indevido, divulgação não autorizada, comprometimento de credenciais, publicação acidental ou suspeita de vazamento envolvendo esta Política ou informações comerciais protegidas deverá ser comunicada imediatamente ao superior responsável, à Administração ou ao canal interno definido pela empresa, para contenção, registro e análise."
      },
      {
        "type": "paragraph",
        "text": "A comunicação tempestiva de incidente tem finalidade de reduzir riscos e preservar a rastreabilidade, não substituindo a apuração posterior das circunstâncias."
      },
      {
        "type": "heading",
        "text": "23.9. Responsabilização por uso indevido"
      },
      {
        "type": "paragraph",
        "text": "O uso, divulgação, reprodução, extração, compartilhamento ou aproveitamento não autorizado de informações protegidas poderá ser apurado pela empresa e, conforme a gravidade, a intenção, o dano, os instrumentos aplicáveis e a legislação, poderá sujeitar o responsável às medidas administrativas, contratuais, disciplinares e legais cabíveis."
      },
      {
        "type": "paragraph",
        "text": "A aplicação de qualquer medida observará a legislação, instrumentos contratuais, normas coletivas e demais regras obrigatórias, bem como a análise concreta dos fatos. Esta cláusula não autoriza sanção automática nem afasta direitos legalmente assegurados."
      },
      {
        "type": "heading",
        "text": "23.10. Exceções legais e direitos preservados"
      },
      {
        "type": "paragraph",
        "text": "As obrigações de confidencialidade previstas nesta seção não impedem o cumprimento de obrigação legal, ordem judicial ou determinação de autoridade competente, nem restringem o exercício regular de direitos, a apresentação de informações a órgãos públicos, autoridades, representantes legais ou entidades legitimadas quando juridicamente cabível."
      },
      {
        "type": "paragraph",
        "text": "Sempre que a divulgação decorrer de obrigação ou exercício legítimo de direito, deverá ser limitada ao necessário e, quando permitido, realizada de forma a preservar as demais informações confidenciais não relacionadas à finalidade que justificou a divulgação."
      },
      {
        "type": "paragraph",
        "text": "A leitura, o acesso ou o aceite eletrônico desta Política não autorizam sua distribuição externa. Toda reprodução ou compartilhamento deverá observar esta Seção 23 e as autorizações internas aplicáveis."
      }
    ]
  },
  {
    "id": "24-condicoes-anteriores-e-transicao",
    "title": "24. CONDIÇÕES ANTERIORES E TRANSIÇÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Esta Política produz efeitos a partir da Data de Vigência indicada na capa e não será utilizada para reclassificar retroativamente venda anterior, comissão já adquirida, atendimento já realizado, oportunidade passada ou obrigação de registro que não existia à época dos fatos."
      },
      {
        "type": "paragraph",
        "text": "A empresa não declara, por meio desta Política, inexistentes ou inválidas práticas comerciais anteriores. Situações anteriores à vigência serão analisadas conforme os registros, práticas comprovadas, instrumentos e regras aplicáveis à época."
      },
      {
        "type": "paragraph",
        "text": "Antes da entrada em vigor deverá ser elaborado Mapa de Transição contendo, no mínimo: carteira atual; oportunidades materialmente ativas; propostas abertas; programações e contratos firmes; campanhas vigentes; classificação das contas; matriz atualmente praticada; e situações de cobertura já em curso."
      },
      {
        "type": "paragraph",
        "text": "Para oportunidades incluídas no Mapa de Transição, a ausência de requisito documental criado somente por esta nova versão não será utilizada retroativamente para retirar atribuição ou comissão."
      }
    ]
  },
  {
    "id": "25-revisao-da-matriz-e-alteracoes-futuras-da-politica",
    "title": "25. REVISÃO DA MATRIZ E ALTERAÇÕES FUTURAS DA POLÍTICA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A empresa poderá revisar esta Política, a Matriz Normativa, as faixas de margem, percentuais, critérios de alçada e regras operacionais mediante nova versão formal, de acordo com necessidades econômicas, comerciais, operacionais ou de governança."
      },
      {
        "type": "paragraph",
        "text": "Toda alteração deverá possuir identificação de versão, descrição objetiva do que mudou, aprovação formal, data de vigência e comunicação comprovável antes de sua aplicação."
      },
      {
        "type": "paragraph",
        "text": "Revisões da Matriz deverão ser submetidas a avaliação de impacto econômico e de aderência às condições aplicáveis antes da vigência, especialmente quando possam produzir redução material de remuneração em situações equivalentes às anteriormente praticadas."
      },
      {
        "type": "paragraph",
        "text": "Nenhuma versão posterior terá efeito retroativo para retirar comissão já adquirida ou alterar Pedido de Venda já aprovado, ressalvado erro material comprovado e as regras obrigatórias aplicáveis."
      }
    ]
  },
  {
    "id": "26-prevalencia-e-interpretacao",
    "title": "26. PREVALÊNCIA E INTERPRETAÇÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Esta Política será interpretada em conjunto com os instrumentos, normas coletivas, legislação e demais regras obrigatórias aplicáveis a cada situação."
      },
      {
        "type": "paragraph",
        "text": "Em caso de conflito entre esta Política e norma de observância obrigatória, prevalecerá a regra juridicamente aplicável, devendo o procedimento interno ser ajustado."
      },
      {
        "type": "paragraph",
        "text": "Dúvida de interpretação que possa alterar atribuição ou valor de comissão deverá ser resolvida antes do fechamento mensal sempre que possível e ficará documentada para aplicação uniforme em casos equivalentes."
      }
    ]
  },
  {
    "id": "27-controle-documental",
    "title": "27. CONTROLE DOCUMENTAL",
    "blocks": [
      {
        "type": "paragraph",
        "text": "A versão oficial desta Política será mantida em repositório corporativo controlado. Cópias impressas ou arquivos locais somente terão valor de referência e deverão ser conferidos com a versão vigente antes de qualquer decisão de comissão."
      },
      {
        "type": "paragraph",
        "text": "O controle mestre deverá registrar, no mínimo: código, versão, data de aprovação, data de vigência, responsável pela revisão, aprovador e resumo das alterações."
      },
      {
        "type": "paragraph",
        "text": "A versão substituída será arquivada para preservação do histórico normativo e não deverá ser utilizada para operações posteriores à sua substituição."
      }
    ]
  },
  {
    "id": "28-vigencia-e-aprovacao",
    "title": "28. VIGÊNCIA E APROVAÇÃO",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Esta Política entra em vigor na data indicada na capa, após comunicação formal aos abrangidos e conclusão das condições mínimas de implantação, incluindo publicação da Matriz vigente, definição do fluxo de cobertura e disponibilização dos registros necessários no CRM ou sistema comercial."
      },
      {
        "type": "paragraph",
        "text": "A Política permanecerá válida até sua substituição formal por versão posterior."
      },
      {
        "type": "paragraph",
        "text": "Aprovação"
      },
      {
        "type": "paragraph",
        "text": "Nome / Função"
      },
      {
        "type": "paragraph",
        "text": "Data / Assinatura"
      },
      {
        "type": "paragraph",
        "text": "Diretoria"
      },
      {
        "type": "paragraph",
        "text": "______________________________"
      },
      {
        "type": "paragraph",
        "text": "______________________________"
      },
      {
        "type": "paragraph",
        "text": "Supervisor Comercial"
      },
      {
        "type": "paragraph",
        "text": "______________________________"
      },
      {
        "type": "paragraph",
        "text": "______________________________"
      }
    ]
  },
  {
    "id": "anexo-i-matriz-normativa-de-comissao-margem-e-alcada",
    "title": "ANEXO I — MATRIZ NORMATIVA DE COMISSÃO, MARGEM E ALÇADA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Este Anexo integra a Política POL-COM-001. A tabela abaixo é a única matriz normativa vigente para os negócios abrangidos enquanto não for substituída por revisão formal."
      },
      {
        "type": "paragraph",
        "text": "Controle da Matriz"
      },
      {
        "type": "paragraph",
        "text": "Informação"
      },
      {
        "type": "paragraph",
        "text": "Código"
      },
      {
        "type": "paragraph",
        "text": "MCOM-001"
      },
      {
        "type": "paragraph",
        "text": "Versão"
      },
      {
        "type": "paragraph",
        "text": "1.0"
      },
      {
        "type": "paragraph",
        "text": "Data de aprovação"
      },
      {
        "type": "paragraph",
        "text": "____/____/________"
      },
      {
        "type": "paragraph",
        "text": "Data de vigência"
      },
      {
        "type": "paragraph",
        "text": "____/____/________"
      },
      {
        "type": "paragraph",
        "text": "Margem Oficial do Item"
      },
      {
        "type": "paragraph",
        "text": "Comissão do Vendedor"
      },
      {
        "type": "paragraph",
        "text": "Alçada Comercial"
      },
      {
        "type": "paragraph",
        "text": "Abaixo de 30,00%"
      },
      {
        "type": "paragraph",
        "text": "1,00%"
      },
      {
        "type": "paragraph",
        "text": "Aprovação prévia da Diretoria"
      },
      {
        "type": "paragraph",
        "text": "30,00% a 34,99%"
      },
      {
        "type": "paragraph",
        "text": "1,00%"
      },
      {
        "type": "paragraph",
        "text": "Aprovação prévia do Supervisor Comercial"
      },
      {
        "type": "paragraph",
        "text": "35,00% a 39,99%"
      },
      {
        "type": "paragraph",
        "text": "2,00%"
      },
      {
        "type": "paragraph",
        "text": "Fluxo comercial ordinário"
      },
      {
        "type": "paragraph",
        "text": "40,00% a 49,99%"
      },
      {
        "type": "paragraph",
        "text": "3,00%"
      },
      {
        "type": "paragraph",
        "text": "Fluxo comercial ordinário"
      },
      {
        "type": "paragraph",
        "text": "50,00% ou mais"
      },
      {
        "type": "paragraph",
        "text": "4,00%"
      },
      {
        "type": "paragraph",
        "text": "Fluxo comercial ordinário"
      },
      {
        "type": "paragraph",
        "text": "O tempo de relacionamento do cliente com a empresa não altera, por si só, os percentuais desta Matriz."
      },
      {
        "type": "paragraph",
        "text": "Conta Institucional Não Comissionável: 0%, salvo campanha ou condição específica formalmente vigente."
      },
      {
        "type": "paragraph",
        "text": "A Matriz poderá ser revista nos termos da Seção 25. A nova versão deverá substituir integralmente a versão anterior, possuir data futura de vigência, ser comunicada antes da aplicação e permanecer arquivada no histórico documental."
      }
    ]
  },
  {
    "id": "anexo-ii-requisitos-minimos-para-campanha-ou-condicao-especifica",
    "title": "ANEXO II — REQUISITOS MÍNIMOS PARA CAMPANHA OU CONDIÇÃO ESPECÍFICA",
    "blocks": [
      {
        "type": "bullet",
        "text": "identificação, código e versão da campanha ou condição;"
      },
      {
        "type": "bullet",
        "text": "data de aprovação, início e término;"
      },
      {
        "type": "bullet",
        "text": "produtos, clientes, canais, regiões ou negócios abrangidos;"
      },
      {
        "type": "bullet",
        "text": "percentual, fórmula, prêmio ou incentivo aplicável;"
      },
      {
        "type": "bullet",
        "text": "condições de preço, margem, volume ou mix, quando aplicáveis;"
      },
      {
        "type": "bullet",
        "text": "alçada de aprovação;"
      },
      {
        "type": "bullet",
        "text": "regra de cumulatividade ou não cumulatividade;"
      },
      {
        "type": "bullet",
        "text": "regra para alterações materiais do Pedido de Venda;"
      },
      {
        "type": "bullet",
        "text": "tratamento de oportunidades já abertas na data de início;"
      },
      {
        "type": "bullet",
        "text": "comunicação prévia e comprovável aos abrangidos."
      }
    ]
  },
  {
    "id": "anexo-iii-termo-de-ciencia",
    "title": "ANEXO III — TERMO DE CIÊNCIA",
    "blocks": [
      {
        "type": "paragraph",
        "text": "Declaro que recebi e tive acesso à Política Comercial e de Comissionamento, código POL-COM-001, versão 2.0, vigente a partir de ____/____/________, e fui informado(a) sobre as regras de margem, matriz de comissão, alçadas, campanhas, classificação de clientes, gestão de carteira, revisão por inatividade, cobertura temporária, vendas recorrentes/OEM, canais institucionais, transferência, pagamento, registros e conferência aplicáveis à função comercial abrangida."
      },
      {
        "type": "paragraph",
        "text": "Fui informado(a) de que a designação de Responsável Comercial representa atribuição organizacional e que, durante cobertura temporária, operações específicas materialmente iniciadas antes da ausência e novas demandas surgidas durante a ausência são tratadas de forma distinta, conforme a Seção 8."
      },
      {
        "type": "paragraph",
        "text": "Fui informado(a) de que a Política possui efeitos a partir de sua vigência e não será utilizada para reclassificar retroativamente vendas anteriores ou retirar comissão já adquirida."
      },
      {
        "type": "paragraph",
        "text": "Este termo registra ciência e recebimento do documento, não implicando renúncia de direitos, quitação, confissão ou concordância com fatos anteriores à vigência."
      },
      {
        "type": "paragraph",
        "text": "Profissional: ____________________________________________________________________"
      },
      {
        "type": "paragraph",
        "text": "Função: _________________________________________________________________________"
      },
      {
        "type": "paragraph",
        "text": "Versão recebida: __________________________    Data: ____/____/________"
      },
      {
        "type": "paragraph",
        "text": "Assinatura: ______________________________________________________________________"
      },
      {
        "type": "paragraph",
        "text": "Responsável pela apresentação/entrega: ______________________________________________"
      }
    ]
  },
  {
    "id": "anexo-iv-fluxo-operacional-de-cobertura-e-mapa-de-transicao",
    "title": "ANEXO IV — FLUXO OPERACIONAL DE COBERTURA E MAPA DE TRANSIÇÃO",
    "blocks": [
      {
        "type": "heading",
        "text": "A. Fluxo decisório de cobertura"
      },
      {
        "type": "paragraph",
        "text": "Etapa"
      },
      {
        "type": "paragraph",
        "text": "Regra"
      },
      {
        "type": "paragraph",
        "text": "1"
      },
      {
        "type": "paragraph",
        "text": "Identificar se o Responsável Comercial está disponível no momento em que surge a demanda."
      },
      {
        "type": "paragraph",
        "text": "2"
      },
      {
        "type": "paragraph",
        "text": "Se estiver indisponível, confirmar ou registrar o Evento de Cobertura e o Vendedor de Cobertura."
      },
      {
        "type": "paragraph",
        "text": "3"
      },
      {
        "type": "paragraph",
        "text": "Verificar se, antes da cobertura, existia Operação Específica Materialmente Iniciada para aquela venda."
      },
      {
        "type": "paragraph",
        "text": "4"
      },
      {
        "type": "paragraph",
        "text": "Se existia e há Registro Material, preservar a vinculação da operação ao Responsável Comercial original; a cobertura executa somente o necessário para continuidade."
      },
      {
        "type": "paragraph",
        "text": "5"
      },
      {
        "type": "paragraph",
        "text": "Se não existia operação específica anterior, registrar a nova demanda no CRM em nome do Vendedor de Cobertura que efetivamente a assumirá."
      },
      {
        "type": "paragraph",
        "text": "6"
      },
      {
        "type": "paragraph",
        "text": "Se a mensagem entrou antes da cobertura, mas ficou sem tratamento, não decidir por mera data de recebimento ou mera descoberta: escalar ao Supervisor e aplicar os critérios da Seção 8.5."
      },
      {
        "type": "paragraph",
        "text": "7"
      },
      {
        "type": "paragraph",
        "text": "No retorno do Responsável, devolver a gestão ordinária da carteira sem transferir retroativamente vendas legitimamente atribuídas durante a cobertura."
      },
      {
        "type": "paragraph",
        "text": "8"
      },
      {
        "type": "paragraph",
        "text": "Em qualquer divergência, preservar os registros, impedir alteração unilateral e documentar a decisão."
      },
      {
        "type": "heading",
        "text": "B. Mapa de Transição para entrada em vigor"
      },
      {
        "type": "paragraph",
        "text": "Antes da Data de Vigência, a empresa deverá registrar as situações em andamento que não podem ser avaliadas apenas pelas novas exigências documentais. O Mapa de Transição deverá conter, no mínimo:"
      },
      {
        "type": "paragraph",
        "text": "Campo"
      },
      {
        "type": "paragraph",
        "text": "Registro mínimo"
      },
      {
        "type": "paragraph",
        "text": "Carteiras vigentes"
      },
      {
        "type": "paragraph",
        "text": "Cliente, Responsável Comercial e data do snapshot"
      },
      {
        "type": "paragraph",
        "text": "Oportunidades ativas"
      },
      {
        "type": "paragraph",
        "text": "Cliente, oportunidade, responsável, estágio e último Registro Material"
      },
      {
        "type": "paragraph",
        "text": "Propostas abertas"
      },
      {
        "type": "paragraph",
        "text": "Número/data, cliente, responsável e validade"
      },
      {
        "type": "paragraph",
        "text": "Programações firmes / contratos"
      },
      {
        "type": "paragraph",
        "text": "Cliente, objeto, período e responsável comercial"
      },
      {
        "type": "paragraph",
        "text": "Coberturas em curso"
      },
      {
        "type": "paragraph",
        "text": "Responsável ausente, Vendedor de Cobertura e período"
      },
      {
        "type": "paragraph",
        "text": "Campanhas vigentes"
      },
      {
        "type": "paragraph",
        "text": "Código, versão, vigência e escopo"
      },
      {
        "type": "paragraph",
        "text": "Matriz vigente"
      },
      {
        "type": "paragraph",
        "text": "Versão e data de vigência"
      },
      {
        "type": "paragraph",
        "text": "Contas institucionais"
      },
      {
        "type": "paragraph",
        "text": "Classificação vigente e fonte oficial do cadastro"
      },
      {
        "type": "paragraph",
        "text": "O Mapa de Transição será arquivado juntamente com a versão oficial desta Política e servirá exclusivamente para preservar a reconstrução objetiva das situações existentes na Data de Vigência."
      }
    ]
  }
];

export function officialPolicyPlainText(chapters: OfficialPolicyChapter[] = POL_COM_001_CHAPTERS): string {
  const lines: string[] = [];
  for (const chapter of chapters) {
    if (chapter.id !== "capa") lines.push(chapter.title);
    for (const block of chapter.blocks) {
      if (block.type === "term") lines.push(block.term, block.definition);
      else lines.push(block.text);
    }
  }
  return lines.join("\n");
}
