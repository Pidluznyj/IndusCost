# DS-03.1 — Plano de correção do stage e dos vínculos de Documentos de Saída

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Planejamento técnico (sem código funcional, migration, sync, API ou UI nesta etapa) |
| **Data** | 2026-07-17 |
| **Base** | DS-01 (`current-state-audit.md`), DS-02 (auditor DB + exploração de sync/UI) |
| **Ambiente** | Cursor local — **sem** acesso ao banco/servidor de produção |

---

## 1. Princípios oficiais (não negociáveis)

| Camada | Fonte oficial | Papel |
|---|---|---|
| Cabeçalho e itens | `NomusStockDocument` + `NomusStockDocumentItem` | Stage canônico do Documento de Saída |
| NF-e | `NomusNfe` | Identidade fiscal (`externalId`) |
| Alocação Pedido ↔ Documento | `OrderToCashAuditFact` (enquanto não houver relação canônica melhor) | Derivada / reconstruível |
| Financeiro | `NomusAccountsReceivable` | CR real via `sourceInvoiceId` → NF |
| Precedência financeira | CR real > condição comprovada do documento > previsão do pedido | Ordem de uso |

**Proibido nesta correção:**

- criar model `OutputDocument` / `SalesDocument` paralelo;
- promover facts O2C a master;
- misturar `InventoryMovement` (Comissões) com o stage Nomus;
- inventar cliente/empresa/status por heurística frágil;
- apagar evidência de itens quando o payload Nomus vier incompleto.

---

## 2. Lacunas confirmadas (DS-02)

1. Cabeçalho do stage é mínimo; cliente, empresa, status, totais oficiais e condição de pagamento ficam no `rawJson` ou ausentes.
2. Sync aplica `deleteMany` + recria itens em todo apply — payload vazio/parcial apaga filhos válidos.
3. Sem `payloadHash` / presence / stale no documento de estoque.
4. Telas (detalhe do Pedido e Auditoria 360°) descobrem documentos só a partir do run atual de O2C.
5. Documento no stage sem fato O2C **não aparece** na interface.
6. Valor total do documento pode ser duplicado quando um item gera vários facts de rateio.
7. Projeção de itens usa `factsForDoc.find(...)` (primeiro vínculo), perdendo rateios.
8. Coluna de CR no item da Auditoria permanece `null` mesmo com CR relacionado à NF.
9. `includeRaw=true` declara `audit.raw.read`, mas não exige permissão no catálogo nem popula maps de documento/NF/CR.
10. Comissões já usam outro conceito de “documento de saída” (`InventoryMovement`) — fora do escopo de unificação nesta sequência.

---

## 3. Classificação de dados

| Tipo | Significado | Exemplos |
|---|---|---|
| **Persistido** | Coluna no stage, preenchida pelo sync | `externalId`, `idNfe`, `tipoDocumentoEstoque`, `quantity`, `unitValue` |
| **Derivado** | Calculado no request ou no rebuild O2C | valor alocado ao pedido, sinal excedente/fora, totais agregados por pedido |
| **Vínculo lógico** | Convenção por ID inteiro, sem FK Prisma | `NomusStockDocument.idNfe` ≡ `NomusNfe.externalId`; CR.`sourceInvoiceId` ≡ NF |
| **Vínculo auditável** | Evidência materializada em fato O2C | `OrderToCashAuditFact` (documento × item × pedido × NF × CR) |
| **Ainda ausente** | Não existe de forma confiável hoje | FK canônica item↔pedido; nº comercial distinto confirmado; cancelamento normalizado do documento; condição/parcelas oficiais do documento |

---

## 4. Respostas técnicas (1–15)

### 4.1 Campos de cabeçalho a normalizar em `NomusStockDocument`

Normalizar **somente** chaves estáveis e já usadas pela UI/enrich (com fallback explícito no mapper; cobertura real a confirmar no servidor):

| Campo proposto | Tipo sugerido | Origem esperada | Motivo |
|---|---|---|---|
| `documentNumber` | `String?` | raw (`numero`, `numeroDocumento`, …) se distinto de `externalId` | Evitar tratar `externalId` como nº comercial sem evidência |
| `statusRaw` | `String?` | raw (`status`, `situacao`, `statusDocumento`) | Exibição e filtros sem dump de raw |
| `isCancelled` | `Boolean` default `false` | raw + regras explícitas (não inferir por ausência) | Sinalização operacional do documento |
| `cancelledAt` | `DateTime?` | raw, se existir | Evidência de cancelamento |
| `cancellationReason` | `String?` | raw | Auditoria |
| `totalValue` | `Decimal(20,2)?` | raw oficial **ou** soma estável dos itens quando raw ausente (marcado como derivado no sync log) | Cabeçalho único para telas/listagens |
| `personExternalId` | `Int?` | raw (`idPessoa`, `pessoa.id`, …) | Identidade Nomus sem nome inventado |
| `personName` | `String?` | raw (`nomeCliente`, `pessoa.nome`, …) **somente se vier no mesmo payload** | Exibição; não cruzar Customer local por fuzzy |
| `companyExternalId` | `Int?` | raw (`idEmpresa`, `empresa.id`, …) | Identidade Nomus |
| `companyName` | `String?` | raw (`empresa`, `razaoSocialEmpresa`, …) no mesmo payload | Exibição |
| `movementDate` | `DateTime?` | raw (`dataMovimentacao`, `dataMov`, `movementDate`) | Separar de `dataDocumento` |
| `paymentTermsRaw` | `String?` | raw (`condicaoPagamento`, …) | Evidência; **não** substitui CR |
| `payloadHash` | `String` | hash do payload canônico | Skip unchanged + detecção de mudança |
| `firstSeenAt` | `DateTime` | sync | Presença |
| `lastSeenAt` | `DateTime` | sync | Presença |
| `presentInLastPayload` | `Boolean` | sync | Soft-presence (não apagar) |

`dataDocumento` e `tipoDocumentoEstoque` já existem e permanecem.

### 4.2 O que permanece só no `rawJson`

- Payload completo Nomus (auditoria técnica / `includeRaw`).
- Chaves instáveis, aninhadas ou com cobertura baixa.
- Parcelas detalhadas do documento (se existirem) até haver contrato confirmado — financeiro oficial continua no CR.
- Qualquer campo cuja cobertura no servidor for &lt; limiar acordado (ex.: 80%) permanece raw até nova revisão.

### 4.3 Cliente e empresa sem inferência insegura

| Permitido | Proibido |
|---|---|
| Extrair IDs/nomes **do próprio** `rawJson` do documento | Fuzzy match por razão social / CNPJ parcial |
| Exibir cliente/empresa do **pedido** ou da **NF** como contexto de vínculo (rótulo “do pedido/NF”) | Copiar `Customer` local para o stage sem `personExternalId` |
| Marcar `personName`/`companyName` como best-effort do documento | Inventar vínculo Cliente↔Documento sem ID Nomus |

Regra: se o raw não trouxer ID, o campo normalizado fica `null`; a UI pode mostrar contexto do pedido/NF **explicitamente rotulado**, nunca como atributo canônico do documento.

### 4.4 Status, cancelamento e valor total

- **Status:** persistir `statusRaw` (string). Não criar enum Nomus sem contrato fechado.
- **Cancelamento:** `isCancelled` só quando evidência explícita no raw **ou** regra documentada (ex.: status textual conhecido). Cancelamento da NF (`NomusNfe.status = 7`) **não** cancela automaticamente o documento de estoque — aparece como alerta de vínculo.
- **Valor total:**
  - preferir total oficial do raw, se presente e parseável;
  - senão, `SUM(item.estimatedTotalValue)` no sync (derivado, mas persistido em `totalValue` para listagem);
  - **nunca** somar facts O2C para obter o total do documento (origem da duplicação atual).

### 4.5 Impedir que payload incompleto apague itens

Mudança de política no apply (DS-03.2 / DS-03.4):

1. Calcular `payloadHash`; se igual ao atual → só atualizar `syncedAt` / `lastSeenAt` / `presentInLastPayload`.
2. Se o mapeamento de itens resultar em lista vazia **e** o documento já tiver itens → **não** executar `deleteMany`; registrar contador `itemsPreservedDueToEmptyPayload` e alerta.
3. Substituição integral de itens só quando a lista mapeada for não vazia **ou** quando o payload explicitamente indicar documento sem itens (flag/contrato Nomus a confirmar no servidor).
4. Exit code ≠ 0 se `errors > 0` (hoje pode terminar 0).
5. Contar itens descartados pelo mapper (qtde/preço inválidos) separado de “array vazio”.

### 4.6 Localização direta no stage (sem depender do run O2C)

Contrato futuro da API/tela Comercial (implementação depois do stage):

```text
NomusStockDocument
  → por externalId / documentNumber / período / tipo / idNfe
  → itens: NomusStockDocumentItem
  → NF: NomusNfe WHERE externalId = idNfe
  → pedidos: SalesOrder via SalesOrderNfeLink.nfeExternalId = idNfe
  → alocação (opcional): latest successful OrderToCashAuditFact filtrado por stockDocumentExternalId
  → CR: NomusAccountsReceivable WHERE sourceInvoiceId = idNfe
```

O stage é a fonte da **existência** do documento. O2C enriquece alocação/auditoria; ausência de fato não esconde o documento.

### 4.7 Reutilizar O2C só para alocação e auditoria

| Precisa de O2C? | Informação |
|---|---|
| Não | Listar documentos, cabeçalho, itens, NF, pedidos candidatos via `SalesOrderNfeLink`, CR via NF |
| Sim | Quantidade/valor alocado por pedido/item, excesso, produto fora, alertas de conciliação |
| Sim (rebuild) | Recalcular após sync de documentos/NF/pedidos |

UI Pedido / Auditoria 360° devem evoluir para: **carregar documentos pelo stage (via `idNfe` dos links do pedido)** e **sobrepor** métricas do latest run O2C quando existirem.

### 4.8 Documentos ligados a vários pedidos

Representação:

- **Vínculo lógico multi-pedido:** um `idNfe` pode ter N `SalesOrderNfeLink` → N pedidos.
- **Alocação auditável:** N facts O2C (um conjunto por pedido), cada um com `allocated*` **parcial**.
- **API/DTO:** um documento, lista `linkedOrders[]` com `allocatedValue` / `allocatedQuantity` por pedido; total do documento **uma vez** no cabeçalho.

Não criar tabela ponte nesta sequência, salvo se o rebuild O2C continuar insuficiente após DS-03.6 (revisar em DS-03.8).

### 4.9 Evitar duplicação do valor total por pedido

Regras:

1. `totalValue` do documento = cabeçalho do stage (ou soma de itens), **nunca** `SUM(fact.stockDocumentItemTotalValue)`.
2. Por pedido: exibir apenas `SUM(allocatedValueByDocumentPrice)` (e quantidades alocadas).
3. No builder O2C: facts de rateio do mesmo item devem carregar o total do item **no máximo uma vez** no agregador de UI, ou a UI deve agregar por `stockDocumentItemId` com `DISTINCT`/`max` do total — preferência: **corrigir agregação na leitura** (orderFullAudit) e, se necessário, parar de repetir o total cheio em cada fact split no builder.
4. Adapter Portfolio / funnel: manter a proteção já existente contra repetir totais de CR; aplicar o mesmo padrão ao total do documento.

### 4.10 Projeção de itens sem “primeiro vínculo”

Substituir `factsForDoc.find(produto)` por:

1. Indexar facts por `stockDocumentItemId` (preferencial) ou `(externalProductId, salesOrderItemId)`.
2. Agregar todos os facts do mesmo item: somar qtde/valor alocados; listar **todos** os `linkedSalesOrderItemId`.
3. Se um produto do stage tiver vários facts sem `stockDocumentItemId`, agrupar por produto e expor lista de vínculos (não descartar).
4. Testes obrigatórios: item rateado em 2 linhas do pedido; mesmo SKU em 2 itens do pedido.

### 4.11 Documento → NF-e → CR (sem segunda fonte financeira)

```text
Documento.idNfe  --lógico-->  NomusNfe.externalId
NomusAccountsReceivable.sourceInvoiceId  --lógico-->  NomusNfe.externalId
```

- Popular coluna/DTO de CR a partir de `NomusAccountsReceivable` (e/ou facts que já carregam `receivableExternalId`), **nunca** inventar CR no item do documento.
- Precedência financeira inalterada: CR real > condição comprovada do documento (`paymentTermsRaw` + evidência) > previsão do pedido.
- Não criar tabela financeira nova nem espelhar saldos no stage do documento.

### 4.12 Proteger `includeRaw`

1. Registrar permissão canônica no catálogo (ex.: `audit.raw.read` ou `finance.portfolio_reconciliation.audit_raw:view` — alinhar ao contrato PERM vigente).
2. Na rota `audit-full`, se `includeRaw=true` e usuário sem permissão → `403` (não degradar silenciosamente com maps vazios).
3. Quando autorizado, popular maps de raw de documento/NF/CR a partir dos stages (`NomusStockDocument.rawJson`, `NomusNfe.rawPayload`, `NomusAccountsReceivable.rawPayload`).
4. UI só envia `includeRaw` sob ação explícita de perfil técnico.
5. Teste de autorização obrigatório.

### 4.13 Índices aditivos previstos

Em `NomusStockDocument` (além dos existentes):

- `@@index([presentInLastPayload])`
- `@@index([isCancelled])`
- `@@index([personExternalId])`
- `@@index([companyExternalId])`
- `@@index([movementDate])`
- `@@index([payloadHash])` (padrão NF/AR)
- `@@index([documentNumber])` se o campo for criado e usado em busca

Em `NomusStockDocumentItem`:

- `@@unique([stockDocumentId, externalItemId])` **somente se** `externalItemId` for sempre preenchido nos payloads reais; senão manter índice composto não único e tratar upsert por `(stockDocumentId, externalItemId)` quando não nulo.

Nenhum índice novo em O2C/CR/NF nesta sequência, salvo necessidade medida no DS-03.6.

### 4.14 Migrations previstas (próximos prompts — não nesta etapa)

| Migration (nome sugerido) | Conteúdo |
|---|---|
| `nomus_stock_document_header_enrichment` | Colunas de cabeçalho (§4.1) + índices (§4.13) |
| `nomus_stock_document_presence_hash` | `payloadHash`, `firstSeenAt`, `lastSeenAt`, `presentInLastPayload` (pode ser a mesma migration se conveniente) |
| Opcional posterior | Unique parcial/composto em itens — **só após probe de cobertura de `externalItemId`** |

Sem alteração de schema de `SalesOrder`, `NomusNfe`, `NomusAccountsReceivable`, `OrderToCashAuditFact`, nem de Comissões.

### 4.15 Ordem segura de implementação

Ver seção 7. Critério: **primeiro não destruir dados** (sync), depois **enriquecer cabeçalho**, depois **descoberta direta**, depois **corrigir leitura/alocação/financeiro/raw**, por fim **revisão**.

---

## 5. Models reutilizados (sem novos masters)

| Model | Uso na correção |
|---|---|
| `NomusStockDocument` / `Item` | Expandir cabeçalho + hardening do sync |
| `NomusNfe` | Resolução Documento → NF |
| `SalesOrder` / `SalesOrderNfeLink` | Resolução Documento → pedidos candidatos |
| `OrderToCashAuditFact` / `Run` | Alocação e auditoria apenas |
| `NomusAccountsReceivable` | Financeiro oficial via NF |
| `InventoryMovement` | **Não** reutilizar como Documento de Saída comercial |

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Normalizar campos que o Nomus quase nunca envia | Probe de cobertura no servidor antes de tornar obrigatório; manter nullable |
| Unique em `(stockDocumentId, externalItemId)` quebrar apply | Só após medição; `externalItemId` nulo é comum? |
| Preservar itens em payload vazio mascarar documento realmente zerado | Contador + alerta + regra explícita quando contrato Nomus confirmar “sem itens” |
| Dupla verdade Comissões × stage | Fora do escopo DS-03; documentar e não unificar às pressas |
| Corrigir só a UI e deixar builder repetindo totais | Corrigir agregação na leitura **e** avaliar builder no DS-03.6 |
| Migration grande demais | Preferir uma migration aditiva de cabeçalho+presence; sem backfill destrutivo |
| `includeRaw` vazar PII | Permissão + não logar raw + sanitização nas APIs comerciais futuras |

---

## 7. Sequência de implementação

### DS-03.2 — Endurecimento do sincronizador

- Exit code ≠ 0 com erros; contadores honestos; logs sem credenciais.
- Introduzir cálculo de `payloadHash` (mesmo antes da migration: preparar mapper/tests).
- Documentar contrato de apply (unchanged / replace items / preserve).

### DS-03.3 — Campos de cabeçalho

- Migration aditiva + mapper extraindo campos §4.1.
- Testes de parse/fallback; campos ausentes → `null`.
- Sem alterar consumers de UI ainda (exceto se necessário para compilar).

### DS-03.4 — Proteção contra payload parcial

- Ativar `payloadHash` / presence no apply.
- Bloquear `deleteMany` quando lista de itens mapeada estiver vazia e já houver filhos.
- Testes: payload vazio preserva; payload com itens substitui; unchanged só toca timestamps.

### DS-03.5 — Resolução direta stage / NF / pedido

- Serviço de leitura: documento por `externalId`/`idNfe`/período a partir do stage.
- Join lógico NF + `SalesOrderNfeLink` sem exigir O2C.
- Ajustar detalhe do Pedido / Audit 360 para **descobrir** documentos pelo stage e enriquecer com O2C.

### DS-03.6 — Correção das alocações e duplicidades

- Agregar facts por item (não `find` primeiro).
- Total do documento uma vez; alocado por pedido separado.
- Revisar builder se facts ainda repetirem total cheio em splits.
- Testes de rateio multi-pedido e multi-linha.

### DS-03.7 — Resolução financeira

- Preencher CR via NF (`sourceInvoiceId`); remover `receivableExternalId: null` fixo.
- Aplicar precedência CR > condição do documento > previsão.
- Sem nova tabela financeira.

### DS-03.8 — Revisão final do stage

- Checklist das 15 perguntas; permissão `includeRaw`; índices; cobertura servidor; riscos remanescentes (Comissões).
- Gate para APIs/tela Comercial → Documentos de Saída.

---

## 8. Fora de escopo (explícito)

- Tela Comercial → Documentos de Saída e API dedicada (pós DS-03.8).
- Unificação Comissões ↔ `NomusStockDocument`.
- FK Prisma Documento→NF ou Documento→Pedido.
- Cron automático do sync (pode ser planejado depois do hardening).
- Alteração de schema O2C/NF/AR/Pedido além do estritamente necessário para leitura correta.

---

## 9. Validação pendente no servidor (obrigatória antes de fechar enums/uniques)

```bash
# Cobertura de chaves no rawJson de NomusStockDocument
# Taxa de preenchimento de externalItemId nos itens
# Orfãos: idNfe sem NomusNfe / sem SalesOrderNfeLink
# Exemplos: documento 8451, pedido PD02590, NF-e 7208
# npm run audit:output-documents:db -- --document=8451 --order=PD02590 --nfe=7208
```

Sem essas medições, manter campos novos **nullable** e unique de itens **adiado**.
