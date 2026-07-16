# Comparação legado × novo (requireResource)

Ferramenta **dry-run** que compara, por usuário, o acesso concedido pelo modelo legado (`AppUser.permissions[]` + bag OR) com o resolvedor novo (`resolveEffectiveAccess` / `requireResource`).

**Não aplica mudanças.** Não grava `AppUser`, overrides nem perfis.

---

## Comandos

```bash
# Fixtures + matriz de personas (padrão)
npm run permissions:compare:legacy-vs-effective

# Só fixtures (Leticia, SUPER_ADMIN, mega-key, deny, alias)
npx tsx scripts/compareLegacyVsEffectiveAccess.ts --fixtures-only

# Incluir usuários ativos do banco (read-only; requer DATABASE_URL)
npx tsx scripts/compareLegacyVsEffectiveAccess.ts --from-db

# Falhar CI se houver lockout_risk
npx tsx scripts/compareLegacyVsEffectiveAccess.ts --fail-on-lockout

# Testes
npm run test:access-comparison
```

---

## Saídas (`docs/generated/`)

| Arquivo | Conteúdo |
|---------|----------|
| `legacy-vs-effective-access.json` | Resumo global + por usuário (sem PII) |
| `legacy-vs-effective-access.md` | Markdown legível + bloco Leticia |
| `legacy-vs-effective-access-summary.csv` | Uma linha por subjectRef |
| `legacy-vs-effective-access-diffs.csv` | Só células com diferença material |

Campos expostos: `subjectRef` (hash SHA-256 truncado), `role`, `accessProfileRef` (hash), `scenarioTag`, contagens por categoria. **Sem** nome, e-mail ou bag completa.

---

## Escopo de probes

Recursos migrados P14–P19:

- Financeiro (P17 + AP P18)
- Comercial, Engenharia, Admin settings (P19)
- Pessoas/RH (P15)
- Operações (P16)
- Segurança admin (P14)

Para cada `resourceKey` migrado, todas as **actions** definidas no contrato.

---

## Modelos comparados

| Lado | Comportamento |
|------|----------------|
| **Legado** | `hasAnyPermission` sobre `legacyPermissionKeys` do contrato (bag OR após `getEffectivePermissions`) |
| **Novo** | `resolveEffectiveAccess` com `legacySkipMegaKeys: true` e `legacyCompatMode` alinhado ao `requireResource` |

---

## Categorias

| Categoria | Significado |
|-----------|-------------|
| `preserved_intentional` | Legado e novo permitem; grant não veio só de bleed |
| `new_legitimate_access` | Novo permite; legado negava (role, perfil, override, projeção 1:1) |
| `removed_by_deny` | Legado permitiria; novo nega por override deny ou ancestral view deny |
| `mega_key_bleed` | Legado permitia **só** por bleed/mega-key; novo nega — **não** é regressão intencional a preservar |
| `permissive_fallback` | Legado permitia por fallback permissivo (ex.: profile wipe + bag ampla) |
| `unmapped_resource` | Recurso/ação ausente no contrato |
| `conflict` | Decisões inconsistentes (ex.: novo allow com source inesperado) |
| `lockout_risk` | Legado permitia por chave **dedicada 1:1**; novo nega — investigar antes de enforce |
| `both_denied` | Ambos negam (omitido dos diffs) |

### Regra crítica

**Bleed histórico nunca classifica como `preserved_intentional`.**

Exemplo **Leticia** (só Contas a Pagar):

- `finance.accounts_payable:view` → alinhado (preservado)
- `finance:view` e `finance.portfolio_reconciliation:view` → `mega_key_bleed` (bleed AP→Financeiro/Conciliação removido no novo modelo)

---

## Interpretação operacional

1. **`lockout_risk` > 0** — revisar antes de remover guards legados; usuário perderia acesso legítimo.
2. **`mega_key_bleed` > 0** — esperado na migração; não promover a override na Etapa B.
3. **`removed_by_deny`** — comportamento desejado quando deny explícito foi configurado.
4. **`new_legitimate_access`** — ganho via role matrix / perfil / override; informativo.
5. **`unmapped_resource`** — gap contrato ↔ módulo migrado; corrigir catálogo.

---

## Arquitetura

```
src/lib/security/accessComparison/
  migratedProbes.ts   — lista resource×action migrados
  legacyEval.ts       — bag OR legado
  bleedDetection.ts   — mega-key / cross-resource bleed
  classify.ts         — categorias
  compareUser.ts      — por usuário + agregado global/perfil
  safeExport.ts       — JSON/CSV/MD sem PII
  subjects.ts         — fixtures + personas + Leticia
```

Relacionado: `effectiveAccess/compareWithCurrent.ts` (shadow probes pontuais), `compareLegacyVsResourceNavAccess.ts` (sidebar módulos).
