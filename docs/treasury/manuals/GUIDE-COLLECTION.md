# Guia — Cobrança (Contas a Receber operacional)

**Tela:** `/finance/treasury/receivables`  
**Também exige** permissão de leitura da CR oficial (`finance.accounts_receivable`).

## 1. Visão da lista
Use filtros (cliente, documento, vencimento, expectativa, status, atraso, prioridade, responsável).  
Badges mostram atraso, prioridade e próximas ações.

## 2. Drawer do título
Ao clicar no título:
- dados oficiais Nomus (somente leitura);
- complemento operacional;
- promessas;
- timeline de cobrança;
- contestações;
- resumo financeiro do cliente.

## 3. Expectativa (data esperada)
1. Informe data esperada / conta / responsável / prioridade / ação.  
2. Justifique mudança de data quando exigido.  
3. **Vencimento oficial permanece igual.**

## 4. Promessa de pagamento
1. Crie promessa com data e valor.  
2. Parcial é permitido; acima do saldo exige confirmação.  
3. Marque cumprida ou cancele — histórico preservado.  
4. Promessa **não** é baixa.

## 5. Registrar ação de cobrança
Tipos: telefone, WhatsApp, e-mail, reunião, comercial, análise, outro.  
Inclua próximo passo quando houver.  
Cancelamento é lógico (não apaga a linha).

## 6. Contestação
Abra disputa com motivo, valor e prazo.  
Não zera saldo oficial.  
Mantenha alerta/exceção visível enquanto aberta.

## 7. Boas práticas
- Priorize HIGH/URGENT e vencidos sem ação.  
- Não use contestação para esconder atraso.  
- Alinhe vendedor × comercial × cobrança pelo resumo do cliente (papéis distintos).  
- Após mudanças relevantes, confira impacto na agenda/projeção (recálculo assíncrono).

## Permissões úteis
| Ação | Resource |
|------|----------|
| Ver lista | `finance.treasury.receivables` `view` |
| Expectativa/disputa | `…receivables` `manage` |
| Promessa | `…receivables.promise` `execute` |
| Cobrança | `…receivables.collection` `execute` |
