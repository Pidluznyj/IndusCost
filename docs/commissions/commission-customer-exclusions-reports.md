# Clientes das Exceções por cliente fora dos relatórios dos vendedores

2026-09-28 — pedido do usuário: clientes cadastrados em **Comercial › Comissões › Exceções por
cliente** não aparecem em nenhum relatório de comissão dos vendedores, mesmo que o vendedor tenha
feito a venda. Substitui a regra anterior ("entram na visão do vendedor com comissão zerada, para
transparência da carteira").

## Regra

- Venda de cliente coberto por regra ativa (status do motor `CUSTOMER_EXCLUDED`) não aparece:
  nem linha, nem total (recebido, base, comissão bruta), nem card/coluna de "comissão excluída",
  "recebido cliente excluído" ou "clientes excluídos".
- Ponto único: `isCustomerExcludedFromCommissionReports`,
  `partitionReceiptClosingLinesByCustomerExclusion` e `omitCustomerExcludedFromCommissionReports`
  em `src/lib/commissions/commissionReceiptClosingApi.shared.ts`.
- Vigência: vale o que a regra já decide (cliente + data da venda). Venda fora da vigência
  continua comissionada e aparece normalmente.
- Motor (2026-09-28, correção pós-homologação): a regra vale também para título com schedule
  materializado — schedule gravado antes do cadastro da regra ou zerado "sem regra". Antes só o
  título sem schedule era conferido; o schedule ditava o status e a venda da Esmaltec (NF 7134 /
  PD 02364, schedule zerado → `NO_RULE`) aparecia para a vendedora. Agora
  `previewLineFromMaterializedSchedule` confere `resolveCustomerExclusionForReceivable` antes:
  a linha vira `CUSTOMER_EXCLUDED`, libera zero e a comissão bruta guarda o que o schedule daria
  (auditoria). Vale para prévia, fechamento e previsão.

## Onde vale

| Tela / documento | Como |
|------------------|------|
| Fechamento do mês (tela, XLSX, CSV, PDF) | `enrichReceiptClosingPagePayload` separa as linhas em `customerExcludedAuditLines` (como já fazia com as empresas do grupo); linhas, vendedores, cards, resumo e composição usam só o restante. `decorateReceiptClosingPage` remove a auditoria antes de responder — nem o escopo "own" recebe essas linhas. |
| Fechamentos (lista, detalhe, relatório por vendedor, XLSX/PDF) | Usam a página do fechamento: mesma regra. |
| Relatórios (tela e XLSX) | `assembleCommissionReportsPayload` e a exportação descartam as linhas `CUSTOMER_EXCLUDED`, inclusive as reclassificadas pela regra ativa na data do recebimento (`applyActiveCustomerExclusionsToReportLines`). |
| Provisão por pedido (tela, PDF, XLSX) | Sai o snapshot (NF) inteiro com item `CUSTOMER_EXCLUDED` ou coberto por regra ativa na data da venda (`customerExcludedByActiveRule`), inclusive com "Incluir comissão zero" / "Somente comissões zeradas". |
| Previsão (títulos em aberto; aba oculta) | Mesma regra no payload oficial (`buildReceivableForecastOfficialPayload`). |

## O que não muda

- Ledger, schedules, cobertura (`CommissionReceiptCoverage`) e conciliação com o Nomus: a linha
  do cliente excluído continua registrada, com comissão zero (e passa a contar como coberta, não
  como pendência).
- Fechamento oficial já gravado (a partir de 10/2026) mostra o que foi fechado, sem as linhas
  `CUSTOMER_EXCLUDED`; cliente cadastrado depois do fechamento continua nas linhas daquele mês
  (a comissão foi apurada) — para mudar, reprocessar.
- Histórico Nomus já gravado (registro técnico, sem reprocesso): a regra ativa é aplicada só na
  exibição (`legacyDisplayExclusionRules` em `buildReceiptClosingPageFromLedger`, data do
  recebimento) — a linha sai do relatório e vai para a auditoria; o ledger não muda.
- Empresas do grupo seguem como auditoria opcional ("Mostrar empresas do grupo na auditoria").

## Auditoria

- Aba **Exceções por cliente** → "Reconciliação com Fechamento do mês": clientes excluídos,
  títulos, recebido e impacto por regra, lidos de `customerExcludedAuditLines` direto dos builders
  no servidor (`buildCustomerExclusionClosingReconciliation`). O impacto por regra usa
  `exclusionRuleId` da linha (o motor deixa `ruleId` nulo no cliente excluído; antes toda regra
  aparecia como "Sem impacto no mês").
- Auditoria visual (técnica, aba oculta) continua listando as linhas.

## Efeito nos números e nas exportações

- "Total recebido gerencial", "Recebido único" por vendedor, base e comissão bruta deixam de incluir
  os clientes excluídos (antes eles entravam no grupo "Sem vendedor / Excluído").
- XLSX do fechamento: coluna "Cliente excluído?" vira "Empresa do grupo?"; saem "Comissão excluída"
  (Por vendedor) e "Clientes excluídos"/"Comissão excluída" (Resumo).
- CSV do fechamento: saem `receivedExcludedCustomerAmount`, `excludedCommissionAmount` e
  `excludedCustomerCount` do cabeçalho.
- XLSX de Relatórios: saem "Comissão excluída", "Comissão excluída R$", "Cliente excluído (regra)",
  "Clientes excluídos (únicos)" e "Comissão excluída por regra".
- Provisão por pedido: sai a coluna "Cliente excluído"; "Comissão bruta (antes exclusão)" vira
  "Comissão bruta".

## Testes

`commissionReceiptEngine.test.ts`, `commissionReceiptClosingApi.test.ts`, `commissionReports.test.ts`,
`commissionReceiptClosingDetailExport.test.ts`, `commissionClosings.test.ts`,
`commissionOrderProvision.test.ts`, `commissionCustomerExclusionClosingReconciliation.test.ts` e
`commissionsCustomerExclusionsUi.test.ts` (todos em `npm run test:commissions`).
