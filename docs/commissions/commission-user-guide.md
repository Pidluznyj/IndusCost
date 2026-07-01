# Guia do usuário — Módulo Comissões (IndusCost)

Este guia explica como usar o módulo **Comissões** para acompanhar, liberar e pagar comissões comerciais com transparência gerencial.

## Visão geral do fluxo

```text
Pedido de Venda  →  Comissão prevista
       ↓
NF-e / Documento de Saída  →  Comissão confirmada
       ↓
Contas a Receber (recebimento)  →  Liberação proporcional
       ↓
Lote de pagamento  →  Comissão paga ao comissionado
```

O módulo **não altera** Formação de Preço, Financeiro, CRM ou sincronização Nomus — apenas **lê** dados já integrados e registra o controle interno de comissões.

---

## Conceitos essenciais

### Comissão prevista

Registro calculado a partir do **Pedido de Venda**, antes da confirmação fiscal definitiva. Representa uma **estimativa** com base nas regras vigentes, no vendedor/representante e nos itens do pedido.

- Status típicos: **Prevista pelo Pedido**, **Aguardando NF-e**
- O pedido é **provisório** porque pode ser alterado, cancelado ou ainda não faturado
- A previsão ajuda gestão antecipada, mas **não substitui** a confirmação fiscal

### Comissão confirmada

Registro atualizado quando existe **NF-e autorizada** e **Documento de Saída** vinculado. A base de cálculo passa a refletir o faturamento real.

- Status típico: **Confirmada por Documento de Saída**
- A previsão anterior pode ser **Substituída por Documento de Saída**

### Por que Documento de Saída e Contas a Receber substituem a previsão?

| Etapa | Papel |
|-------|--------|
| **Pedido** | Origem provisória — condições comerciais ainda podem mudar |
| **Documento de Saída / NF-e** | Confirma o que foi efetivamente faturado |
| **Contas a Receber** | Fonte definitiva de **liberação** conforme recebimento real |

Assim, a comissão acompanha o risco e o caixa da operação: prevista → confirmada → liberada → paga.

### Liberação

**Liberar** significa reconhecer que parte (ou total) da comissão pode ser paga ao comissionado, geralmente **proporcional ao recebimento** das Contas a Receber.

- **Liberada parcial** — parte do valor já pode ser paga
- **Liberada total** — valor integral liberado, aguardando pagamento
- **Aguardando recebimento** — CR ainda não quitada ou parcial

Tela: **Liberação por Recebimento** (`/commissions/releases`).

### Pagamento

**Pagamento** é o controle interno IndusCost de quanto foi efetivamente pago ao comissionado. **Liberada ≠ paga.**

Fluxo recomendado:

1. Selecionar comissões **liberadas** e não pagas
2. Criar **lote de pagamento** (rascunho)
3. **Aprovar** o lote (se configurado)
4. **Marcar como pago** com data de pagamento

Tela: **Pagamentos** (`/commissions/payments`).

---

## Navegação do módulo

| Seção | Rota | Finalidade |
|-------|------|------------|
| Dashboard | `/commissions` | KPIs, gráficos e atalhos |
| Comissões Previstas | `/commissions/forecast` | Previsões por pedido |
| Comissões Confirmadas | `/commissions/confirmed` | Confirmadas por NF-e/doc. saída |
| Liberação por Recebimento | `/commissions/releases` | Parcelas CR e liberação |
| Pagamentos | `/commissions/payments` | Lotes de pagamento |
| Pessoas Comissionadas | `/commissions/persons` | Vendedores, representantes, etc. |
| Regras de Comissão | `/commissions/rules` | Percentuais, bases e condições |
| Auditoria | `/commissions/audit` | Inconsistências e divergências |
| Configurações | `/commissions/settings` | Parâmetros globais do módulo |

O menu lateral **Comissões** abre o módulo. As abas internas destacam a seção ativa.

---

## Como configurar regras

1. Acesse **Regras de Comissão**
2. Crie uma regra informando:
   - **Beneficiário** (vendedor do pedido, representante ou pessoa fixa)
   - **Percentual** sobre a base escolhida
   - **Base** (pedido, documento de saída ou valor recebido)
   - **Regra de liberação** (pedido criado, doc. saída, primeira CR ou cada CR)
   - **Condições** opcionais (cliente, produto, vendedor, vigência, etc.)
3. Use **prioridade** quando houver mais de uma regra aplicável
4. Consulte **uso da regra** para ver quantos registros a utilizaram

Sem regra aplicável, o sistema registra issue em **Auditoria** (`NO_COMMISSION_RULE`).

---

## Como usar a auditoria

A auditoria é **obrigatória** para gestão — o módulo não deve ser caixa-preta.

1. Acesse **Auditoria** e revise issues **críticas abertas** primeiro
2. Use filtros (severidade, tipo, pedido, NF-e, comissionado)
3. Abra o **detalhe** para ver metadados, entidade relacionada e ação sugerida
4. Corrija a causa (regra, vínculo Nomus, CR, etc.)
5. **Reprocesse o período** ou marque como resolvida após análise
6. Use **Reexecutar auditoria do período** após correções em massa

Tipos comuns: pedido sem vendedor, NF-e sem documento de saída, NF-e sem CR, comissão paga sem liberação.

---

## Configurações globais

Em **Configurações** (`/commissions/settings`):

- **Cálculo** — previsão por pedido, substituição por doc. saída, CR como fonte de liberação
- **Pagamento** — pagamento manual, parcial, aprovação obrigatória
- **Auditoria** — quais issues gerar automaticamente
- **Escopo** — calcular para vendedores/representantes, permitir pessoa fixa

Após alterar parâmetros de cálculo, **reprocesse o período** para refletir nos registros existentes.

---

## Status de comissão (referência)

| Código | Label na interface |
|--------|-------------------|
| `FORECAST_FROM_ORDER` | Prevista pelo Pedido |
| `WAITING_NFE` | Aguardando NF-e |
| `SUPERSEDED_BY_OUTPUT_DOCUMENT` | Substituída por Documento de Saída |
| `CONFIRMED_BY_OUTPUT_DOCUMENT` | Confirmada por Documento de Saída |
| `WAITING_RECEIVABLE` | Aguardando Contas a Receber |
| `WAITING_PAYMENT` | Aguardando recebimento |
| `PARTIALLY_RELEASED` | Liberada parcial |
| `RELEASED` | Liberada total |
| `PAID_PARTIAL` | Paga parcial |
| `PAID_TOTAL` | Paga total |
| `CANCELLED` | Cancelada |
| `REVERSED` | Estornada |
| `ERROR` | Erro/Auditoria |

Valores em **BRL** e datas em formato **pt-BR** em todas as telas.

---

## Permissões e escopo

- **SUPER_ADMIN / ADMIN** — acesso amplo; escopo de dados global no backend
- **Perfis gerenciais** — conforme permissões `commissions.*` (view, manage, etc.)
- **Vendedor (SELLER)** — escopo **próprio**: vê apenas comissões vinculadas ao seu `externalSellerId` / responsável Nomus; o backend aplica filtro, não só a interface

Permissões insuficientes ocultam seções do menu interno e retornam **403** na API.

---

## Boas práticas

1. Mantenha **Pessoas Comissionadas** sincronizadas (importação Nomus quando aplicável)
2. Revise **Auditoria** semanalmente
3. Confirme **Regras** antes de fechamento mensal
4. Separe mentalmente **liberada** (direito) de **paga** (caixa)
5. Reprocesse comissões após correções de integração Nomus

---

## Documentação técnica

Arquitetura e endpoints: `docs/commissions/commission-module-blueprint.md`.
