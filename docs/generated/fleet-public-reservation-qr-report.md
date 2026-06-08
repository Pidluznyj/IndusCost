# Fleet — Solicitação pública de reserva via QR Code

## Objetivo

Permitir que colaboradores solicitem reserva de veículo por página pública/mobile (QR Code), sem login no ERP. Identificação por **CPF**, vínculo com cadastro de **motorista** (`FleetDriver`), seleção obrigatória de veículo e período. A equipe de frota aprova ou rejeita internamente.

## Rota pública (frontend)

- `/public/fleet/reservation/:token`

## Token / QR Code

- Token em `FleetSettings.publicReservationToken` (64 hex, `crypto.randomBytes(32)`).
- Ativação: `publicReservationEnabled = true`.
- Regeneração interna: `POST /api/fleet/public-reservation/regenerate-token`.
- QR Code: `api.qrserver.com` no painel **Frota → Configurações**.
- Placas **não** expostas na API/tela pública.

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
- `POST /request` → status **PENDING**, código `FRQ-XXXXXXXX`.

## Regras de slots

- Janela: **06:00–20:00**; duração **180 min**.
- Último slot: **17:00–20:00**.
- Conflito por veículo: overlap `existing.start < requested.end AND existing.end > requested.start`.
- Bloqueadores: reservas `REQUESTED|PENDING_APPROVAL|APPROVED|IN_USE` e solicitações `PENDING`.

## Segurança

- Todos os endpoints exigem token público válido e feature ativa.
- CPF armazenado normalizado (11 dígitos).
- Resposta de `/identify` mínima (sem dados de terceiros).
- Rate limit em POST (identify, register, request): 15/min por IP.
- Sanitização de textos; validação de slot na grade permitida e revalidação no POST final.

## Fluxo de aprovação (interno)

- Aba **Frota → Solicitações QR**
- Exibe: CPF, nome, status CNH, veículo, dia/período, motivo, destino.
- Aprovar: veículo + motorista (pré-preenchido se `driverId` na solicitação); valida conflito; cria `FleetReservation` **APPROVED**.
- Rejeitar: motivo obrigatório.

## Permissões internas

| Ação | Permissão |
|------|-----------|
| Ver solicitações / link | `fleet.reservations.view` |
| Aprovar / rejeitar | `fleet.reservations.approve` |
| Token / parâmetros | `fleet.settings.manage` |

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
- Migrations: `20260609120000_*`, `20260610120000_fleet_public_reservation_cpf_driver`
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

1. Ativar token e `publicReservationEnabled`.
2. Testar CPF existente e CPF novo no celular.
3. Selecionar veículo, período, enviar solicitação.
4. Aprovar em **Solicitações QR**.

## Limitações

- Cadastro público cria motorista `PENDING` (validação interna posterior).
- Sem notificação automática ao solicitante.
- Rate limit em memória (instância única).
