# Diagnóstico read-only — API Nomus Contas a Pagar

**Fase:** NOMUS-AP-LIVE-MAPPER-FIX (atualização pós-probe servidor)  
**Data:** 2026-06-07  
**Branch:** `main`  
**Escopo:** diagnóstico live confirmado + correção de sync/mapper (sem alterar Contas a Receber).

---

## 1. Resumo executivo

| Item | Status |
|---|---|
| Endpoint Contas a Pagar | **Confirmado live** em `/opt/induscost`: `GET …/rest/contasPagar?pagina=1` → HTTP 200, **50 registros** |
| Parâmetro `tamanhoPagina` | **Rejeitado** — `contasPagar?pagina=1&tamanhoPagina=50` → **HTTP 400** |
| Campos financeiros reais | API retorna nomes de **Contas a Receber** (`valorReceber`, `saldoReceber`, `valorReceberAgendado`, `valorRecebido`) com **valores negativos** para representar saída/pagável |
| Mapper IndusCost | Normaliza valores monetários AP para **positivo** (`Math.abs`) no model local; `rawPayload` e `payloadHash` preservam o original |
| Apply real | **Pendente** — rodar novo preview no servidor antes de `apply` controlado |

---

## 2. Documentação consultada

| Fonte | URL | Resultado |
|---|---|---|
| Postman (usuário) | https://documenter.getpostman.com/view/22813773/2s93JutNgM#10e3ce2d-003d-4998-91e8-b8b3f8e42f63 | Página pública carrega shell “Loading Collection…” — **não foi possível extrair endpoint/campos automaticamente**. Validar manualmente no browser logado. |
| Erathos Nomus ERP | https://docs.erathos.com/connectors/apis/nomus-erp | Lista recurso `contas_pagar` (snake_case) entre endpoints REST. |
| Freshdesk Nomus API REST | https://nomus.freshdesk.com/support/solutions/folders/27000055137 | Confirma integração REST+JSON; detalhe campo-a-campo de AP **não indexado** publicamente. |
| IndusCost — sync AR | `docs/generated/nomus-accounts-receivable-sync-report.md` | Padrão operacional validado na mesma instância Nomus. |

---

## 3. Endpoint e método (estado atual)

### 3.1 Confirmado — Contas a Receber (referência)

| Item | Valor confirmado |
|---|---|
| Recurso | `contasReceber` |
| Método | `GET` |
| URL exemplo (sem segredo) | `{NOMUS_BASE_URL}contasReceber?pagina=1&tamanhoPagina=50` |
| `NOMUS_BASE_URL` | Termina em `/rest/` (ex.: `https://<host>/rest/`) |
| Auth | `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE` **ou** `NOMUS_TOKEN` (Bearer) — ver `src/lib/nomusRestClient.ts` |
| Paginação | `pagina` (1-based), `tamanhoPagina` (default projeto: 50) |
| Parada | Página com **menos de 50** itens encerra leitura (`nomusAccountsReceivableSyncLogic.ts`) |
| Envelope JSON | Array em `contasReceber` ou raiz / `data` / `results` |
| Rate limit | HTTP **429** — corpo pode trazer `tempoAteLiberar` (segundos); retry em `fetchNomusJson` |

Implementação de referência:

- `scripts/nomusAccountsReceivableSync.ts`
- `src/lib/nomusAccountsReceivableSyncLogic.ts`
- `src/lib/nomusRestClient.ts`

### 3.2 Confirmado — Contas a Pagar (probe servidor `/opt/induscost`)

| Item | Valor confirmado |
|---|---|
| Recurso | `contasPagar` |
| Método | `GET` |
| URL válida | `{NOMUS_BASE_URL}contasPagar?pagina=1` |
| URL inválida | `{NOMUS_BASE_URL}contasPagar?pagina=1&tamanhoPagina=50` → **HTTP 400** |
| Tamanho de página | API retorna **50 registros** por página **sem** enviar `tamanhoPagina` |
| Parada de paginação | Projeto usa regra interna: página com **menos de 50** itens encerra leitura |

> **Diferença vs AR:** Contas a Receber aceita `tamanhoPagina`; Contas a Pagar **não** deve enviar esse parâmetro (opt-in apenas via `NOMUS_AP_SEND_PAGE_SIZE=1` para testes).

---

## 4. Teste read-only (procedimento servidor)

### 4.1 Resultado live no servidor (`/opt/induscost`)

| Teste | Resultado |
|---|---|
| `contasPagar?pagina=1` | HTTP **200**, **50** registros |
| `contasPagar?pagina=1&tamanhoPagina=50` | HTTP **400** |
| Páginas lidas (probe) | ≥ 1 |
| Registros página 1 | 50 |

### 4.2 Comando recomendado no servidor

Executar **somente leitura**, no máximo **2 páginas**, sem persistir:

```bash
cd /opt/induscost
git pull origin main   # após merge deste diagnóstico

# Preview AR (sanity check auth — já conhecido)
npm run sync:nomus:accounts-receivable:preview -- --page 1

# Probe AP manual (curl — substituir headers pelo padrão do .env, NUNCA colar segredo em log)
# Exemplo conceitual — usar NOMUS_AUTH_HEADER_NAME/VALUE do .env:
curl -sS -G \
  -H "Accept: application/json" \
  -H "${NOMUS_AUTH_HEADER_NAME}: ${NOMUS_AUTH_HEADER_VALUE}" \
  "${NOMUS_BASE_URL}contasPagar" \
  --data-urlencode "pagina=1" \
  --data-urlencode "tamanhoPagina=50" \
  | head -c 4000
```

Se HTTP 404 em `contasPagar`, repetir com `contas_pagar`.

**Registrar no próximo commit de diagnóstico B:**

- status HTTP
- recurso que funcionou
- chaves do envelope (`contasPagar`, `totalPaginas`, etc.)
- contagem página 1 (e 2 se aplicável)
- union de campos do 1º registro (mascarado)

---

## 5. Parâmetros de query

### 5.1 Confirmados em Contas a Receber (IndusCost)

| Parâmetro | Uso | Observação |
|---|---|---|
| `pagina` | Sim | Obrigatório na prática; 1-based |
| `tamanhoPagina` | Sim | Projeto usa 50 |
| Filtros por vencimento/modificação/status | **Não usados** | Relatório AR: API sem filtro confiável documentado |

### 5.2 Contas a Pagar — confirmado

| Parâmetro | Uso | Observação |
|---|---|---|
| `pagina` | **Sim** | Obrigatório; 1-based |
| `tamanhoPagina` | **Não enviar** | Causa HTTP 400 na instância live |
| Filtros por vencimento/modificação/status | **Não usados** | Mesma limitação de AR |

Parâmetros candidatos (somente hipótese, **não confirmados** para AP):

- `dataVencimentoInicio` / `dataVencimentoFim`
- `dataModificacaoInicio`
- `idEmpresa`, `idPessoa`, `status`

---

## 6. Campos — Contas a Receber (confirmados no projeto)

Origem: mapper `nomusAccountsReceivableMapper.ts` + teste servidor histórico.

| Campo API (Nomus) | Campo local | Tipo observado |
|---|---|---|
| `id` | `externalId` | número |
| `classificacao` | `classification` | string |
| `tipo` | `type` | número |
| `status` | `status` | boolean |
| `idEmpresa` / `nomeEmpresa` | company* | número / string |
| `idPessoa` / `nomePessoa` / `cnpjPessoa` / `telefonePessoa` | person* | número / string |
| `idContaBancaria` / `nomeContaBancaria` | bank* | número / string |
| `idFormaPagamento` / `nomeFormaPagamento` | payment* | número / string |
| `dataVencimento` | `dueDate` | `dd/MM/yyyy` |
| `dataCompetencia` | `competenceDate` | `dd/MM/yyyy` ou `MM/yyyy` |
| `dataAgendamento` | `scheduleDate` | `dd/MM/yyyy` |
| `dataHoraCriacao` | `createdAtNomus` | `dd/MM/yyyy HH:mm:ss` |
| `dataModificacao` | `modifiedAtNomus` | datetime BR |
| `dataBaixa` | `settlementDate` | `dd/MM/yyyy` |
| `valorReceber` | `amountReceivable` | moeda BR `"4.252,80"` |
| `valorReceberAgendado` | `amountScheduled` | moeda BR |
| `valorRecebido` | `amountReceived` | moeda BR |
| `saldoReceber` | `balanceReceivable` | moeda BR |
| `descricaoLancamento` | `description` | string |
| `comentarios` | `comments` | string |
| `idNfe` | `sourceInvoiceId` | número |
| `numeroNotaFiscalOrigem` | `sourceInvoiceNumber` | string |
| `suspenderCobranca` | `suspendCollection` | boolean |
| Multa/juros AR | `percentualMultaPorAtrasoEmContasReceber`, etc. | moeda / string |

---

## 7. Campos Contas a Pagar — checklist (somente o confirmado + simetria a validar)

**Legenda:** ✅ confirmado em AR (mesma família API) · 🔶 simetria esperada AP · ❓ a confirmar no probe AP

| Campo solicitado | Status | Notas |
|---|---|---|
| `id` | ✅ / 🔶 | Chave natural `externalId` |
| `idEmpresa`, `nomeEmpresa` | ✅ / 🔶 | Mesmo padrão AR |
| `idPessoa` / fornecedor | ✅ / 🔶 | AR usa `idPessoa`/`nomePessoa` — AP provavelmente igual (fornecedor = pessoa) |
| `cnpjPessoa` / documento | ✅ / 🔶 | AR: `cnpjPessoa` |
| `descricaoLancamento` | ✅ / 🔶 | |
| `classificacao`, `tipo`, `status` | ✅ / 🔶 | |
| `dataVencimento` | ✅ / 🔶 | |
| `dataCompetencia`, `dataAgendamento` | ✅ / 🔶 | |
| `dataBaixa` | ✅ / 🔶 | |
| `dataPagamento` | ❓ | Campo específico AP — **não mapeado em AR**; verificar se existe além de `dataBaixa` |
| `dataHoraCriacao`, `dataModificacao` | ✅ / 🔶 | |
| `valorReceber` (negativo) | ✅ live AP | Mapeado → `amountPayable` (positivo) |
| `saldoReceber` (negativo) | ✅ live AP | Mapeado → `balancePayable` (positivo) |
| `valorReceberAgendado` (negativo) | ✅ live AP | Mapeado → `amountScheduled` (positivo) |
| `valorRecebido` | ✅ live AP | Mapeado → `amountPaid` (positivo) |
| `valorBaixadoSemNumerario` | ✅ live AP | Fallback opcional de `amountPaid` |
| `valorPagar` / `saldoPagar` / `valorPago` | 🔶 | Aceitos pelo mapper se API futura retornar |
| `idContaBancaria`, `nomeContaBancaria` | ✅ / 🔶 | |
| `idFormaPagamento`, `nomeFormaPagamento` | ✅ / 🔶 | |
| `numeroDocumento` | ❓ | Não presente no mapper AR — verificar payload AP |
| `idNfe`, `numeroNotaFiscalOrigem` | ✅ / 🔶 | Vínculo NF possível também em AP |
| `comentarios` | ✅ / 🔶 | |
| `suspenderPagamento` ou equivalente | 🔶 | Simétrico a `suspenderCobranca` |
| Multa/juros/desconto | ❓ | AR traz campos `percentualMultaPorAtrasoEmContasReceber` — AP pode usar sufixo `ContasPagar` |

**Nenhum campo AP foi inventado como presente — apenas simetria marcada para validação.**

---

## 8. Amostra segura

### 8.1 Amostra real AP (mascarada — servidor live)

Campos do 1º registro confirmados: `classificacao`, `dataAgendamento`, `dataCompetencia`, `dataHoraCriacao`, `dataModificacao`, `dataVencimento`, `descricaoLancamento`, `id`, `idContaBancaria`, `idEmpresa`, `idFormaPagamento`, `idNfe`, `idPessoa`, `nomeContaBancaria`, `nomeEmpresa`, `nomeFormaPagamento`, `nomePessoa`, `numeroNotaFiscalOrigem`, `saldoReceber`, `status`, `tipo`, `valorReceber`, `valorReceberAgendado`, `valorRecebido`, `valorBaixadoSemNumerario`.

Exemplo financeiro real (id 16743):

```json
{
  "id": 16743,
  "nomePessoa": "PIZZA PACK COMERCIO DE EMBALAGENS LTDA",
  "dataVencimento": "05/08/2026",
  "saldoReceber": "-3.279,55",
  "valorReceber": "-3.279,55",
  "valorReceberAgendado": "-3.279,55",
  "valorRecebido": "0,00",
  "valorBaixadoSemNumerario": "0"
}
```

**Normalização local:** `amountPayable` / `balancePayable` / `amountScheduled` → `3279.55`; `amountPaid` → `0`. `rawPayload` mantém strings negativas.

### 8.2 Exemplo ilustrativo (campos *Pagar* — se API futura retornar)

```json
{
  "id": 12345,
  "classificacao": "DESPESA",
  "tipo": 1,
  "status": false,
  "idEmpresa": 2,
  "nomeEmpresa": "Empresa A",
  "idPessoa": 400,
  "nomePessoa": "Fornecedor ***",
  "cnpjPessoa": "***",
  "dataVencimento": "29/07/2026",
  "dataCompetencia": "07/2026",
  "dataAgendamento": "01/08/2026",
  "dataBaixa": null,
  "dataPagamento": null,
  "valorPagar": "4.252,80",
  "valorPago": "0,00",
  "saldoPagar": "4.252,80",
  "valorPagarAgendado": "0,00",
  "descricaoLancamento": "Parcela NF compra ***",
  "idFormaPagamento": 3,
  "nomeFormaPagamento": "Boleto",
  "idContaBancaria": 1,
  "nomeContaBancaria": "Bradesco",
  "idNfe": null,
  "numeroNotaFiscalOrigem": null,
  "comentarios": "",
  "suspenderPagamento": false
}
```

Substituir por amostra mascarada real após probe no servidor.

---

## 9. Comportamento de erro e rate limit

Herança do cliente `fetchNomusJson` (já usado em AR):

| HTTP | Comportamento |
|---|---|
| 200 | JSON parseado |
| 429 | Retry com `tempoAteLiberar` ou `Retry-After` ou backoff exponencial |
| 5xx | Retry limitado |
| 401/403 | Falha imediata — revisar auth no `.env` |
| 404 | Tentar recurso alternativo (`contas_pagar`) |

Logs devem usar `redactNomusUrlForLog` e `redactHeadersForLog` — **nunca** imprimir token/Authorization.

---

## 10. Diferenças vs Contas a Receber

| Aspecto | Contas a Receber | Contas a Pagar (expectativa) |
|---|---|---|
| Recurso REST | `contasReceber` ✅ | `contasPagar` 🔶 (ou `contas_pagar`) |
| Natureza financeira | Entrada / recebível | Saída / pagável |
| Campos de valor | `valorReceber`, `saldoReceber`, `valorRecebido` | `valorPagar`, `saldoPagar`, `valorPago` 🔶 |
| Suspensão | `suspenderCobranca` | `suspenderPagamento` 🔶 |
| NF origem | `idNfe`, `numeroNotaFiscalOrigem` | Provável equivalente 🔶 |
| Pré-NF / pré-documento | CR pode existir antes da NF | AP pode existir antes de NF/documento de compra ❓ |
| Integração IndusCost | Model + sync + cron + dashboard | **Inexistente** (esta fase) |

---

## 11. Riscos e limitações

1. **Endpoint AP não confirmado live** nesta sessão — risco de 404 ou nome divergente (`contas_pagar`).
2. **Postman não parseável** automaticamente — validação manual necessária.
3. **Campos simétricos** podem divergir (ex.: `dataPagamento`, `numeroDocumento`, multa com sufixo diferente).
4. **Filtros incrementais** provavelmente ausentes (mesma limitação AR).
5. **Sync full paginado** será pesado — planejar lock/cron isolado como AR.
6. **Fornecedor** pode vir como `idPessoa`/`nomePessoa` (padrão Nomus) — não assumir `idFornecedor` até ver payload.

---

## 12. Recomendação de model Prisma (próxima fase — não implementar agora)

Model sugerido: **`NomusAccountsPayable`** espelhando `NomusAccountsReceivable`:

| Grupo | Campos sugeridos |
|---|---|
| Chave | `externalId Int @unique` |
| Classificação | `classification`, `type`, `status` |
| Empresa / pessoa | `companyId`, `companyName`, `personId`, `personName`, `personCnpj`, `personPhone?` |
| Pagamento | `bankAccountId`, `bankAccountName`, `paymentMethodId`, `paymentMethodName` |
| Datas | `dueDate`, `competenceDate`, `scheduleDate`, `createdAtNomus`, `modifiedAtNomus`, `settlementDate`, `paymentDate?` |
| Valores | `amountPayable`, `amountScheduled`, `amountPaid`, `balancePayable` |
| Documento | `description`, `comments`, `documentNumber?`, `sourceInvoiceId?`, `sourceInvoiceNumber?` |
| Controle | `suspendPayment?`, juros/multa, `rawPayload`, `payloadHash`, `syncedAt` |

Reutilizar:

- `nomusAccountsReceivableParser.ts` (datas/moeda/boolean)
- `nomusRestClient.ts`
- Padrão preview/apply + `IntegrationRun` + runner shell + cron 2h

---

## 13. Próximos passos recomendados

### Fase imediata: **NOMUS-AP-API-DIAG-B** (servidor)

1. Rodar probe curl/`fetchNomusJson` em `/opt/induscost` contra `contasPagar` e fallback.
2. Atualizar **este documento** com endpoint confirmado, contagem de registros, `fieldStats` e amostra mascarada real.
3. Anexar envelope keys (`totalPaginas`, etc.).

### Fase seguinte: **NOMUS-AP-FOUNDATION**

1. `NomusAccountsPayable` + migration  
2. `nomusAccountsPayableMapper.ts` / `SyncLogic` / `scripts/nomusAccountsPayableSync.ts`  
3. `npm run sync:nomus:accounts-payable:preview|apply`  
4. Runner + cron isolado + card Admin (espelhar AR)  
5. Endpoint read-only summary (`GET /api/nomus/accounts-payable/summary`)

### Fase posterior: **FINANCE-AP-DASH** (dashboard Financeiro > Contas a Pagar)

Somente após sync estável e amostra validada.

---

## 14. Validações executadas (esta fase)

| Comando | Resultado |
|---|---|
| `npx prisma validate` | OK |
| `npm run lint` | OK |
| `npm run build` | OK |
| Teste live API AP | **Não executado** (sem credenciais locais) |

---

## 15. Referências de código (AR — não alterado)

| Arquivo | Papel |
|---|---|
| `src/lib/nomusRestClient.ts` | URL, headers, retry 429 |
| `scripts/nomusAccountsReceivableSync.ts` | Sync preview/apply |
| `src/lib/nomusAccountsReceivableParser.ts` | Parse BR |
| `src/lib/nomusAccountsReceivableMapper.ts` | Map API → model |
| `src/lib/nomusAccountsReceivableSyncLogic.ts` | Paginação/envelope |
| `scripts/runNomusAccountsReceivableSync.sh` | Runner servidor |
| `src/lib/nomusAccountsReceivableRoutes.ts` | Summary read-only |
