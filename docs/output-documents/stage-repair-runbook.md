# DS-03.6 — Runbook do reparo de stage (Documentos de Saída)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Preencher campos normalizados de `NomusStockDocument` a partir do `rawJson` local |
| **Ambiente** | Servidor com `DATABASE_URL` — **Cursor não tem acesso ao banco de produção** |
| **Pré-requisito** | Migration DS-03.3 aplicada (`documentNumber`, `statusRaw`, …, `payloadHash`) |

---

## 1. O que este reparo faz

Lê o `rawJson` já armazenado em cada `NomusStockDocument` e preenche **somente** os campos normalizados de cabeçalho:

- `documentNumber`, `statusRaw`, `isCancelled`, `cancelledAt`, `cancellationReason`
- `totalValue`
- `personExternalId`, `personName`
- `companyExternalId`, `companyName`
- `movementDate`, `paymentTermsRaw`
- `payloadHash`

Usa o mapper canônico (`normalizeStockDocumentHeader` / `mapNomusStockDocumentPayload`).

## 2. O que este reparo **não** faz

- não consulta o Nomus;
- não apaga linhas;
- não altera `rawJson`;
- não altera itens (`NomusStockDocumentItem`);
- não altera IDs (`id`, `externalId`);
- não altera vínculos O2C / NF / pedido;
- não altera `firstSeenAt`, `lastSeenAt`, `presentInLastPayload`, `syncedAt`;
- não inventa cliente, empresa ou valor quando o raw não traz evidência;
- **não limpa** campo já preenchido quando o raw parcial vem sem aquela chave.

## 3. Modos

| Modo | Comportamento |
|---|---|
| `preview` | Lê e calcula diffs; **zero escritas** no banco |
| `apply` | Aplica o patch fill-only em lotes |

Flags úteis:

| Flag | Efeito |
|---|---|
| `--only-null` | Só preenche campos ainda vazios (ou `isCancelled=false` → `true`) |
| `--limit=N` | Processa no máximo N documentos |
| `--batch-size=N` | Tamanho do lote (padrão 200) |
| `--after-externalId=N` | Retomada manual (processa `externalId > N`) |
| `--externalId=N` | Um documento só |
| `--checkpoint-file=PATH` | Checkpoint de retomada (também via env `NOMUS_STOCK_DOCUMENTS_REPAIR_CHECKPOINT_FILE`) |

## 4. Lock oficial

O reparo usa o **mesmo lock** do sync de Documentos de Saída (`acquireStockDocumentsSyncLock`).

Se o sync (ou outro reparo) estiver em andamento, a execução retorna `lockBlocked: true` sem escrever.

Não rode sync e reparo em paralelo no mesmo ambiente.

## 5. Comandos no servidor

Na raiz do repositório, com dependências instaladas e `DATABASE_URL` configurada:

### 5.1 Preview (obrigatório antes do apply)

```bash
npm run repair:nomus:stock-documents:preview -- --only-null --limit=50
```

Preview completo (sem limite amostral):

```bash
npm run repair:nomus:stock-documents:preview -- --only-null
```

### 5.2 Apply (somente após revisar o preview)

```bash
npm run repair:nomus:stock-documents:apply -- --only-null --checkpoint-file=/tmp/ds-stage-repair.ckpt.json
```

Retomada: o mesmo comando com o mesmo `--checkpoint-file` continua a partir de `lastProcessedExternalId`.

Documento único:

```bash
npm run repair:nomus:stock-documents:preview -- --externalId=8451
npm run repair:nomus:stock-documents:apply -- --externalId=8451
```

## 6. Contadores do relatório JSON

| Campo | Significado |
|---|---|
| `scanned` | Linhas lidas |
| `wouldUpdate` | Teriam patch (preview e apply) |
| `updated` | Escritas reais (`apply` apenas) |
| `unchanged` | Já alinhadas / nada a preencher |
| `skippedInvalid` | `rawJson` inválido ou sem `externalId` |
| `invalidDates` | Datas presentes no raw mas não parseáveis |
| `absentFields` | Campos normalizados ausentes no raw (não inventados) |
| `errors` | Falhas de `update` |
| `fieldsToFill` / `fieldsFilled` | Contagem por campo |

`samples` (até 20) inclui `before`/`after`/`diff`, `itemCountPreserved`, `idPreserved` e `rawJsonPreserved: true`.

## 7. Idempotência e segurança

1. Rode **preview** e confira `wouldUpdate`, `invalidDates`, `absentFields` e amostras.
2. Rode **apply** com checkpoint.
3. Rode **apply** de novo: espere `updated=0` e `unchanged` alto.
4. Confirme amostralmente que itens e `rawJson` não mudaram.

## 8. Arquivos da rotina

| Arquivo | Papel |
|---|---|
| `src/lib/nomusStockDocumentsRepair.ts` | Lógica pura (CLI, patch, contadores) |
| `src/lib/nomusStockDocumentsRepair.server.ts` | Lotes + lock + Prisma |
| `scripts/nomusStockDocumentsRepair.ts` | Entrypoint CLI |
| `src/lib/nomusStockDocumentsRepair.test.ts` | Testes (preview/apply/idempotência/parcial/datas/Decimal/itens) |

## 9. Testes locais (sem banco de produção)

```bash
npm run test:nomus:stock-documents
```

Inclui os testes de reparo. **Não execute o reparo real a partir do Cursor** — só no servidor, após preview.

## 10. Critérios de aceite

- [ ] Preview sem escrita
- [ ] Apply preenche só campos normalizados
- [ ] Segunda execução idempotente
- [ ] Payload parcial não inventa nem limpa
- [ ] Datas inválidas registradas, campos de data ficam null
- [ ] `totalValue` Decimal coerente com o raw (ou soma dos itens **do raw**, nunca inventada)
- [ ] Itens, rawJson, IDs e vínculos preservados
- [ ] Lock oficial respeitado
