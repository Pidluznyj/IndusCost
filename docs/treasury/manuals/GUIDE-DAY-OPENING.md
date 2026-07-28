# Guia — Abertura do dia

**Objetivo:** deixar a Tesouraria pronta para operar o dia civil corrente (`America/Sao_Paulo`).

## Checklist

### 1. Entrar no módulo
1. Acesse `/finance/treasury`.  
2. Confirme que a Visão geral carrega (não “módulo desabilitado” / sem permissão).

### 2. Conferir freshness
No dashboard, verifique indicadores de atualização:
- snapshots de saldo;
- sync de Contas a Receber;
- sync de Contas a Pagar;
- complementos.

Se alguma fonte estiver **stale**, acione sync Nomus (processo TI/financeiro já existente) antes de decisões críticas.

### 3. Atualizar saldos observados
Para cada conta operacional:
1. Contas financeiras → conta → saldos.  
2. Registre snapshot do dia (motivo obrigatório quando a regra exigir).  
3. Confira divergência observado × calculado — **não ignore** sem anotar.

### 4. Revisar alertas e exceções
1. Alertas no dashboard / `GET …/alerts`.  
2. Tela Exceções: priorize CRITICAL/HIGH (saldo negativo, sync atrasado, promessa vencida, etc.).

### 5. Olhar o caixa do dia
1. Dashboard: previsto × realizado CR/CP.  
2. Agenda: horizonte curto (hoje / 7 dias).  
3. Programação de pagamentos: intenções do dia.  
4. Transferências em trânsito (`SENT`).

### 6. Preparar cobrança e CP
- CR: títulos vencidos / sem expectativa / promessas a vencer.  
- CP: programar ou autorizar pagamentos do dia.

## Pronto para operar quando
- [ ] Dashboard OK  
- [ ] Saldos do dia atualizados (ou ressalva consciente)  
- [ ] Fontes não críticas ou com plano de sync  
- [ ] Exceções prioritárias triadas  

Seguir para operação e, ao final, [GUIDE-DAY-CLOSING.md](./GUIDE-DAY-CLOSING.md).
