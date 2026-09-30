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

| Ambiente | Host | Hostname | IP Tailscale | App | Vhost real | Fonte dos valores |
|---|---|---|---|---|---|---|
| Produção | AWS Ubuntu 24.04 (`/opt/induscost`) | `induscost-prod-saopaulo.tail31eb9e.ts.net` | `100.85.97.124` | `127.0.0.1:3000` | `/etc/nginx/conf.d/induscost-collector.conf` (confirmado no host) | `infra/collector-gateway/env/production.env` |
| Homologação | servidor-01 (`induscost-homolog`) | `servidor-01.tail31eb9e.ts.net` | `100.64.174.124` | `127.0.0.1:3001` | **CONFIGURE_ME** — a confirmar no host | `infra/collector-gateway/env/homolog.env` |

Produção **não** usa `sites-available`/`sites-enabled`; o instalador grava o
vhost no caminho real (`COLLECTOR_NGINX_CONFIG_PATH`) e nunca cria a estrutura
de sites. Na homologação, a `:3000` do servidor-01 é o **gateway de produção**
— o env de homologação usa `3001` e o instalador recusa `3000`.

**Por que o bind é no IP Tailscale e não em `0.0.0.0`:** o gateway só deve
existir dentro do tailnet. `listen 0.0.0.0:443` exporia o TLS do Collector em
qualquer interface do host. O `allow/deny` é a segunda barreira; o bind é a
primeira. Nenhuma das duas é afrouxada "para facilitar o boot".

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
| `env/production.env`, `env/homolog.env` | `/etc/induscost/collector-gateway.env` | **Única** fonte do IP, hostname, portas, TLS e caminho do vhost por ambiente |
| `nginx/induscost-collector.conf.template` | `COLLECTOR_NGINX_CONFIG_PATH` (produção: `/etc/nginx/conf.d/induscost-collector.conf`) | Vhost renderizado — diretivas idênticas à configuração de produção vigente, incluindo `X-IndusCost-Tailscale-Peer` |
| `systemd/nginx.service.d/induscost-tailscale.conf` | `/etc/systemd/system/nginx.service.d/induscost-tailscale.conf` | Drop-in: ordenação, espera real e restart automático |
| `bin/wait-for-tailscale.sh` | `/usr/local/lib/induscost/wait-for-tailscale.sh` | Espera o IP existir de fato (timeout finito) |
| `scripts/install-collector-gateway.sh` | — | Instalador idempotente / `--dry-run` / `--rollback` |
| `scripts/check-collector-gateway.sh` | — | Health check |

### Variáveis por ambiente

```
COLLECTOR_ENV                     production | homolog
COLLECTOR_TAILSCALE_HOSTNAME      hostname MagicDNS (= CN/SAN do certificado)
COLLECTOR_TAILSCALE_IP            IPv4 Tailscale do host (bind exclusivo)
COLLECTOR_APP_PORT                porta local da app (prod 3000; homolog 3001)
COLLECTOR_HTTPS_PORT              443 (URL dos QR Codes)
COLLECTOR_TLS_DIR                 diretório com <hostname>.crt/.key
COLLECTOR_NGINX_CONFIG_PATH       caminho REAL do vhost (arquivo dentro de /etc/nginx)
COLLECTOR_TAILSCALE_WAIT_TIMEOUT  segundos de espera no boot (120)
```

Valor `CONFIGURE_ME` = não confirmado no host: o instalador recusa executar
(inclusive `--dry-run`) até o valor ser descoberto e commitado.

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

`systemctl cat nginx` esperado depois da instalação (Ubuntu 24.04, systemd 255):

```
# /usr/lib/systemd/system/nginx.service
[Unit]
Description=A high performance web server and a reverse proxy server
Documentation=man:nginx(8)
After=network.target nss-lookup.target

[Service]
Type=forking
PIDFile=/run/nginx.pid
ExecStartPre=/usr/sbin/nginx -t -q -g 'daemon on; master_process on;'
ExecStart=/usr/sbin/nginx -g 'daemon on; master_process on;'
ExecReload=/usr/sbin/nginx -g 'daemon on; master_process on;' -s reload
ExecStop=-/sbin/start-stop-daemon --quiet --stop --retry QUIT/5 --pidfile /run/nginx.pid
TimeoutStopSec=5
KillMode=mixed

[Install]
WantedBy=multi-user.target

# /etc/systemd/system/nginx.service.d/induscost-tailscale.conf
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

Ordem efetiva no start: `nginx -t` (do pacote; não faz bind) → `wait-for-tailscale.sh`
→ `ExecStart`. Garantias conferidas:

- `StartLimitIntervalSec`/`StartLimitBurst` estão em `[Unit]` — é a seção
  correta desde systemd 230 (em `[Service]` seriam ignoradas com aviso).
- O drop-in **acrescenta** `ExecStartPre`; não há linha `ExecStartPre=` vazia, então
  o `nginx -t` original continua. `ExecStart`, `ExecReload`, `ExecStop`, `PIDFile`
  e `Type=forking` do pacote ficam intocados.
- `EnvironmentFile` vale para todos os `Exec*`, inclusive `ExecStartPre`.
- `Type=forking` + `Restart=on-failure`: se o processo inicial sai com erro
  (bind falhou), o start é falha e o systemd reinicia após `RestartSec`.
- `TimeoutStartSec=180` cobre a espera (120 s) + o start.
- `network-online.target` só adianta se `systemd-networkd-wait-online` estiver
  ativo (na AWS com netplan está); o `wait` garante o resultado de todo modo.

### `wait-for-tailscale.sh`

Critério de sucesso — o que o `bind()` precisa de fato:

1. o IP esperado existe no kernel, em qualquer interface local (`ip -4 -o addr show`);
2. o `tailscaled` está ativo (`systemctl is-active tailscaled`).

`tailscale status --json` (BackendState) e `tailscale ip -4` aparecem **só nas
mensagens de diagnóstico**; não decidem, para não gerar falso negativo se a CLI
se comportar diferente com o IP já válido. Polling a cada 2 s até
`COLLECTOR_TAILSCALE_WAIT_TIMEOUT` (120 s). Sai `0` pronto, `1` no timeout com o
motivo no journal, `2` sem configuração/ferramentas. Não usa `tailscale up`.

### COMPORTAMENTO A VALIDAR EM HOMOLOGAÇÃO — Tailscale reiniciando com o servidor ligado

Hipótese (não garantia): um socket TCP em `LISTEN` amarrado a um endereço
específico sobrevive à remoção temporária do endereço e volta a atender quando o
mesmo IP retorna, sem reiniciar o Nginx. Por isso **não** há hook em
`tailscaled.service` nesta entrega.

Teste em homologação, com o gateway no ar:

```bash
sudo systemctl restart tailscaled
sleep 15
tailscale status
ip addr show tailscale0
ss -lntp | grep :443
sudo bash scripts/check-collector-gateway.sh
curl -sS -o /dev/null -w '%{http_code}\n' https://servidor-01.tail31eb9e.ts.net/collector   # de um device do tailnet
```

Esperado: IP de volta na `tailscale0`, `<IP>:443` em LISTEN, health check
`RESULTADO: OK`, Collector respondendo — tudo **sem** `systemctl restart nginx`.
Se falhar, desenharemos um mecanismo de recuperação separado (via systemd, sem
cron improvisado).

## Instalação (comando explícito pós-deploy)

Não faz parte de `induscost-deploy-homologacao` nem de
`scripts/deploy-server-main-update.sh`: a instalação de infraestrutura do host
é uma janela própria, como já era (`docs/stock-collector-secure-ingress.md`).

```bash
cd /opt/induscost            # checkout do commit já promovido
sudo bash scripts/install-collector-gateway.sh --env production --dry-run   # só valida e mostra; nada escrito
sudo bash scripts/install-collector-gateway.sh --env production
sudo bash scripts/check-collector-gateway.sh
```

Ordem do instalador: validar env (sem `CONFIGURE_ME`, IP na faixa Tailscale,
caminho do vhost dentro de `/etc/nginx`, homolog ≠ `:3000`) → ferramentas
(`nginx`, `tailscale`, `systemctl`, `ip`, `ss`, `openssl`, units) → certificado
(existência, CN, validade; expirado = abortar) → `tailscale ip -4` devolve o IP
configurado **neste** host → nenhum **outro** arquivo em `/etc/nginx` declara o
mesmo `server_name`/`listen` (evita dois server blocks, ex.: `conf.d` +
`sites-enabled`) → renderiza o template em arquivo temporário → valida o
renderizado (bind exclusivo, header dedicado, `deny all`, upstream da porta) →
**backup** em `/var/backups/induscost/collector-gateway/<data>/` (vhost, drop-in,
env anteriores) → instala wait script, env, drop-in e vhost **no mesmo caminho**
→ `daemon-reload` → `nginx -t` → **qualquer falha a partir da substituição
restaura o backup automaticamente** (`trap`) → `reload` se o Nginx já está de pé
(após confirmar o IP) ou `restart` → health check → resumo.

`--dry-run` não escreve em `/etc`, `/usr/local`, systemd, Nginx nem backup:
valida, renderiza em temporário, mostra destinos e o que faria.

Não toca na app Node, no banco, em migrations, firewall, ACL do Tailscale, DNS
ou certificados.

## Health check

```bash
sudo bash scripts/check-collector-gateway.sh              # usa /etc/induscost/collector-gateway.env
sudo bash scripts/check-collector-gateway.sh --env production
```

Verifica: `tailscaled` ativo (BackendState só informativo); IP esperado em
interface local; `nginx` ativo; `nginx -t`; vhost presente com
`X-IndusCost-Tailscale-Peer $remote_addr`; nenhum outro arquivo com o mesmo
hostname/listen; drop-in instalado e `ExecStartPre` com o wait; `<IP>:443` em
LISTEN; nenhum listener em `0.0.0.0:443`; app na porta do env e `/api/health`
200; certificado e chave presentes; **subject, issuer, notBefore, notAfter, dias
restantes** (FAIL expirado, WARN ≤ 14 dias) e SAN; HTTPS real com SNI e
validação da cadeia (`curl --resolve`, **sem `-k`**), aceitando
200/301/302/303/307/308 e mostrando o código HTTP; se a cadeia falhar, mostra
como informação o código obtido sem validar. Termina com `RESULTADO: OK`
(exit 0) ou `RESULTADO: FAIL` (exit 1).

## Diagnóstico

```bash
systemctl status nginx --no-pager
journalctl -u nginx -n 100 --no-pager          # inclui as linhas "wait-for-tailscale: ..."
systemctl status tailscaled --no-pager
tailscale status
tailscale ip -4
ip -4 addr show
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

Restaura **exatamente** o vhost substituído (no mesmo caminho; remove-o se não
existia antes), o drop-in e o env do último backup em
`/var/backups/induscost/collector-gateway/`, faz `daemon-reload`, `nginx -t` e
`systemctl restart nginx`. Manual, se preferir (produção):

```bash
sudo rm -f /etc/systemd/system/nginx.service.d/induscost-tailscale.conf
sudo cp /var/backups/induscost/collector-gateway/<data>/site.conf /etc/nginx/conf.d/induscost-collector.conf
sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl restart nginx
```

O `wait-for-tailscale.sh` pode ficar em `/usr/local/lib/induscost`: sem o
drop-in ele não é executado por ninguém.

## Promoção: Git → homologação → produção

1. Commit dos arquivos de `infra/collector-gateway/`, `scripts/` e desta doc.
2. **Homologação (servidor-01):** descobrir e commitar `COLLECTOR_TLS_DIR` e
   `COLLECTOR_NGINX_CONFIG_PATH` (`sudo nginx -T | grep -E 'listen|server_name|ssl_certificate'`,
   `sudo grep -rl 'servidor-01.tail31eb9e.ts.net' /etc/nginx/`,
   `ls -l /etc/nginx/tls /etc/induscost/collector-tls`); deploy oficial;
   `--dry-run`; instalar; health check.
3. **Testes em homologação:** `systemctl restart nginx`; `systemctl restart
   tailscaled` + health check (seção "a validar"); **reboot** (roteiro abaixo).
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
- O instalador recusa instalar com certificado expirado e avisa com ≤ 14 dias;
  o health check imprime subject, issuer, notBefore, notAfter e dias restantes.
- Automatizar a renovação está **fora deste escopo**; até lá, incluir o health
  check na rotina semanal de operação.
