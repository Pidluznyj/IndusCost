# PC00637 (ID Nomus 638) — diagnóstico individual

Caso de referência da correção da sincronização de Pedidos de Compra Nomus. Arquitetura:
[`purchase-orders-independent-sync-and-reconciliation.md`](purchase-orders-independent-sync-and-reconciliation.md).

## 1. Identificação oficial

| Campo | Valor | Origem no código |
|---|---|---|
| Número do pedido | `PC00637` | `codigoPedido` → `NomusPurchaseOrder.orderNumber` (`ORDER_NUMBER_KEYS` do mapper) |
| ID oficial Nomus | `638` | `id` → `NomusPurchaseOrder.externalId` (chave única do espelho) |
| Emissão | 22/10/2026 | `dataEmissao` → `issuedAt` |
| Fornecedor | QUIMICOS E PLASTICOS IND. E COM. DE PROD. DERIV. — CNPJ 03.261.226/0001-34 | `nomeFornecedor` / `cnpjFornecedor` |
| Parcelas planejadas | R$ 31.114,39 | `rawPayload.parcelas[]` (somente no espelho) |

O espelho `NomusPurchaseOrder` é independente do pedido interno `PurchaseOrder` (compra criada no IndusCost,
status RASCUNHO…CANCELADO): não há chave nem relação entre os dois, e nada desta correção altera o pedido
interno.

## 2. Por que continuava "Aprovado" em 23/10

1. O sync só fazia upsert do que a API devolvia (`sliding_window_upsert`, 45 dias). Um pedido que deixa de
   vir da API nunca era tocado: a fase gravada (`APPROVED`) ficava congelada.
2. Não havia reconciliação de ausentes em nenhum fluxo (nem comparação de IDs, nem histórico).
3. Compras só rodava encadeado ao runner de CR e só após sucesso de CR; o runner pegava o lock global com
   `flock -n` e saía com código 0 sem registro quando ocupado.

Exclusão ≠ cancelamento: um pedido **cancelado** no Nomus continua sendo devolvido pela API com
`cancelado=true` e vira fase `CANCELED`; um pedido **excluído** simplesmente deixa de existir na listagem.

## 3. Evidências disponíveis e o que falta confirmar

Disponível (da execução observada no servidor, relatada na missão): 634 pedidos processados sem erro e sem
HTTP 429 na janela de 45 dias, e o ID 638 não aparece nos logs. Como os IDs de pedidos chegam a ~640, 634
registros numa janela de 45 dias sugerem que o filtro `dataInicio`/`dataFim` é ignorado pela API e que a
listagem devolve praticamente o universo inteiro. **Isso é uma hipótese**: não prova que o 638 sumiu.

Não foi possível consultar daqui: não há banco nem credencial Nomus nesta máquina, e o servidor (homologação
e produção) fica fora do alcance do executor local. A confirmação é feita com o script somente leitura,
executado no servidor:

```bash
cd /opt/induscost
npm run nomus:purchase-orders:audit-presence -- --external-id=638 --nomus-lookup --nomus-scan
```

O relatório (JSON) responde, sem gravar nada:

- `order`: estado local (fase, presença, `lastSeenAt`, `syncedAt`) e o que está preservado (itens, avaliação,
  vínculos de CP, parcelas planejadas, eventos). Valores só com `--show-amounts`.
- `nomusLookup`: resposta do `GET pedidoscompra/638` — `found` (com fase) ou `inconclusive` com o motivo
  (`LOOKUP_404_SEMANTICS_NOT_VALIDATED` quando o Nomus responde 404). 404 nunca é tratado como prova aqui.
- `nomusScan`: varredura completa da listagem — páginas, registros, `drained` (chegou ao fim), `foundInList`
  e `conclusive`.
- `diagnosis`: frases com a explicação para o estado observado.

Leitura do resultado:

| `nomusScan.foundInList` | `nomusLookup` | Conclusão |
|---|---|---|
| `true` | `found` | Pedido existe no Nomus. Investigar fase/filtro; não é exclusão. |
| `false` (e `conclusive`) | `inconclusive` 404 | Fortemente ausente. Registrar a resposta do 404 para decidir `NOMUS_PO_DIRECTED_LOOKUP_TRUST_404`. |
| `false` (e `conclusive`) | `found` | A listagem omite um pedido existente: a listagem não é confiável como universo — não ligar a reconciliação. |
| qualquer, com `conclusive=false` | — | Varredura incompleta: repetir; nada pode ser concluído. |

## 4. Comportamento esperado depois da implantação

Com as flags padrão nada muda no 638. Seguindo as etapas do documento de arquitetura:

1. **Prévia** (painel › Prévia de reconciliação): o run `FULL_RECONCILIATION_PREVIEW` lista o 638 em
   `missingCandidatesSample` se ele realmente não vier na varredura completa. Nada é gravado.
2. **1ª reconciliação autorizada** (`NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED=1` + Autorizar ausências):
   638 → `MISSING_CANDIDATE`, evento `MISSING_CANDIDATE` com a evidência do run (páginas, registros,
   completude). Continua na carteira com o selo "Ausente no Nomus — em verificação".
3. **2ª varredura completa** em outra execução, ≥ 20 h depois, com `NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED=1`:
   638 → `MISSING_CONFIRMED` ("Ausente no Nomus — confirmado"), `sourceRemovedAt` preenchido, sai da carteira
   padrão e dos KPIs da lista (continua no filtro de histórico e no detalhe).
4. Se o Nomus voltar a devolver o 638 em qualquer momento → `REACTIVATE`, volta a `PRESENT`.

O rótulo "Excluído no Nomus" não é usado: a API não fornece evidência oficial de exclusão.

## 5. Preservação e impacto financeiro

- Nada é apagado: pedido, itens, parcelas planejadas (`rawPayload`), avaliação de fornecedor, vínculos com
  Contas a Pagar e histórico permanecem. A fase oficial não é alterada.
- As parcelas planejadas vivem só no espelho; não são títulos de Contas a Pagar. Ausência não cria, altera nem
  cancela título, pagamento ou comissão.
- Vínculos existentes com Contas a Pagar ficam como estão (a propriedade financeira não é recalculada). Com o
  pedido confirmado ausente, vínculo novo é recusado (409 `PURCHASE_ORDER_MISSING_IN_NOMUS`).
- Efeito visível: depois da confirmação, os R$ 31.114,39 deixam de entrar em "Valor aberto" da lista de
  Pedidos Nomus (carteira padrão). Indicadores derivados (Performance de fornecedores, PMP) só excluem o pedido
  com `NOMUS_OPS_EXCLUDE_MISSING_PURCHASE_ORDERS_ENABLED=1`.

## 6. Reprodução automatizada

`src/lib/nomus/nomusPurchaseOrderSync.pg17.integration.test.ts` reproduz o caso com um Nomus simulado num
PostgreSQL 17 descartável: incremental não remove → só-prévia → candidata → intervalo → falha 503 → limite de
páginas → confirmada → carteira/KPIs → bloqueio de vínculo novo → reativação, sem nenhuma exclusão física.
