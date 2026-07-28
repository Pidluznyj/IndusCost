# Manual do usuário — Central de Tesouraria

**Público:** time financeiro / tesouraria  
**Acesso:** menu Financeiro → Central de Tesouraria (`/finance/treasury`)  
**Pré-requisito:** permissão concedida + módulo habilitado pela TI.

## 1. O que é

A Central concentra o **caixa bancário operacional**: contas, saldos, agenda, cobrança, programação de pagamentos, OFX, conciliação e fechamento diário.

Ela **não substitui**:
- cadastro oficial de títulos no Nomus / telas Contas a Receber e a Pagar;
- Fluxo de Caixa gerencial;
- Conciliação de Carteira (pedido/NF).

## 2. Mapa das telas

| Tela | Para que serve |
|------|----------------|
| Visão geral | Saldo, previsto×realizado do dia, alertas, atalhos |
| Contas financeiras | Cadastro, ACL, liquidez, consolidado |
| Saldos (na conta) | Histórico e atualização de saldo |
| Contas a receber | Lista operacional + drawer (expectativa, promessa, cobrança, disputa) |
| Contas a pagar | Lista + programação de pagamento |
| Programação de pagamentos | Agenda das intenções CP |
| Agenda financeira | Caixa dia a dia por cenário |
| Comparação de cenários | Contratual × provável × confirmado |
| Transferências | Entre contas IndusCost |
| Lançamentos manuais | Extrato local (não é baixa Nomus) |
| Movimentos bancários / OFX | Importar extrato |
| Conciliação bancária | Workspace de matches |
| Exceções | Central de problemas |
| Fechamento diário | Preview, fechar, reabrir |
| Relatórios | Consulta + CSV/XLSX/PDF |
| Auditoria | Trilha de alterações |

## 3. Conceitos que você precisa lembrar

1. **Vencimento oficial** não muda quando você informa data esperada ou promessa.  
2. **Previsto e realizado** do mesmo título não se somam.  
3. **Transferência** entre contas não muda o caixa consolidado.  
4. **Divergência de saldo** aparece de propósito — não some sozinha.  
5. Histórico não é apagado: use cancelar / reverter / reabrir.

## 4. Rotina sugerida

1. Abrir o dia ([GUIDE-DAY-OPENING.md](./GUIDE-DAY-OPENING.md)).  
2. Cobrança CR ([GUIDE-COLLECTION.md](./GUIDE-COLLECTION.md)).  
3. Programar CP e transferências.  
4. OFX + conciliação ([GUIDE-RECONCILIATION.md](./GUIDE-RECONCILIATION.md)).  
5. Tratar exceções/alertas.  
6. Fechar o dia ([GUIDE-DAY-CLOSING.md](./GUIDE-DAY-CLOSING.md)).

## 5. Permissões comuns

Se um botão não aparece ou a API retorna 403:
- peça à TI a bag correspondente (`finance.treasury.*`);
- confirme se a flag do recurso está ligada;
- em contas específicas, verifique ACL da conta (acesso VIEW/OPERATE/MANAGE).

## 6. Dinheiro e datas na tela

- Valores em formato brasileiro na UI; API usa string decimal.  
- Datas de caixa são datas civis (dia calendário), não “agora” do servidor em UTC cru.

## 7. Onde pedir ajuda

- Dúvida de processo: tesoureiro / responsável financeiro.  
- Erro técnico, migrate, flag: TI (ver `docs/treasury/18-AUDIT-JOBS-AND-OPERATIONS.md`).
