# FIN-02 — Política oficial da agenda financeira efetiva

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | FIN-02 |
| **Atualizado** | 2026-07-17 |
| **Natureza** | Política normativa (fonte de verdade de regra) |
| **Inventário prévio** | `docs/finance/effective-schedule-current-flow.md` (FIN-01) |
| **Escopo** | Formalizar a **única** regra financeira de agenda efetiva do IndusCost |
| **Fora de escopo** | Implementação de motores, migrations, sync Nomus |

Este documento define a política que **todos** os consumidores (Detalhe do Pedido, Auditoria 360°, Contas a Receber por pedido, Fluxo de Caixa, Documentos de Saída, alertas, impressão/PDF, exports) devem seguir. Cálculos concorrentes descritos no FIN-01 devem convergir para esta política.

---

## 1. Princípio central

A **agenda financeira efetiva** é o conjunto de valores e vencimentos que ainda representam expectativa ou obrigação de recebimento para o pedido, **após** aplicar cobertura por Documento de Saída e Contas a Receber (CR) reais, e **após** encerrar saldos por atendimento total, corte ou cancelamento.

Há **uma** agenda efetiva por pedido (e seus itens ativos). Não existem quatro agendas somáveis (Pedido + Documento + NF + CR).

### 1.1 Precedência de evidência (imutável)

```text
CR real  >  condição comprovada do Documento  >  previsão do Pedido
```

- O nível superior **substitui** o inferior na **parte coberta** (em valor).
- O nível inferior só permanece no **residual não coberto**.
- Evidência superior **nunca** se soma à inferior como se fossem recebíveis independentes.

### 1.2 Anti-regra: não somar camadas

**CR, Documento, NF-e e Pedido não são somados como quatro recebíveis.**

| Camada | Papel na agenda efetiva |
|---|---|
| **CR real** (`NomusAccountsReceivable`) | Títulos oficiais — aberto/recebido/vencimento do título |
| **Documento de Saída** | Cobertura operacional/faturamento; agenda documental **só** se condição de pagamento estiver **comprovada localmente** |
| **NF-e** | Evidência fiscal / vínculo (não é parcela financeira isolada na agenda) |
| **Pedido** | Previsão vigente **somente** no saldo ainda ativo e não coberto |

Consequências:

1. Total financeiro ≠ Pedido + Documento + NF + CR.
2. Saldo aberto ≠ Pedido − NF.
3. Valor de NF válida informa faturamento/cobertura; **não** cria segunda parcela paralela ao CR da mesma NF.
4. Documento e CR da mesma cadeia usam `max`/substituição na parte coberta — **nunca** `CR + Documento`.

---

## 2. Definições

| Termo | Definição |
|---|---|
| **Valor ativo do item** | Valor comercial ainda elegível a previsão (exclui cancelado e saldo de corte) |
| **Valor ativo do pedido** | Soma dos valores ativos dos itens |
| **Parte coberta** | Fração do valor ativo já representada por Documento válido e/ou CR real |
| **Residual / previsão vigente** | Fração do valor ativo ainda sem cobertura superior |
| **Condição documental comprovada** | Parcelas/vencimentos do Documento persistidos ou reconstruíveis com evidência local suficiente (não inferidos do Pedido) |
| **Aguardando agenda/CR** | Parte coberta por Documento **sem** condição documental comprovada e **sem** CR — não usa datas do Pedido |
| **Corte comercial** | Diferença encerrada por atendimento com corte; **não** é recebível |
| **Previsão provisória** | Residual mantido sob status de item desconhecido, com alerta obrigatório |

Tolerâncias monetárias e de data para *match* título↔parcela ficam a cargo do motor único de implementação; a política exige apenas que a substituição seja determinística e auditável.

---

## 3. Política por estágio de cobertura (pedido)

### 3.1 Sem Documento de Saída

**Regra:** as condições de pagamento do **Pedido** são a **previsão vigente**.

- Parcelas, valores e datas vêm da condição do Pedido (payload / terms oficiais).
- Não há cobertura por Documento nem por CR.
- Alertas de vencimento de previsão aplicam-se a essas parcelas (quando ainda ativas por status de item — §4).

### 3.2 Documento existente sem CR

**Regra:** a parte coberta pelo Documento **deixa de usar as parcelas do Pedido**.

1. **Com condição documental comprovada localmente**  
   - A agenda da parte coberta passa a ser a do **Documento**.  
   - Datas e valores documentais substituem a previsão do Pedido nessa parte.

2. **Sem condição documental disponível**  
   - A parte coberta classifica-se como **aguardando agenda/CR**.  
   - **Não** reutilizar datas do Pedido para a parte já faturada/coberta pelo Documento.  
   - Essa parte **não** gera alerta de “previsão do pedido vencida” como se ainda fosse parcela do Pedido.

3. O **residual** (valor ativo − cobertura do Documento) permanece previsto pelas **condições e datas originais do Pedido**.

4. **Entrega parcial com saldo ativo (FIN-13):** quando houver Documento/CR parcial, item ainda ativo e **mais de uma** posição planejada, **não** ratear o residual sobre todas as parcelas. Cada entrega ocupa a **próxima posição aberta**; o saldo comercial ativo redistribui-se **somente** nas posições restantes (pesos relativos). Substituição integral (residual zero) permanece inalterada. Detalhes: `docs/finance/staged-delivery-schedule-remediation.md`.

### 3.3 CR real existente

**Regra:** os títulos reais de CR **substituem** a agenda do Documento (e a do Pedido) na **parte coberta** pelo CR.

- Aberto, recebido e vencimento oficiais vêm de `NomusAccountsReceivable`.
- Parcelas documentais ou do Pedido correspondentes à parte coberta tornam-se evidência histórica / substituídas — **não** compõem total aberto operacional.
- Residual do pedido (se houver) continua sob as regras de item (§4) e datas do Pedido.

---

## 4. Política por status de item

O status do item determina se o valor do item (ou fração) entra na previsão. A classificação de status segue o parser oficial e a evidência documentada no FIN-01; códigos sem evidência não autorizam zerar saldo.

### 4.1 Item atendido totalmente

- **Residual = zero** para o item.
- Nenhuma previsão do Pedido permanece para esse item.
- Cobertura financeira, se existir, está em Documento/CR; não há saldo previsto paralelo.

### 4.2 Item atendido com corte

- **Residual = zero** para o item.
- A diferença entre pedido e atendido classifica-se como **corte comercial**.
- Corte **não entra** em:
  - Contas a Receber (como título ou previsão),
  - Fluxo de Caixa,
  - alertas de vencimento de previsão.
- Corte é evidência operacional/comercial (auditoria), não recebível.

### 4.3 Item atendido parcialmente

- **Somente o saldo ainda ativo** permanece como previsão.
- A parte já atendida/coberta segue §3 (Documento/CR).
- No residual ativo: **manter as datas originalmente planejadas do Pedido** (proporção de valor; calendário do Pedido preservado).

### 4.4 Item não atendido

- A **previsão permanece ativa** (condições do Pedido), enquanto não houver cobertura superior (§3).
- Datas e estrutura de parcelas do Pedido vigem integralmente sobre o valor ativo do item.

### 4.5 Item cancelado

- **Residual = zero**.
- Cancelamento encerra previsão; não gera aberto nem alerta de vencimento de previsão.

### 4.6 Status desconhecido

- **Nunca zerar silenciosamente.**
- Preservar **somente** o valor ainda **não coberto** (por Documento/CR) como **previsão provisória**.
- Gerar **alerta de classificação pendente** (obrigatório, auditável).
- Consumidores devem tratar a linha como provisória (rótulo/alerta), não como previsão definitiva.

---

## 5. O que compõe a agenda efetiva (saída canônica)

A agenda efetiva de um pedido é a união disjunta (sem overlap de valor) de:

| Componente | Inclui | Não inclui |
|---|---|---|
| **Títulos CR reais** | Abertos e baixados oficiais ligados ao pedido/NF | Valores de corte; cancelados |
| **Agenda documental comprovada** | Parcelas do Documento na parte coberta sem CR | Datas inventadas a partir do Pedido |
| **Aguardando agenda/CR** | Parte coberta por Documento sem condição local e sem CR | Vencimento “falso” do Pedido |
| **Previsão do Pedido (residual)** | Valor ativo não coberto; datas do Pedido | Parte faturada; corte; cancelado |
| **Previsão provisória** | Residual sob status UNKNOWN + alerta | Zeramento implícito |

Totais oficiais derivados:

- **Total financeiro esperado** = CR original (valor dos títulos) + previsão ainda aplicável (residual/provisória/documental comprovada sem CR), **sem** recontar substituídos.
- **Total aberto operacional** = aberto de CR + aberto de previsões ainda aplicáveis (exclui substituídos, corte, cancelados, aguardando sem data falsa).
- **Corte comercial** e **cancelados** = fora dos totais de recebível.

---

## 6. Alertas (política mínima)

| Situação | Alerta / comportamento |
|---|---|
| Previsão do Pedido (residual ativo) vencida sem CR | Alerta de previsão vencida |
| Parte coberta por Documento sem condição e sem CR | Aguardando agenda/CR — **não** alertar como parcela do Pedido vencida |
| Parcela/título substituído por CR | Evidência de substituição; **não** alerta de vencimento da previsão substituída |
| Status de item desconhecido com residual | **Alerta de classificação pendente** (obrigatório) |
| Corte comercial | Sem alerta de vencimento financeiro |

Códigos concretos de implementação podem reutilizar ou alinhar os existentes (`PLANNED_RECEIVABLE_*`, etc.), desde que respeitem esta tabela.

---

## 7. Consumidores obrigados à política

Qualquer tela, API, export, PDF ou job que exponha “o que falta receber / quando” de um pedido **deve** usar o motor único alinhado a esta política, incluindo:

1. Detalhe financeiro do Pedido e impressão/PDF  
2. Auditoria 360° (aba Financeiro e alertas)  
3. Contas a Receber quando filtrado/contextualizado por pedido  
4. Fluxo de Caixa, se passar a incluir previsão de pedido  
5. Documentos de Saída (evidência financeira)  
6. Materializações O2C / Status Pedidos quando exibirem recebível planejado  
7. Exports comerciais que misturem forecast e CR  

É **proibido** manter regras locais que:

- somem Pedido + Documento + NF + CR,
- reutilizem datas do Pedido na parte já faturada sem condição documental,
- tratem corte como aberto ou previsão vencida,
- zerem residual de status desconhecido sem alerta.

---

## 8. Relação com o estado atual (FIN-01)

| Política (FIN-02) | Estado atual (FIN-01) |
|---|---|
| Precedência CR > Doc > Pedido | Já parcialmente em `buildSalesOrderPlannedReceivables` / `computeSalesOrderFinancialCoverage` |
| Não reutilizar datas do Pedido na parte faturada sem condição documental | Pode divergir se residual só redistribui datas do Pedido sobre valor “coberto” sem estado “aguardando agenda/CR” |
| Corte fora de CR / caixa / alertas | Alinhado em O2C (`ORDER_ITEM_CUT`) e flags `nomusIsCut`; consumidores devem garantir exclusão |
| Status desconhecido com alerta | Requer garantia explícita no motor único (hoje UNKNOWN não pode zerar em silêncio) |
| Um motor | Ainda há implementações concorrentes (A/B/C/D) — convergência é trabalho posterior |

FIN-02 **não** altera código. Implementações futuras devem tratar este arquivo como contrato.

---

## 9. Decisões explícitas (checklist normativo)

1. Sem Documento → previsão = condições do Pedido.  
2. Documento sem CR → parte coberta sai das parcelas do Pedido; usa condição documental **só se comprovada**; senão **aguardando agenda/CR**; **proibido** reusar datas do Pedido na parte faturada.  
3. CR real → substitui agenda do Documento na parte coberta.  
4. Atendido totalmente → residual zero.  
5. Atendido com corte → residual zero; diferença = corte comercial; fora de CR, Fluxo de Caixa e alertas de vencimento.  
6. Atendido parcialmente → só saldo ativo previsto; datas originais do Pedido no residual.  
7. Não atendido → previsão ativa.  
8. Cancelado → residual zero.  
9. Desconhecido → residual não coberto como provisório + alerta; nunca zerar silenciosamente.  
10. CR + Documento + NF + Pedido **não** se somam como quatro recebíveis.

---

## 10. Próximo passo sugerido

FIN-03+ — implementar/ajustar o motor único (`salesOrderPlannedReceivables` e consumidores) para cumprir literalmente esta política, incluindo o estado **aguardando agenda/CR** e o alerta de classificação pendente para status desconhecido.
