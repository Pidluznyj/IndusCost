# Collector — gateway HTTPS (Tailscale + Nginx): boot confiável, instalação e operação

> Complementa `docs/stock-collector-secure-ingress.md` (arquitetura de segurança do
> ingress). Este documento cobre **disponibilidade**: por que o Nginx do Collector
> caía no boot, como o systemd passa a esperar o Tailscale, como instalar,
> verificar, promover e reverter. Nada aqui muda QR Codes, rotas `/collector/*`,
> autenticação do device, sessões, setores ou banco.

## Arquitetura (o que está no ar)

```
DEVICE (tailnet)
  → https://<hostname MagicDNS do host>                     (TLS no Nginx, certificado `tailscale cert`)
  → Nginx  bind EXCLUSIVO em <IP Tailscale>:443            (allow 100.64.0.0/10; deny all)
      · sobrescreve X-IndusCost-Tailscale-Peer = $remote_addr
      · apaga X-Forwarded-For / X-Real-IP / CF-Connecting-IP
  → http://127.0.0.1:<porta da app>                        (IndusCost no próprio host)
```

| Ambiente | Host | Hostname | IP Tailscale | App | Fonte dos valores |
|---|---|---|---|---|---|
| Produção | AWS Ubuntu 24.04 (`/opt/induscost`, `induscost.service`) | `induscost-prod-saopaulo.tail31eb9e.ts.net` | `100.85.97.124` | `127.0.0.1:3000` | `infra/collector-gateway/env/production.env` |
| Homologação | servidor-01 (`induscost-homolog`) | `servidor-01.tail31eb9e.ts.net` | `100.64.174.124` | `127.0.0.1:3001` | `infra/collector-gateway/env/homolog.env` — **diretório do certificado e nome do vhost a confirmar no host** |

**Por que o bind é no IP Tailscale e não em `0.0.0.0`:** o gateway só deve
existir dentro do tailnet. `listen 0.0.0.0:443` exporia o TLS do Collector em
qualquer interface do host (na AWS, na interface pública, dependendo do
firewall). O `allow/deny` é a segunda barreira; o bind é a primeira. Nenhuma
das duas é afrouxada "para facilitar o boot".

## O problema: corrida no boot

Após reboot/start da AWS:

```
nginx: [emerg] bind() to 100.85.97.124:443 failed (99: Cannot assign requested address)
```

Sequência real: `nginx.service` subiu antes de o `tailscaled` colocar o
endereço `100.85.97.124` na interface `tailscale0`; o bind falhou; o unit ficou
`failed` (o pacote Ubuntu não tem `Restart=`); o Tailscale subiu logo depois,
mas ninguém reiniciou o Nginx; a porta 443 ficou fechada e o Collector mostrou
`ERR_CONNECTION_REFUSED`. Um `systemctl restart nginx` manual resolvia.

## A solução (versionada em `infra/collector-gateway/`)

| Arquivo no repositório | Instalado em | Papel |
|---|---|---|
| `env/production.env`, `env/homolog.env` | `/etc/induscost/collector-gateway.env` | **Única** fonte do IP, hostname, portas, TLS e nome do vhost por ambiente |
| `nginx/induscost-collector.conf.template` | `/etc/nginx/sites-available/<COLLECTOR_NGINX_SITE>` (+ symlink em `sites-enabled`) | Vhost renderizado — diretivas idênticas à configuração de produção vigente, incluindo `X-IndusCost-Tailscale-Peer` |
| `systemd/nginx.service.d/induscost-tailscale.conf` | `/etc/systemd/system/nginx.service.d/induscost-tailscale.conf` | Drop-in: ordenação, espera real e restart automático |
| `bin/wait-for-tailscale.sh` | `/usr/local/lib/induscost/wait-for-tailscale.sh` | Espera o IP existir de fato (timeout finito) |
| `scripts/install-collector-gateway.sh` | — | Instalador idempotente / rollback |
| `scripts/check-collector-gateway.sh` | — | Health check |

### Drop-in do systemd (o unit do pacote não é alterado)

```ini
[Unit]
Wants=network-online.target tailscaled.service
After=network-online.target tailscaled.service
StartLimitIntervalSec=1800
StartLimitBurst=10

[Service]
EnvironmentFile=-/etc/induscost/collector-gateway.env
ExecStartPre=/usr/local/lib/induscost/wait-for-tailscale.sh
TimeoutStartSec=180
Restart=on-failure
RestartSec=10
```

Notas de compatibilidade (Ubuntu 24.04, systemd 255, `nginx.service` do pacote):

- `After=tailscaled.service` sozinho **não basta**: o tailscaled fica `active`
  antes de negociar e atribuir o IP. Daí o `ExecStartPre` com espera real.
- O pacote já tem `ExecStartPre=/usr/sbin/nginx -t -q ...`; drop-ins
  **acrescentam** linhas, então a ordem no boot é `nginx -t` → `wait` → start.
  `nginx -t` não faz bind, por isso passa mesmo sem o IP.
- `Type=forking`: o start só termina quando o master forka; `TimeoutStartSec=180`
  cobre a espera (até 120 s) com folga. `Restart=on-failure` funciona
  normalmente com forking — se o bind falhar, o processo sai com erro e o
  systemd tenta de novo após 10 s.
- `StartLimitBurst=10` em 30 min evita o limite padrão (5 em 10 s) sem virar
  loop infinito: no pior caso são 10 tentativas × 120 s de espera.
- `network-online.target` só é útil se o `systemd-networkd-wait-online`/
  `NetworkManager-wait-online` estiver habilitado; na AWS (netplan +
  systemd-networkd) está. Se não estiver, o `wait` continua garantindo o
  resultado — a ordenação é só um adiantamento.

### `wait-for-tailscale.sh`

Verifica, a cada 2 s até `COLLECTOR_TAILSCALE_WAIT_TIMEOUT` (padrão 120 s):

1. `tailscale status --json` → `BackendState == "Running"` (estado oficial do daemon);
2. `tailscale ip -4` → o daemon atribuiu exatamente o IP esperado;
3. `ip -4 addr show dev tailscale0` → o kernel já tem o endereço (é isto que o
   `bind()` precisa; 1 e 2 sozinhos não bastam).

Sai `0` quando os três valem; `1` no timeout, com o motivo no journal
(`tailscaled ainda não está Running`, `ainda não atribuiu 100.x`, `ausente em
tailscale0`); `2` se a configuração ou o `tailscale` faltarem. Não usa
`tailscale up` (pode alterar a configuração do nó) e não depende de `jq`.
A CLI do Tailscale não tem um "wait until ready" oficial; esta é a forma
suportada com os comandos disponíveis.

### Tailscale reiniciando com o servidor ligado

Cenário: `nginx` ativo, `tailscaled` reinicia, o endereço some da `tailscale0`
por alguns segundos e volta.

Comportamento no Linux: um socket TCP em `LISTEN` amarrado a um endereço
específico **não é destruído** quando o endereço sai da interface; enquanto o
endereço não existe, ninguém alcança a porta; quando o mesmo IP volta, o mesmo
socket volta a aceitar conexões, sem reiniciar o Nginx. Por isso **não** há
hook em `tailscaled.service` (`PropagatesReloadTo`, `PartOf` etc.): seria um
restart do Nginx sem necessidade. Único caso em que o Nginx precisa de ação: o
IP Tailscale **mudar** — aí é uma mudança de ambiente (editar o `.env`, commit,
reinstalar), não um evento de boot.

Como confirmar em homologação: com o gateway no ar, `sudo systemctl restart
tailscaled`, aguardar `tailscale status` voltar a `Running` e rodar o health
check — deve dar `RESULTADO: OK` sem `systemctl restart nginx`.

## Instalação (comando explícito pós-deploy)

Não faz parte de `induscost-deploy-homologacao` nem de
`scripts/deploy-server-main-update.sh`: a instalação de infraestrutura do host
é uma janela própria, como já era (`docs/stock-collector-secure-ingress.md`).

```bash
cd /opt/induscost            # checkout do commit já promovido
sudo bash scripts/install-collector-gateway.sh --env production --dry-run   # mostra o que faria
sudo bash scripts/install-collector-gateway.sh --env production
sudo bash scripts/check-collector-gateway.sh
```

O instalador, nesta ordem: valida root, `nginx`, `tailscale`, `systemd`,
`tailscaled.service`, certificado/chave (existência, CN, validade), que
`tailscale ip -4` devolve o IP configurado **neste** host, e que nenhum outro
vhost habilitado já responde pelo hostname; renderiza o template e recusa se
faltar o header dedicado, o bind exclusivo ou o `deny all`; faz backup em
`/var/backups/induscost/collector-gateway/<data>/`; grava env, wait script,
drop-in e vhost; `daemon-reload`; `nginx -t` (se falhar, restaura o backup e
aborta); `reload` se o Nginx já estiver ativo (depois de confirmar o IP), ou
`restart`. Não toca na app Node, no banco, em migrations, firewall, ACL do
Tailscale, DNS ou certificados.

Se o vhost de produção já existir com **outro nome de arquivo**, o instalador
para e pede para ajustar `COLLECTOR_NGINX_SITE` no `.env` do ambiente para esse
nome (o arquivo é então substituído com backup) — isso evita dois `server` com
o mesmo `server_name`.

## Health check

```bash
sudo bash scripts/check-collector-gateway.sh              # usa /etc/induscost/collector-gateway.env
sudo bash scripts/check-collector-gateway.sh --env homolog
```

Verifica: `tailscaled` ativo e `Running`; IP esperado em `tailscale0`; `nginx`
ativo; `nginx -t`; drop-in instalado e `After=tailscaled.service` efetivo;
`<IP>:443` em LISTEN; nenhum listener em `0.0.0.0:443`; app em `:<porta>` e
`/api/health` 200; certificado presente, emissor e validade (falha se
expirado, alerta com menos de 14 dias); HTTPS real com SNI
(`curl --resolve <hostname>:443:<IP> https://<hostname>/collector`, aceita
200/301/302). Termina com `RESULTADO: OK` (exit 0) ou `RESULTADO: FAIL` (exit 1).

## Diagnóstico

```bash
systemctl status nginx --no-pager
journalctl -u nginx -n 100 --no-pager          # inclui as linhas "wait-for-tailscale: ..."
systemctl status tailscaled --no-pager
tailscale status
tailscale ip -4
ip -4 addr show dev tailscale0
ss -lntp | grep -E ':443 |:3000 |:3001 '
nginx -T | grep -E 'listen|server_name|ssl_certificate|Tailscale-Peer'
systemctl cat nginx                             # unit do pacote + drop-in
sudo bash scripts/check-collector-gateway.sh
```

Leitura rápida do journal após um boot:

- `wait-for-tailscale: aguardando (...)` seguido de `pronto: ... presente em tailscale0` → funcionou como desenhado;
- `wait-for-tailscale: TIMEOUT após 120s: ...` → o Tailscale não subiu em 2 min; o motivo está na mesma linha; o systemd tenta de novo em 10 s (até 10 vezes em 30 min);
- `bind() ... failed (99)` **sem** linhas do wait → o drop-in não está instalado ou `daemon-reload` não foi feito.

## Rollback

```bash
sudo bash scripts/install-collector-gateway.sh --rollback
```

Restaura o vhost, o drop-in e o env do último backup em
`/var/backups/induscost/collector-gateway/`, faz `daemon-reload`, `nginx -t` e
`systemctl restart nginx`. Manual, se preferir:

```bash
sudo rm -f /etc/systemd/system/nginx.service.d/induscost-tailscale.conf
sudo cp /var/backups/induscost/collector-gateway/<data>/site.conf /etc/nginx/sites-available/<COLLECTOR_NGINX_SITE>
sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl restart nginx
```

O `wait-for-tailscale.sh` pode ficar em `/usr/local/lib/induscost`: sem o
drop-in ele não é executado por ninguém.

## Promoção: Git → homologação → produção

1. Commit dos arquivos de `infra/collector-gateway/`, `scripts/` e desta doc.
2. **Homologação (servidor-01):** confirmar `COLLECTOR_TLS_DIR` e
   `COLLECTOR_NGINX_SITE` no host (`sudo nginx -T | grep -E 'listen|server_name|ssl_certificate'`,
   `ls /etc/nginx/tls /etc/induscost/collector-tls`); ajustar
   `env/homolog.env` se precisar (commit); deploy oficial; `--dry-run`; instalar; health check.
3. **Testes em homologação:** `systemctl restart nginx`; `systemctl restart
   tailscaled` + health check; **reboot** (roteiro abaixo).
4. Só com a homologação aprovada, promover **o mesmo commit** para produção:
   deploy oficial de produção; `--dry-run`; instalar; health check.
5. **Não** rebootar produção nesta janela. O reboot de produção fica para uma
   janela controlada, com o health check antes e depois.

### Roteiro do teste de reboot (homologação)

```bash
# antes
sudo bash scripts/check-collector-gateway.sh         # RESULTADO: OK
sudo reboot
# após voltar (1–3 min)
sudo journalctl -b -u nginx --no-pager | grep -E 'wait-for-tailscale|emerg|Started|Failed'
sudo bash scripts/check-collector-gateway.sh         # RESULTADO: OK, sem intervenção manual
curl -sS -o /dev/null -w '%{http_code}\n' https://servidor-01.tail31eb9e.ts.net/collector   # de um device do tailnet: 200
sudo systemctl status induscost-homolog --no-pager | head -5    # app normal
```

Resultado esperado: `tailscaled` sobe → o IP aparece em `tailscale0` → o journal
mostra `wait-for-tailscale: pronto` → `nginx` `active (running)` → `<IP>:443`
em LISTEN → Collector responde do device → app inalterada. Se o journal mostrar
`TIMEOUT` seguido de nova tentativa bem-sucedida, o mecanismo de restart
cumpriu o papel; investigue por que o Tailscale demorou mais de 2 min.

## Certificado

- Origem: `tailscale cert <hostname>` (Let's Encrypt via Tailscale), arquivos
  `<hostname>.crt/.key` em `COLLECTOR_TLS_DIR`. Validade típica: **90 dias**.
- Renovação hoje: **manual** (`tailscale cert` de novo + `systemctl reload nginx`) —
  não há timer no repositório nem no runbook anterior.
- O instalador recusa instalar com certificado expirado e avisa com menos de
  14 dias; o health check reporta emissor, validade e vencimento.
- Automatizar a renovação está **fora deste escopo** (ver findings no relatório
  da entrega); até lá, incluir o health check na rotina semanal de operação.
