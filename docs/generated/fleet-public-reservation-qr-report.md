# Fleet — Solicitação pública de reserva via QR Code

## Objetivo

Permitir que colaboradores solicitem reserva de veículo por página pública/mobile (QR Code), sem login no ERP. Identificação por **CPF**, vínculo com cadastro de **motorista** (`FleetDriver`), seleção obrigatória de veículo e período. A equipe de frota aprova ou rejeita internamente.

## Rota pública (frontend)

- `/public/fleet/reservation/:token`
- **Sem login** — rota registrada fora de `RequireAuth` no `App.tsx`.
- Primeira tela: **CPF** (wizard inicia em etapa CPF).

## Link curto/amigável e cópia do link

### Link técnico (avançado)

```
http://192.168.100.5:3000/public/fleet/reservation/<TOKEN>
```

- Contém o token de 64 caracteres hex.
- Continua válido mesmo com slug configurado.
- Útil para diagnóstico ou quando o slug não estiver definido.

### Link curto (recomendado para enviar)

Setting `publicReservationSlug` (padrão: `reservar-carro`):

```
http://192.168.100.5:3000/reservar-carro
```

- Abre a mesma tela de CPF **sem login**.
- O servidor redireciona (HTTP 302) para o link técnico com o token ativo.
- Também aceita slug com barra, ex.: `r/frota` → `http://192.168.100.5:3000/r/frota`.

### Base URL interna

| Setting | Exemplo |
|---------|---------|
| `publicReservationBaseUrl` | `http://192.168.100.5:3000` |
| `publicReservationSlug` | `reservar-carro` |

### Painel Frota → Configurações → Reserva pública / QR Code

- **Link curto** — copiar / abrir (prioridade no QR Code)
- **Link técnico** — copiar / abrir / regenerar token
- Copiar usa `navigator.clipboard` com fallback `execCommand("copy")`
- Feedback: *"Link copiado."* ou mensagem para cópia manual

### Endpoint de resolução (sem login)

`GET /api/public/fleet/reservation-link/:slug` (suporta `/:slug/:sub` para `r/frota`)

Resposta:

```json
{
  "enabled": true,
  "targetUrl": "/public/fleet/reservation/<TOKEN>",
  "targetAbsoluteUrl": "http://192.168.100.5:3000/public/fleet/reservation/<TOKEN>"
}
```

- Slug inválido → 400
- Slug não configurado / token ausente → 404
- Feature desativada → 403

### Como validar no servidor

1. Configure `publicReservationBaseUrl` e `publicReservationSlug`.
2. Copie o **link curto** no painel e abra em outro dispositivo na mesma rede/VPN.
3. Confirme redirecionamento para tela de CPF.
4. Escaneie o QR Code — deve usar o link curto.
5. Se necessário, use o link técnico para testar token diretamente.

## Link compartilhável (rede interna / VPN)

Configure em **Frota → Configurações**:

| Setting | Exemplo |
|---------|---------|
| `publicReservationBaseUrl` | `http://192.168.100.5:3000` |
| `publicReservationEnabled` | `true` |
| `publicReservationToken` | (gerado no painel) |

**Link para enviar aos usuários:**

```
http://192.168.100.5:3000/public/fleet/reservation/<TOKEN>
```

- Funciona na rede interna ou VPN — o servidor não precisa de acesso externo.
- O painel **Reserva pública / QR Code** oferece: copiar link, abrir link, QR Code, regenerar token, ativar/desativar.
- **Não** usar `127.0.0.1` no link copiado: configure `publicReservationBaseUrl` com IP/DNS acessível pelos celulares.
- Se a base estiver vazia e o admin acessar por localhost, o painel avisa para configurar a URL.

## Token / QR Code

- Token em `FleetSettings.publicReservationToken` (64 hex).
- Base URL em `FleetSettings.publicReservationBaseUrl`.
- Regeneração: `POST /api/fleet/public-reservation/regenerate-token`.
- QR Code aponta para o **mesmo link completo** (URL codificada no serviço de imagem).
- Placas **não** expostas na API/tela pública.

## Solicitar vs consultar reservas

| Ação | Login |
|------|-------|
| Solicitar reserva (link/QR público) | **Não** — apenas token válido |
| Consultar/administrar solicitações | **Sim** — Frota → Solicitações QR (`fleet.reservations.*`) |

Não há consulta pública por CPF nesta fase.

## Fluxo do usuário (público)

### Etapa 1 — CPF (primeiro campo)

- Máscara `000.000.000-00`, validação de dígitos verificadores.
- `POST /identify` consulta `FleetDriver` por CPF normalizado (somente dígitos).
- CPF inválido → erro 400; não grava cadastro.

### Etapa 2 — Cadastro ou confirmação

**CPF encontrado:**

- Mensagem “Encontramos seu cadastro”.
- Exibe nome, telefone/e-mail (mínimo necessário).
- Se CNH cadastrada → status “CNH cadastrada” e segue.
- Se falta CNH → formulário mínimo (número, categoria, validade) via `POST /register`.

**CPF não encontrado:**

- “Vamos fazer seu cadastro rápido”.
- Cria registro em `FleetDriver` (status `PENDING`, nota `[Cadastro público QR]`).
- Campos: nome, telefone obrigatórios; CNH obrigatória; e-mail/setor opcionais.
- Não duplica CPF (validação `assertUniqueActiveDriverCpf`).

### Etapa 3 — Seleção do carro (obrigatória)

- `GET /vehicles` — marca, modelo, tipo/categoria; sem placa.

### Etapa 4 — Dia e período

- `GET /availability?vehicleId=&from=YYYY-MM-DD&days=7`
- Navegação por semanas; rótulos “Segunda, 10/06”.
- Slots de 3h: 06–09, 09–12, 12–15, 15–18, **17–20** (sem 18–21).
- Dia atual: oculta slots já passados.
- Status visual: disponível / indisponível / selecionado.

### Etapa 5 — Motivo e confirmação

- Motivo, destino, observações, passageiros opcional.
- Aceite de responsabilidade obrigatório.
- `POST /request` → código `FRQ-XXXXXXXX`; status inicial conforme cadastro do motorista (ver **Aprovação em duas etapas**).

## Regras de slots

- Janela: **06:00–20:00**; duração **180 min**.
- Último slot: **17:00–20:00**.
- Conflito por veículo: overlap `existing.start < requested.end AND existing.end > requested.start`.
- Bloqueadores: reservas `REQUESTED|PENDING_APPROVAL|APPROVED|IN_USE` e solicitações `PENDING_DRIVER_APPROVAL|PENDING_RESERVATION_APPROVAL|PENDING` (legado).

## Segurança

- Todos os endpoints exigem token público válido e feature ativa.
- CPF armazenado normalizado (11 dígitos).
- Resposta de `/identify` mínima (sem dados de terceiros).
- Rate limit em POST (identify, register, request): 15/min por IP.
- Sanitização de textos; validação de slot na grade permitida e revalidação no POST final.

## Aprovação em duas etapas

Quando o motorista precisa de validação interna, a solicitação **não** vai direto para aprovação do veículo.

### Quando exige aprovação do motorista (`PENDING_DRIVER_APPROVAL`)

- Motorista recém-cadastrado pelo fluxo público (`FleetDriver.status = PENDING`, `createdFromPublicReservation = true`).
- Motorista existente com `status` diferente de `AUTHORIZED`.
- CNH ausente, incompleta ou vencida.

### Quando vai direto para aprovação da reserva (`PENDING_RESERVATION_APPROVAL`)

- CPF já cadastrado, motorista `AUTHORIZED`, CNH válida.

### Status da solicitação (`FleetPublicReservationRequestStatus`)

| Status | Significado |
|--------|-------------|
| `PENDING_DRIVER_APPROVAL` | Aguardando validação do cadastro/CNH do motorista |
| `PENDING_RESERVATION_APPROVAL` | Motorista ok; aguardando aprovação do veículo/período |
| `PENDING` | Legado — migrado para `PENDING_RESERVATION_APPROVAL` |
| `APPROVED` | Reserva criada (`FleetReservation`) |
| `REJECTED` | Rejeitada (motorista ou reserva) |
| `CANCELLED` | Cancelada |

### Status do motorista (`FleetDriver`)

Reutiliza `FleetDriver.status` (`PENDING` / `AUTHORIZED` / `BLOCKED`). Campos adicionais:

- `createdFromPublicReservation` — `true` para cadastro via QR público
- `publicRegistrationReviewedAt`, `publicRegistrationReviewedByUserId`, `publicRegistrationRejectionReason`

Motoristas existentes antes da migration permanecem como estavam (em geral `AUTHORIZED`); `createdFromPublicReservation` default `false`.

### Fluxo de aprovação (interno)

1. **Etapa 1 — Motorista** (somente se `PENDING_DRIVER_APPROVAL`):
   - `POST /api/fleet/public-reservation-requests/:id/approve-driver` → motorista `AUTHORIZED`, solicitação → `PENDING_RESERVATION_APPROVAL`
   - `POST /api/fleet/public-reservation-requests/:id/reject-driver` (motivo obrigatório) → motorista `BLOCKED`, solicitação → `REJECTED`
2. **Etapa 2 — Reserva** (se `PENDING_RESERVATION_APPROVAL`):
   - `PATCH .../approve` — valida motorista aprovado, conflito de agenda; cria `FleetReservation` **APPROVED**
   - `PATCH .../reject` — motivo obrigatório

Tentar aprovar reserva com motorista pendente retorna **409** com mensagem: *"Aprove o cadastro do motorista antes de aprovar a reserva."*

### Mensagens no fluxo público

- Motorista recém-cadastrado / pendente: *"Primeiro validaremos seu cadastro de motorista e depois a reserva do veículo."*
- Motorista já aprovado: *"Sua solicitação foi enviada e será analisada pela equipe responsável."*

## Histórico de aprovações

Cada aprovação ou rejeição de motorista/reserva gera registro imutável em `FleetPublicReservationApprovalHistory`. O histórico **não é apagado** quando a solicitação muda de status e **permanece** após a criação da `FleetReservation`.

### Model / tabela

| Campo | Descrição |
|-------|-----------|
| `publicReservationRequestId` | Solicitação QR vinculada |
| `action` | `DRIVER_APPROVED`, `DRIVER_REJECTED`, `RESERVATION_APPROVED`, `RESERVATION_REJECTED`, … |
| `stage` | `DRIVER_REGISTRATION`, `VEHICLE_RESERVATION`, `SYSTEM` |
| `statusBefore` / `statusAfter` | Status da solicitação no momento da ação |
| `actorUserId` | Usuário interno que decidiu |
| `actorNameSnapshot` / `actorEmailSnapshot` | Snapshot preservado se o usuário mudar depois |
| `driverId`, `vehicleId`, `fleetReservationId` | Vínculos opcionais |
| `rejectionReason` | Obrigatório em rejeições |
| `detailsJson` | Snapshot da solicitação (CPF mascarado, motorista, veículo, período, motivo/destino) |
| `createdAt` | Data/hora da decisão |

Migration: `20260614120000_fleet_public_reservation_approval_history`

### Ações registradas

| Fluxo | Ação | Etapa |
|-------|------|-------|
| Aprovar motorista | `DRIVER_APPROVED` | `DRIVER_REGISTRATION` |
| Rejeitar motorista | `DRIVER_REJECTED` | `DRIVER_REGISTRATION` |
| Aprovar reserva | `RESERVATION_APPROVED` | `VEHICLE_RESERVATION` |
| Rejeitar reserva | `RESERVATION_REJECTED` | `VEHICLE_RESERVATION` |

**Não registrado:** tentativas de aprovação que falham por conflito de agenda ou veículo indisponível (erro 409/422 antes da transação). Essas falhas não são decisões — apenas bloqueios técnicos.

### Endpoint interno

`GET /api/fleet/public-reservation-requests/:id/history`

Resposta: `{ items: [...] }` ordenado do **mais antigo para o mais recente** (`createdAt asc`).

### Permissões

| Ação | Permissão |
|------|-----------|
| Consultar histórico | `fleet.reservations.view` (fallback `fleet.manage`) |
| Aprovar / rejeitar | `fleet.reservations.approve` |

Usuário público **não** acessa este endpoint.

### Regras de rejeição

- Motivo obrigatório em `reject-driver` e `reject`.
- Motivo gravado em `rejectionReason`, `reviewComment` da solicitação e exibido na UI.

### UI — Frota → Solicitações QR → Detalhes

Seção **Histórico de aprovações** com linha do tempo. Campos: data/hora, etapa, ação, usuário, comentário, motivo da rejeição.

Exemplos:

- *Motorista aprovado por João em 08/06/2026, 14:30*
- *Motorista rejeitado por Maria em 08/06/2026, 14:42 — Motivo: CNH vencida*
- *Reserva aprovada por João em 08/06/2026, 15:10*
- *Reserva rejeitada por Maria em 08/06/2026, 15:20 — Motivo: veículo indisponível*

Se vazio: *"Nenhuma decisão registrada ainda."*

`detailsJson` **não** inclui token público, senha ou dados sensíveis indevidos; CPF é mascarado.

## Fluxo de aprovação (interno) — UI

- Aba **Frota → Solicitações QR**
- Badge **Aguardando aprovação do motorista** ou **Aguardando aprovação da reserva**
- Exibe: CPF, nome, telefone/e-mail, CNH, veículo, dia/período, motivo, destino
- Etapa 1: botões **Aprovar motorista** / **Rejeitar motorista**
- Etapa 2: **Aprovar reserva** / **Rejeitar reserva** (desabilitado enquanto motorista pendente)
- Detalhe: **Histórico de aprovações** e motivo da rejeição quando `REJECTED`

## Permissões internas

| Ação | Permissão |
|------|-----------|
| Ver solicitações / link | `fleet.reservations.view` |
| Aprovar / rejeitar motorista e reserva | `fleet.reservations.approve` |
| Token / parâmetros | `fleet.settings.manage` |

## Endpoints internos (aprovação)

| Método | Rota |
|--------|------|
| GET | `/api/fleet/public-reservation-requests/:id/history` |
| POST | `/api/fleet/public-reservation-requests/:id/approve-driver` |
| POST | `/api/fleet/public-reservation-requests/:id/reject-driver` |
| PATCH | `/api/fleet/public-reservation-requests/:id/approve` |
| PATCH | `/api/fleet/public-reservation-requests/:id/reject` |

## Endpoints públicos

| Método | Rota |
|--------|------|
| GET | `/api/public/fleet/reservation/:token/config` |
| POST | `/api/public/fleet/reservation/:token/identify` |
| POST | `/api/public/fleet/reservation/:token/register` |
| GET | `/api/public/fleet/reservation/:token/vehicles` |
| GET | `/api/public/fleet/reservation/:token/availability?vehicleId=&from=&days=7` |
| POST | `/api/public/fleet/reservation/:token/request` |

## Models / migrations

- `FleetPublicReservationRequest` + `requesterCpf`, `driverId` → `FleetDriver`
- `FleetPublicReservationApprovalHistory` — histórico de decisões
- Migrations: `20260609120000_*`, `20260610120000_fleet_public_reservation_cpf_driver`, `20260612120000_fleet_public_driver_approval`, `20260614120000_fleet_public_reservation_approval_history`
- Reutiliza **`FleetDriver`** — sem model duplicado de condutor.

## Validação no servidor

```bash
cd /opt/induscost
git pull origin main
npx prisma migrate deploy
npx prisma generate
npm run test:fleet
npm run build
sudo systemctl restart induscost
```

1. **Frota → Configurações**: `publicReservationBaseUrl = http://192.168.100.5:3000` (ou IP/DNS real).
2. Gerar token, ativar `publicReservationEnabled`, salvar.
3. Copiar link do painel e abrir no celular (mesma rede/VPN).
4. Confirmar tela de CPF sem login.
5. Enviar solicitação teste; aprovar em **Solicitações QR**.

## Correção de data local e elegibilidade de veículos

### Causa do bug 08/06 → 07/06

- Coluna `requestedDate` (`@db.Date`) é lida pelo Prisma como `Date` em **meia-noite UTC** (ex.: `2026-06-08T00:00:00.000Z`).
- A tela interna formatava com `new Date(iso).toLocaleDateString("pt-BR")`, que em fuso Brasil (UTC−3) exibe **07/06**.
- Persistência antiga usava meia-noite **local** do servidor, instável entre ambientes.

### Regra final de data local

| Uso | Helper |
|-----|--------|
| Persistir dia escolhido (`DATE`) | `parseLocalDateOnly("YYYY-MM-DD")` — meio-dia UTC estável |
| Ler dia do banco | `dateOnlyToYmd(date)` — componentes UTC |
| Montar `DateTime` da reserva | `buildFleetReservationLocalDateTime(date, "HH:mm")` — parede de relógio local |
| Exibir na UI/API | `formatFleetLocalDate` → `DD/MM/YYYY` sem deslocar |
| Tráfego API | `requestedDate: "2026-06-08"` (string), não ISO UTC do frontend |

**Proibido** para regra de dia: `new Date("YYYY-MM-DD")` no frontend/backend para exibição ou gravação de calendário.

### Veículos que não aparecem no fluxo público

Somente `FleetVehicle.status = AVAILABLE` na listagem pública. Excluídos (via `isVehicleReservable` / `isPublicReservationVehicleEligible`):

`BLOCKED`, `MAINTENANCE`, `IN_USE`, `INACTIVE`, `RETURNED`, `SOLD`, `CLAIMED`, `RESERVED`

### Validações no backend

- `GET /vehicles` — só `AVAILABLE`
- `GET /availability` — `assertPublicReservationVehicleOrThrow`
- `POST /request` — revalida elegibilidade (422 se bloqueado/inativo)
- `PATCH .../approve` — revalida antes de criar `FleetReservation` (422 se indisponível)

### Como testar no servidor

1. Solicitar reserva para **08/06** no link público → em **Solicitações QR** deve aparecer **08/06/2026** (não 07/06).
2. Veículo `BLOCKED` ou `INACTIVE` não deve listar no público.
3. `POST /request` com `vehicleId` bloqueado → 422.
4. Aprovar solicitação após bloquear veículo → 422 com mensagem clara.

## Limitações

- Cadastro público cria motorista `PENDING` (validação interna posterior).
- Sem notificação automática ao solicitante.
- Rate limit em memória (instância única).
