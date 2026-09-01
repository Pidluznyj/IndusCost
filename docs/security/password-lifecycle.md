# Ciclo de senha dos usuários humanos

Alteração voluntária, reset administrativo, senha temporária e troca obrigatória
com bloqueio real no backend.

Escopo: **apenas o login humano do IndusCost** (`AppUser` + `AppSession`). O
Collector de inventário (identidade por peer Tailscale), a Satisfação pública e
qualquer outra superfície não humana continuam exatamente como estavam.

---

## 1. Arquitetura

Nada de autenticação foi reinventado. A feature reutiliza o que já existia:

| Peça | Onde | Status |
| --- | --- | --- |
| Hash de senha | `src/lib/auth/appAuth.server.ts` (`scrypt:v1`) | **inalterado** |
| Sessão opaca | `AppSession` + cookie `induscost_session`, TTL 12 h | **inalterado** |
| Guards de permissão | `requireResource` / `requireAppAuth` | **inalterados** |
| Política de senha | `src/lib/auth/passwordPolicy.ts` | novo (fonte única) |
| Núcleo transacional | `src/lib/auth/passwordLifecycle.server.ts` | novo |
| Rotas | `src/lib/auth/passwordLifecycleRoutes.ts` | novo (reset foi movido para cá) |
| Enforcement | `src/lib/auth/passwordChangeRequiredGuard.ts` | novo |
| Rate limit | `src/lib/auth/authRateLimit.ts` | novo |
| Auditoria | `src/lib/auth/securityAudit.server.ts` + `SecurityAuditLog` | novo |

Não existe segundo motor de hash, segundo sistema de sessão, JWT, tabela paralela
de credencial nem `sessionVersion`.

---

## 2. Política de senha

`src/lib/auth/passwordPolicy.ts` é a **única** autoridade. Criação de usuário,
reset, troca voluntária e troca obrigatória consomem `validatePasswordPolicy`.
Nenhuma rota valida comprimento por conta própria.

- mínimo **12** caracteres, máximo **128**;
- **não** exige maiúscula, minúscula, número ou símbolo;
- permite espaços, acentos, Unicode, colar e gerenciador de senhas;
- acima do máximo é **rejeitado**, nunca truncado.

Composição obrigatória empurra o usuário para `Senha@2026` e piora a entropia
real; comprimento é o que de fato protege.

`APP_PASSWORD_MIN_LENGTH` (backend e frontend) passou a reexportar esse valor —
não há mais um segundo número em lugar nenhum.

## 3. Senha NÃO expira periodicamente

Decisão de produto definitiva. **Não existem** e não devem ser criados:
`passwordExpiresAt`, `passwordExpirationDays`, `passwordValidUntil`,
`passwordMaxAge`, `mustChangePasswordEveryXDays`, `lastPasswordReminderAt`,
`passwordRotationInterval`. Sem cron, sem job, sem tela de validade.

Sessão e senha são coisas diferentes: a **sessão** continua com TTL de 12 h.

---

## 4. Estado no `AppUser`

```prisma
mustChangePassword Boolean   @default(false)
passwordChangedAt  DateTime? @db.Timestamptz(6)
```

- `mustChangePassword = false` → opera normalmente.
- `mustChangePassword = true` → autenticou com credencial temporária e precisa
  cadastrar uma senha definitiva antes de usar o sistema.
- `passwordChangedAt = NULL` → usuário anterior à feature. Significa **data
  desconhecida**, não "nunca trocou". Não houve backfill: preencher com `NOW()`
  inventaria um fato que o sistema não observou.

Quem liga `mustChangePassword`: apenas o **reset administrativo** e a **criação
de usuário**. Nenhum usuário existente é afetado pelo deploy.

---

## 5. Fluxos

### 5.1 Troca voluntária — `POST /api/auth/change-password`

Exige sessão válida, usuário ativo e a **senha atual**. Rejeita senha igual à
atual. Em sucesso: novo hash → `mustChangePassword = false` →
`passwordChangedAt = now` → revoga **todas** as sessões → emite **uma** nova
sessão para a requisição atual → troca o cookie → audita.

### 5.2 Reset administrativo — `POST /api/admin/users/:id/reset-password`

É a **mesma rota** que a tela de Usuários já usava, endurecida (não foi criado
endpoint novo). Somente `SUPER_ADMIN`.

O backend **gera** a senha temporária (`crypto.randomBytes(18)` → base64url,
~144 bits); o administrador não escolhe mais. O plaintext existe apenas durante
a requisição e é devolvido **uma única vez**, com `Cache-Control: no-store`. Não
há rota para reconsultá-lo — se ele se perder, faz-se outro reset.

Efeito: novo hash → `mustChangePassword = true` → `passwordChangedAt = now` →
revoga todas as sessões do alvo → audita. **Não** emite sessão: o alvo precisa
autenticar de novo.

### 5.3 Login com a temporária

O login **não** é negado por `mustChangePassword`. Ele precisa suceder e criar
uma sessão autenticada restrita — é ela que dá acesso ao endpoint de troca.

### 5.4 Troca obrigatória — `POST /api/auth/complete-password-change`

Exige sessão válida, usuário ativo e `mustChangePassword === true`. **Não** pede
a senha temporária de novo: a posse acabou de ser comprovada pelo login. Mesmo
efeito da troca voluntária (revoga tudo, emite uma nova, troca o cookie, audita).

---

## 6. Revogação e rotação de sessão

| Operação | Sessões antigas | Sessão nova |
| --- | --- | --- |
| Troca voluntária | revogadas (todas) | sim, para a requisição atual |
| Troca obrigatória | revogadas (todas) | sim, para a requisição atual |
| Reset administrativo | revogadas (todas do alvo) | **não** |

Revogação por `AppSession.revokedAt` (o registro é preservado, nada é apagado).
`permissionsVersion` **não** é usado como "passwordVersion" — ele tem
responsabilidade própria de ACL. A sessão nova apenas *herda* o
`permissionsVersion` do usuário no `permissionsVersionAtIssue`.

Resultado prático: após qualquer uma das três operações, PC, celular, outro
navegador e uma eventual sessão roubada param de funcionar.

---

## 7. Enforcement backend (o ponto crítico)

`createPasswordChangeRequiredGuard`, montado em `app.use("/api", …)` **antes**
das rotas de negócio.

**Fail closed**: com `mustChangePassword = true`, tudo é negado com `403` /
`PASSWORD_CHANGE_REQUIRED`, exceto a whitelist explícita:

```
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
POST /api/auth/complete-password-change
GET  /api/health
GET  /api/app-version
```

Não é blacklist por módulo: **módulo novo nasce protegido** sem ninguém lembrar
de listá-lo. `/api/auth/permissions-version` e
`/api/auth/sync-session-permissions` ficam bloqueados de propósito.

Por que isso não afeta superfícies não humanas: o guard só age quando a
requisição traz o cookie `induscost_session`. Sem esse cookie ele devolve o
controle imediatamente, **sem consultar sessão**. O Collector autentica por peer
Tailscale, a Satisfação pública é registrada antes do middleware e os assets da
SPA estão fora de `/api`. O guard também **nunca** responde 401 — autenticar
continua sendo responsabilidade dos guards de rota.

Em erro ao resolver o estado (ex.: banco fora), responde `500` e **não** deixa a
requisição chegar à rota de negócio.

`/api/health` e `/api/app-version` são registrados antes do middleware por serem
liveness/versão — e estão na whitelist, então o efeito é idêntico.

O frontend (`RequireAuth` → `/security/change-password`) é **só UX**. Voltar no
histórico, dar F5, digitar a URL, usar DevTools, curl ou Postman não contorna
nada.

---

## 8. Transação e concorrência

`AppUser.update` + revogação + auditoria + criação da sessão nova acontecem na
**mesma transação**. A auditoria não é best-effort: se falhar, a troca inteira é
revertida. O token da sessão é gerado antes da transação (nunca persistido em
claro) e o cookie só é enviado depois do commit.

Toda escrita usa **CAS** sobre o estado comprovado (`passwordHash` anterior e,
na troca obrigatória, `mustChangePassword: true`). Se `count !== 1`, a operação
devolve `409 PASSWORD_STATE_CHANGED` em vez de sobrescrever. Duas requisições
simultâneas: só uma vence.

---

## 9. Auditoria — `SecurityAuditLog`

Tabela própria, e não `PermissionAuditLog`: aquela audita **mutação de ACL**
(`resourceKey`, `targetRole`, `before/after`) e não tem onde guardar origem da
requisição. Trocar senha não é mutação de ACL.

Eventos: `PASSWORD_CHANGED`, `PASSWORD_RESET_BY_SUPER_ADMIN`,
`PASSWORD_FORCED_CHANGE_COMPLETED`, `USER_INITIAL_PASSWORD_ASSIGNED`.

Campos: `eventType`, `actorUserId`, `targetUserId`, `ipAddress`, `userAgent`,
`metadata` (`{ source, sessionsRevoked }`), `createdAt`.

**Nunca** registra senha, hash, salt ou token. Um sanitizador descarta qualquer
chave cujo nome contenha `password`, `senha`, `hash`, `token`, `salt`, `secret`
ou `credential`, e aceita apenas escalares — objeto aninhado não pode esconder
segredo em profundidade.

### `ipAddress` — o que esse campo é, e o que ele NÃO é

É o **peer de rede observado pelo processo**, não "o IP do usuário". Não lemos
`X-Forwarded-For`, `X-Real-IP` nem `CF-Connecting-IP`, e `trust proxy`
continua desligado.

Consequência da topologia real (ver `docs/stock-collector-secure-ingress.md`):
o Nginx faz `proxy_pass` para `127.0.0.1:3000` (produção na AWS) e
`127.0.0.1:3001` (homologação). Nesses ambientes o peer é **sempre loopback**.
Gravar `127.0.0.1` numa coluna chamada `ipAddress` seria pior do que não gravar
nada: quem auditasse acreditaria estar vendo a origem do usuário.

Por isso:

| Peer observado | Gravado |
| --- | --- |
| `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `0.0.0.0` | `null` |
| `192.168.100.5` (LAN da homologação, acesso direto) | `192.168.100.5` |
| endereço público de cliente direto | o endereço |

Faixa privada **não** é descartada: numa instalação de LAN ela é o endereço real
de quem acessou. Só loopback/não-especificado — que comprovadamente indicam um
proxy no mesmo host — viram `null`.

**Para obter o IP real do usuário** seria preciso uma cadeia de confiança
explícita (ex.: `trust proxy` limitado ao IP do Nginx local + validação de
`CF-Connecting-IP` contra as faixas da Cloudflare). Isso é mudança de
infraestrutura e está fora desta missão.

---

## 10. Rate limit

São **dois mecanismos**, porque os problemas são diferentes.

### 10.1 Login — throttle de força bruta

Janela deslizante não serve aqui. Um limiter que apenas troca `401` por `429`
**não contém força bruta**: o `scrypt` continua rodando a cada tentativa e o
atacante segue testando candidatos à vontade. O gate precisa impedir a
**verificação**, não só mudar a resposta.

O login usa `LoginThrottle`: cooldown progressivo por identidade (e-mail
normalizado), avaliado **antes** de consultar o banco e antes de
`verifyPassword`.

| Falhas consecutivas | Cooldown antes da próxima verificação |
| --- | --- |
| 1 – 4 | nenhum |
| 5 | 15 s |
| 6 | 30 s |
| 7 | 60 s |
| 8 ou mais | 120 s (teto) |

Durante o cooldown a resposta é `429` com `Retry-After` igual ao tempo
restante, e **nenhum `scrypt` é executado** — nem para a senha correta.
Terminado o cooldown, exatamente **uma** tentativa avança para verificação por
ciclo; se acertar, autentica e o estado é apagado; se errar, o backoff sobe
para o degrau seguinte.

O teto de 2 minutos é deliberado: conhecer o e-mail de alguém não pode virar
uma forma de derrubar o acesso da pessoa por muito tempo. O estado decai
sozinho após 15 minutos de inatividade.

**Concorrência.** `acquire()` é síncrono: lê e grava o estado sem `await` no
meio, então no laço de eventos do Node duas requisições paralelas não conseguem
observar o mesmo estado e passar as duas. A tentativa é cobrada como falha já
na **concessão** — é isso que impede uma rajada simultânea de N requisições de
obter N verificações antes que a primeira falha fosse registrada. Teste
adversarial: 200 requisições paralelas partindo do zero resultam em exatamente
5 `scrypt`; 20 requisições disparadas no instante exato da expiração do
cooldown resultam em exatamente 1.

### 10.2 Operações autenticadas — janela deslizante

Para quem **já** está autenticado, o problema é abuso operacional, não
adivinhação de senha; janela deslizante basta:

| Operação | Chave | Limite |
| --- | --- | --- |
| Troca de senha | userId | 10 / 15 min |
| Reset administrativo | userId do SUPER_ADMIN | 10 / 10 min |

### 10.3 O que vale para os dois

Chave é **identidade**, nunca rede: `trust proxy` continua desligado e nenhum
header (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`) é lido. Sem cadeia
de confiança, limitar por identidade é preferível a enfraquecer a confiança de
rede de outras superfícies.

Nada é persistido: não existe `failedLoginCount` nem `lockedUntil` em
`AppUser`, e nenhuma migration foi criada para isso. O estado vive em memória,
compatível com a topologia de processo único — com múltiplas instâncias o
limite efetivo multiplica pelo número de processos (mesma premissa do limiter
da Satisfação, que **não** foi tocado).

E-mail existente e inexistente recebem a mesma resposta e entram em cooldown no
mesmo ponto: **sem enumeração de contas**.

### 10.4 Ameaças residuais

1. **Bloqueio temporário dirigido.** Quem souber o e-mail de alguém consegue
   manter aquela identidade em cooldown, batendo uma vez a cada expiração. O
   teto limita o impacto a 2 minutos por ciclo, contra os 15 minutos de um
   lockout clássico — é a troca consciente entre conter força bruta e não
   entregar um DoS de conta prolongado.
2. **Canal lateral de tempo.** E-mail inexistente responde sem executar
   `scrypt`, então é mais rápido que senha errada de usuário real. Status,
   corpo e contagem de throttle são idênticos; a diferença é de latência.
   Equalizar exigiria um hash-fantasma no caminho de usuário inexistente —
   mudança de desenho fora do escopo desta correção.

## 11. Contratos

| Rota | Método | Autorização | Payload | Resultado |
| --- | --- | --- | --- | --- |
| `/api/auth/change-password` | POST | sessão válida | `{currentPassword, newPassword}` | `{success, mustChangePassword:false, sessionsRevoked}` + cookie novo |
| `/api/auth/complete-password-change` | POST | sessão válida + `mustChangePassword` | `{newPassword}` | idem |
| `/api/admin/users/:id/reset-password` | POST | `admin.settings.security:manage` **e** `SUPER_ADMIN` | `{}` | `{success, temporaryPassword, mustChangePassword:true, sessionsRevoked}` |

Códigos de erro (estáveis — o frontend decide por `code`, nunca por texto):

| Código | HTTP |
| --- | --- |
| `INVALID_CURRENT_PASSWORD` | 400 |
| `PASSWORD_POLICY_VIOLATION` | 422 (+ `reasons[]`) |
| `PASSWORD_REUSED` | 422 |
| `PASSWORD_CHANGE_REQUIRED` | 403 |
| `PASSWORD_CHANGE_NOT_REQUIRED` | 409 |
| `PASSWORD_STATE_CHANGED` | 409 |
| `TEMPORARY_PASSWORD_IS_GENERATED` | 400 |
| `USER_INACTIVE` / `FORBIDDEN` | 403 |
| `RATE_LIMITED` | 429 (+ `Retry-After`) |

`GET /api/auth/me` passou a informar `mustChangePassword` e `passwordChangedAt`
junto aos campos seguros. `passwordHash`, tokens e salts continuam fora do DTO.

---

## 12. Frontend

- **Self-service**: item "Alterar senha" no rodapé da sidebar →
  `/security/change-password`. Campos com `autocomplete` correto, mostrar/ocultar,
  colar liberado, gerenciador de senhas suportado.
- **Troca obrigatória**: a mesma rota, em modo obrigatório (sem senha atual, sem
  saída). `RequireAuth` desvia para lá enquanto `mustChangePassword` for `true`;
  a rota fica fora do `Layout` e fora do gate de ACL, para abrir mesmo com o
  acesso bloqueado.
- **Reset (SUPER_ADMIN)**: modal de confirmação dizendo o que vai acontecer;
  depois exibe a senha temporária uma única vez, com "Copiar senha" e o aviso de
  que ela não será mostrada de novo. Fechar o modal ou recarregar a página a
  descarta.

A senha vive apenas no estado local do formulário e no corpo da requisição:
nunca em `localStorage`, `sessionStorage`, contexto persistente, URL ou query.

---

## 13. Migration

`prisma/migrations/20260916120000_auth_password_lifecycle/`, estritamente
**aditiva**.

> **Sobre o timestamp.** Os nomes de migration deste repositório **não são datas
> reais**: são um contador sintético (um "dia" por migration, sempre às
> `120000`). `20260915120000_goal_governance`, por exemplo, foi commitada em
> 2026-08-28, e 16 migrations já carregam timestamp posterior a setembro/2026.
> O slot `20260901120000` inclusive já está ocupado por
> `20260901120000_treasury_scenario_policy`. Por isso esta migration usa o
> próximo número da sequência (`20260916120000`) e não a data do calendário:
> um nome com a data real ordenaria **antes** de 15 migrations existentes, e o
> Prisma aplica em ordem lexicográfica. Há teste travando essa invariante.

Conteúdo:

- `ALTER TABLE "AppUser" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false`
- `ALTER TABLE "AppUser" ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(6)`
- `CREATE TABLE "SecurityAuditLog"` + 3 índices + 2 FKs `ON DELETE SET NULL`

Sem renomeação, sem `DROP`, sem backfill, sem reset de banco. Nenhum usuário
existente é forçado a trocar a senha.

---

## 14. Testes

`npm run test:auth-password` (153 testes) cobre:

- política: mínimo, máximo, passphrase, Unicode, ausência de composição
  obrigatória, ausência de truncamento silencioso;
- hash: fixture `scrypt:v1` congelado continua verificando, formato preservado,
  nenhuma segunda implementação de scrypt;
- troca voluntária e obrigatória: senha atual, política, reuso, revogação,
  rotação, auditoria, **corrida com 409** e rollback quando a auditoria falha;
- reset: matriz de papéis por HTTP real (`SUPER_ADMIN` permitido; `ADMIN`,
  `COMMERCIAL_MANAGER`, `SELLER`, `VIEWER` recebem 403), plaintext não
  persistido nem auditado, `no-store`;
- guard: whitelist exata, negação de rota de negócio, chamada crua não burla,
  superfícies sem cookie humano intocadas, fail closed em erro;
- E2E: reset → login com temporária → `/me` → API bloqueada → troca → sessão
  rotacionada → sistema liberado;
- rate limit e auditoria, incluindo as garantias de que `trust proxy` não foi
  habilitado e a Satisfação não foi afetada.

---

## 15. Rollback

A migration é aditiva, então **voltar o binário não exige tocar no banco**: as
colunas extras ficam inertes (`mustChangePassword` default `false`) e
`SecurityAuditLog` simplesmente deixa de receber linhas. Nenhum dado se perde.

Se houver usuários com `mustChangePassword = true` no momento do rollback, eles
voltam a operar normalmente com a senha temporária que receberam — por isso, ao
reverter, vale conferir `SELECT count(*) FROM "AppUser" WHERE "mustChangePassword"`
e pedir a esses usuários que troquem a senha assim que a versão voltar.

Não existe migration de rollback destrutiva, e não deve ser criada.
