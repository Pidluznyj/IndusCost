/**
 * Textos de estados vazios do módulo Estoque — frontend puro.
 */

export const INVENTORY_EMPTY = {
  noItemsRegistered: {
    title: "Sem itens cadastrados",
    description: "Comece cadastrando os materiais, componentes e produtos que você controla no estoque.",
    actionLabel: "Cadastrar primeiro item",
  },
  noItemsForFilter: {
    title: "Nenhum item encontrado",
    description: "Não há itens com os filtros selecionados. Tente ampliar a busca ou limpar os filtros.",
    actionLabel: "Limpar filtros",
  },
  noWarehousesRegistered: {
    title: "Sem almoxarifados cadastrados",
    description: "Cadastre os locais físicos onde o estoque é armazenado (ex.: matéria-prima, produção, expedicao).",
    actionLabel: "Cadastrar almoxarifado",
  },
  noWarehousesForFilter: {
    title: "Nenhum almoxarifado encontrado",
    description: "Ajuste os filtros ou limpe a busca para ver todos os almoxarifados.",
    actionLabel: "Limpar filtros",
  },
  noMovementsInPeriod: {
    title: "Sem movimentações no período",
    description: "Não há registros com os filtros atuais. Amplie o intervalo de datas ou registre uma nova movimentação.",
    actionLabel: "Nova movimentação",
  },
  noMovementsRegistered: {
    title: "Nenhuma movimentação registrada",
    description: "As entradas, saídas e transferências aparecerão aqui assim que forem lançadas.",
    actionLabel: "Registrar movimentação",
  },
  noBalancesForFilter: {
    title: "Sem saldos para o filtro selecionado",
    description: "Nenhum item possui saldo com os critérios atuais. Verifique almoxarifado, item ou limpe os filtros.",
    actionLabel: "Limpar filtros",
  },
  noCountsOpen: {
    title: "Nenhuma conferência aberta",
    description: "Inicie uma conferência física para comparar o saldo do sistema com a contagem real no almoxarifado.",
    actionLabel: "Nova conferência",
  },
  noCountsForFilter: {
    title: "Nenhuma conferência encontrada",
    description: "Não há conferências com os filtros selecionados.",
    actionLabel: "Limpar filtros",
  },
  noReservationsActive: {
    title: "Nenhuma reserva ativa",
    description:
      "Reservas comprometem saldo para pedidos, produção ou uso interno. Crie pela aba Movimentações ou cancele aqui quando autorizado.",
  },
  noBlocksActive: {
    title: "Nenhum bloqueio ativo",
    description: "Bloqueios retêm saldo físico indisponível. Liberação exige motivo e permissão.",
  },
  noAuditEntries: {
    title: "Sem eventos de auditoria",
    description: "Alterações do módulo de estoque aparecerão aqui assim que forem registradas.",
  },
  noRecentMovements: {
    title: "Sem movimentações recentes",
    description: "As últimas entradas e saídas aparecerão aqui quando forem registradas.",
  },
  noImplantation: {
    title: "Nenhuma implantação registrada",
    description:
      "Registre o saldo inicial auditável por item e almoxarifado. Correções usam estorno — nunca edição direta do saldo.",
    actionLabel: "Nova implantação",
  },
} as const;
