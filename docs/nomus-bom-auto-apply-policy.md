# Política de Auto Apply BOM — Nomus × IndusCost

Documento operacional da fase de equalização Nomus. Descreve o comportamento
**já implementado** no código — não altera regras de negócio por si só.

Implementação principal:
- `src/lib/nomusBomControlledApply.ts` — plano e apply controlado
- `src/lib/nomusBomGovernanceMetadata.ts` — metadata Nomus em linhas elegíveis
- `src/lib/nomusBomAutoApplyAfterSync.ts` — rotina batch pós-sync
- `src/lib/nomusEffectivePricingBom.ts` — BOM efetiva de precificação
- `src/lib/nomusEngineeringOwnership.ts` — ownership Nomus vs local

Relatório oficial da rotina:
- `docs/generated/nomus-auto-sync-bom-apply-report.json`
- `docs/generated/nomus-engineering-validation-checklist.md` (checklist humano)

---

## 1. Princípio geral

Quando a BOM de um produto é **controlada pelo Nomus**, o IndusCost deve:

1. **Replicar** quantidades e componentes vindos do Nomus.
2. **Preservar** itens nativos/protegidos do IndusCost.
3. **Bloquear** apenas quando não houver decisão segura automática.
4. **Registrar histórico** ao remover linha local não protegida.

---

## 2. Linha que existe no Nomus

Se o componente aparece na BOM efetiva Nomus:

| Situação | Ação automática |
|---|---|
| Linha não existe no ProductBOM | `CREATE_PRODUCT_BOM_LINE` |
| Quantidade diferente | `UPDATE_PRODUCT_BOM_QUANTITY` |
| Quantidade ok, metadata Nomus ausente/incorreta | `UPDATE_PRODUCT_BOM_NOMUS_METADATA` |
| Duplicatas na ProductBOM | `CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES` |

Metadata aplicada (quando elegível):
- `sourceSystem = NOMUS`
- `isNomusControlled = true`
- `lossPercentage = 0`
- `nomusComponentCode` preenchido

Linhas com `localException = true` **nunca** recebem governança Nomus
(`nomusBomGovernanceMetadata.ts`).

---

## 3. Linha que existe só no IndusCost

Se a linha está no ProductBOM mas **não** na BOM efetiva Nomus:

| Condição | Comportamento |
|---|---|
| `localException = true` | **Preservar** (`KEEP_PRODUCT_BOM_LINE`) |
| Código `800.xx` (montagem local) | **Preservar** — não é roteiro Nomus nesta fase |
| Custo operacional local / montagem | **Preservar** conforme classificação efetiva |
| Decisão ativa de engenharia para manter | **Preservar** |
| Linha local **sem** proteção e ausente no Nomus | **Remover** (`REMOVE_PRODUCT_BOM_LINE`) com histórico |

Exemplo piloto **308.05AB**:
- `115.01--`, `121.25--` — atualizar quantidade (Nomus manda).
- `132.01--`, `132.02--` — corrigir metadata Nomus.
- `115.08--` — existe só no IndusCost; se **não** for item nativo/protegido,
  entra como remoção pendente ou bloqueio até decisão na revisão local.

---

## 4. Quando bloquear (não aplicar automaticamente)

O apply automático **para o produto** quando há:

| Bloqueio | Motivo |
|---|---|
| Opcionais/alternativos pendentes | Escolha humana de precificação |
| Ambiguidade Product/Material | Mesmo código em duas entidades |
| Produto pai não cadastrado | Importar antes de aplicar BOM |
| Componente Nomus não resolvido | Material/Produto filho faltante |
| Item local não classificável | Risco de remoção indevida — revisar na BOM efetiva |

Produtos bloqueados aparecem na **Central Engenharia Nomus** com:
- `pendingTypeLabel`
- `recommendedAction`
- `recommendedTab` (aba sugerida na Manutenção Nomus)

---

## 5. O que o sistema resolve sozinho vs. decisão humana

### Resolve automaticamente (quando `canApply = true`)
- Divergência de quantidade Nomus × ProductBOM
- Metadata Nomus faltante em linha já correta
- Criação de linha Nomus ausente
- Remoção de linha local **não protegida** ausente no Nomus

### Exige decisão humana
- Opcionais de precificação
- Itens locais pendentes (ex.: `115.08--` em 308.05AB)
- Cadastro mestre faltante
- Ambiguidades Product/Material

Checklist para estagiário:
`docs/generated/nomus-engineering-validation-checklist.md`

---

## 6. Idempotência

Produto **307.05AA** (caso validado):
- Após apply, `sourceSystem=NOMUS`, `isNomusControlled=true`
- Quantidades iguais ao Nomus
- Reexecução da rotina → status `NO_CHANGES` (sem alteração)

---

## 7. Comandos operacionais

```bash
# Sync completo + auto apply BOM + relatório
npm run sync:nomus:all:apply

# Validar relatório
node -e "const r=require('./docs/generated/nomus-auto-sync-bom-apply-report.json'); console.log({items:r.items?.length, products:r.products?.length, blocked:r.totals?.parentsBlocked})"
```

---

## 8. Próximo patch mínimo (se necessário)

Se `115.08--` continuar bloqueando 308.05AB após decisão explícita de remoção:

1. Confirmar na aba **BOM efetiva** que a linha não é `localException`.
2. Registrar decisão de revisão (`nomusBomReviewDecision.ts`).
3. Reexecutar apply do produto ou rotina batch.

**Não implementar remoção em massa sem checklist** — usar Central Engenharia
para triagem produto a produto nesta fase de equalização inicial.
