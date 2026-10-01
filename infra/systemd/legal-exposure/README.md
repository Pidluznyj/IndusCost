# Timers systemd do Exposure

Agenda oficial: `src/lib/legalExposure/legalExposureSourceSchedule.ts` (`America/Sao_Paulo`).

| Fonte | Horários | Timer | flock |
|---|---|---|---|
| DJEN | 06:10 12:10 18:10 23:10 | `induscost-legal-djen.timer` | `/run/induscost-legal-djen.lock` |
| DataJud | 06:40 12:40 18:40 23:40 | `induscost-legal-datajud.timer` | `/run/induscost-legal-datajud.lock` |
| Tribunal | 07:20 19:20 | `induscost-legal-tribunal.timer` | `/run/induscost-legal-tribunal.lock` |
| Escavador | 03:20 (só se configurado) | `induscost-legal-escavador.timer` | `/run/induscost-legal-escavador.lock` |
| Jusbrasil | 04:10 (só se configurado) | `induscost-legal-jusbrasil.timer` | `/run/induscost-legal-jusbrasil.lock` |

Domicílio: **não** há timer. Permanece desligado por política.

Folga entre DJEN e DataJud: 30 min. Se `durationMs` histórico de DJEN ≥ 25 min, não habilitar DataJud no mesmo ciclo até recalcular horários.

## Timer ALL antigo (rollback simples)

Não apagar a unit na primeira troca. Se existir:

- `induscost-legal-exposure-sync.timer` / `.service`
- cron hourly `legal-exposure:sync --source=ALL`
- cron `legal:exposure:djen:preview` de hora em hora

Documentar o estado, instalar os timers por fonte, validar `systemctl list-timers` contra `nextScheduledAt`, **depois**:

```bash
sudo systemctl disable --now induscost-legal-exposure-sync.timer
sudo systemctl stop induscost-legal-exposure-sync.service
```

As units antigas ficam no disco para rollback:

```bash
sudo systemctl enable --now induscost-legal-exposure-sync.timer
sudo systemctl disable --now induscost-legal-djen.timer induscost-legal-datajud.timer
```

## Homologação

Só depois do checkout com a canonicalização CNJ e gates verdes.

```bash
sudo cp infra/systemd/legal-exposure/*.service /etc/systemd/system/
sudo cp infra/systemd/legal-exposure/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now induscost-legal-djen.timer
sudo systemctl enable --now induscost-legal-datajud.timer
sudo systemctl enable --now induscost-legal-tribunal.timer
# Escavador / Jusbrasil: enable só se a credencial existir (boolean, sem imprimir valor)
```

Escavador/Jusbrasil sem key: **não** enable. O card da UI deve mostrar `NEEDS_CREDENTIAL`.

## Produção

Não habilitar neste ciclo sem homologação verde (duplicate-audit, tests, build, Prisma, health do SHA novo).
