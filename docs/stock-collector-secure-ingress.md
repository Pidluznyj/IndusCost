# Stock Collector — Ingress HTTPS seguro pelo tailnet (Fase 3A)

> Template de referência. **Nada deste documento é aplicado automaticamente** —
> a instalação no host é uma janela operacional própria, fora do deploy da app.

## ⚠️ AVISO CRÍTICO DE TOPOLOGIA — LEIA ANTES DE QUALQUER `proxy_pass`

Existem DOIS ambientes com portas que se parecem, mas significam coisas
diferentes:

| Host | Porta local | O que é |
|---|---|---|
| **servidor-01** | `127.0.0.1:3000` | **GATEWAY DE PRODUÇÃO (encaminha para a AWS)** |
| **servidor-01** | `127.0.0.1:3001` | IndusCost **HOMOLOGAÇÃO** local |
| **host AWS (produção)** | `127.0.0.1:3000` | IndusCost **PRODUÇÃO** no próprio host |

**NUNCA USAR A PORTA :3000 DO SERVIDOR-01 COMO UPSTREAM DO COLLECTOR DURANTE A
HOMOLOGAÇÃO. ELA É O GATEWAY DE PRODUÇÃO — UM DEVICE DE TESTE APONTADO PARA ELA
GRAVARIA CONTAGEM EM PRODUÇÃO.**

Por isso este documento traz **dois templates separados e não intercambiáveis**.
Copiar o template errado para o host errado é o único jeito de errar — não
existe template "genérico".

## Arquitetura

### HOMOLOGAÇÃO — servidor-01

```
DEVICE (tailnet)
  → HTTPS  https://servidor-01.<tailnet>.ts.net/collector
  → Nginx no IP Tailscale do SERVIDOR-01, porta 443
      · termina TLS (certificado Tailscale)
      · SOBRESCREVE X-IndusCost-Tailscale-Peer = $remote_addr
  → http://127.0.0.1:3001        ← HOMOLOGAÇÃO, nunca :3000 aqui
  → IndusCost HOMOLOGAÇÃO (flag ligada só no service de homologação)
```

### PRODUÇÃO — host AWS (futuro, após homologação física aprovada)

```
DEVICE (tailnet)
  → HTTPS  https://<host-aws>.<tailnet>.ts.net/collector
  → Nginx no IP Tailscale do HOST AWS, porta 443
      · termina TLS (certificado Tailscale)
      · SOBRESCREVE X-IndusCost-Tailscale-Peer = $remote_addr
  → http://127.0.0.1:3000        ← produção NO PRÓPRIO host AWS
  → IndusCost PRODUÇÃO
```

O header **nunca autoriza sozinho**: ele apenas informa qual endereço perguntar
ao WhoIs do tailscaled local. Identidade continua sendo
`StableID + Device Registry`, fail-closed.

## Requisitos

- Tailscale ativo no host em questão (`tailscaled` com LocalAPI em
  `/var/run/tailscale/tailscaled.sock`) e MagicDNS habilitado no tailnet.
- HTTPS válido: `tailscale cert` emite certificado para o hostname MagicDNS
  **do host onde o Nginx roda**. Sem Cloudflare no caminho — o Collector é
  superfície privada do tailnet, e um proxy externo destruiria o peer usado
  pelo WhoIs.
- **Não usar `tailscale serve`/`funnel` para o Collector**: eles fazem o proxy
  a partir do próprio tailscaled e o peer visto pela app vira loopback sem o
  header dedicado — a identidade se perde.

## Certificado

```bash
# no host que terminará o TLS (uma vez; renovar conforme validade)
tailscale cert <hostname>.<tailnet>.ts.net
```

## Template A — HOMOLOGAÇÃO (servidor-01) → upstream 127.0.0.1:3001

```nginx
# /etc/nginx/sites-available/induscost-collector-homolog
# HTTPS privado do tailnet para o Stock Collector — HOMOLOGAÇÃO.
# UPSTREAM OBRIGATÓRIO: 127.0.0.1:3001 (homologação local).
# A PORTA 3000 DESTE SERVIDOR É O GATEWAY DE PRODUÇÃO — NÃO USAR AQUI.
server {
    # Escutar SOMENTE no IP Tailscale do servidor-01 — nunca 0.0.0.0.
    listen 100.64.0.10:443 ssl;           # ← IP Tailscale do servidor-01
    server_name servidor-01.SEU-TAILNET.ts.net;

    ssl_certificate     /etc/nginx/tls/servidor-01.SEU-TAILNET.ts.net.crt;
    ssl_certificate_key /etc/nginx/tls/servidor-01.SEU-TAILNET.ts.net.key;

    location / {
        proxy_pass http://127.0.0.1:3001;   # HOMOLOGAÇÃO — nunca :3000 no servidor-01

        # IDENTIDADE DEVICE: sempre SOBRESCREVER o header dedicado com o peer
        # real da conexão TLS. proxy_set_header substitui qualquer valor que o
        # cliente tenha enviado — o cliente nunca escolhe.
        proxy_set_header X-IndusCost-Tailscale-Peer $remote_addr;

        # NÃO usar $proxy_add_x_forwarded_for para identidade: XFF é apenas
        # informativo e a app o ignora por regra.
        proxy_set_header Host $host;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

## Template B — PRODUÇÃO (host AWS) → upstream 127.0.0.1:3000

```nginx
# /etc/nginx/sites-available/induscost-collector-prod
# HTTPS privado do tailnet para o Stock Collector — PRODUÇÃO.
# Este template só faz sentido NO HOST AWS, onde 127.0.0.1:3000 é a própria
# aplicação de produção. Não aplicar antes da homologação física aprovada.
server {
    # Escutar SOMENTE no IP Tailscale do host AWS — nunca 0.0.0.0.
    listen 100.64.0.20:443 ssl;           # ← IP Tailscale do host AWS
    server_name HOST-AWS.SEU-TAILNET.ts.net;

    ssl_certificate     /etc/nginx/tls/HOST-AWS.SEU-TAILNET.ts.net.crt;
    ssl_certificate_key /etc/nginx/tls/HOST-AWS.SEU-TAILNET.ts.net.key;

    location / {
        proxy_pass http://127.0.0.1:3000;   # PRODUÇÃO no próprio host AWS

        # Identidade DEVICE: sobrescrita incondicional, como na homologação.
        proxy_set_header X-IndusCost-Tailscale-Peer $remote_addr;
        proxy_set_header Host $host;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

Checklist comum aos dois templates:
- porta da app continua fechada para fora (firewall/host — não expor);
- `listen` amarrado ao IP Tailscale (o proxy não existe fora do tailnet);
- header dedicado sobrescrito incondicionalmente (`proxy_set_header`);
- nenhum outro vhost pode fazer proxy para o upstream com esse header.

## Feature flag da aplicação — POR AMBIENTE

```
INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY=1
```

- **Default: desligada** em todo lugar → comportamento 2C puro (peer = socket;
  header ignorado; o Collector exige conexão direta do tailnet).
- **HOMOLOGAÇÃO**: habilitar SOMENTE no ambiente/service da homologação
  (`induscost-homolog`), junto com o Template A.
- **PRODUÇÃO**: NÃO habilitar até a homologação física ser aprovada E o
  Template B existir no host AWS. Flag ligada sem o proxy correspondente não
  abre nada (loopback sem header → 403), mas flag e proxy devem nascer juntos.
- Ligada: o header dedicado só é considerado quando `socket.remoteAddress` é
  loopback e o header contém exatamente **um** IP válido. Header
  ausente/malformado/repetido em conexão loopback → 403.
- Conexões diretas do tailnet continuam funcionando com a flag ligada.

## Loopback reconhecido (fail-closed)

O resolvedor aceita como "proxy local confiável" APENAS:

- `127.0.0.1` (e a faixa `127.*` IPv4);
- `::1`;
- `::ffff:127.0.0.1` (IPv4-mapped, como o Node reporta sockets IPv4 em
  listener IPv6).

Nada de faixas privadas (10.x, 192.168.x): proxy em outra máquina NÃO é
confiável. Coberto por testes (`inventoryCollectorSecureIngress.test.ts`).

## Como testar o WhoIs no host

```bash
INVENTORY_COLLECTOR_TAILSCALE_GATE=1 \
node --import ./node_modules/tsx/dist/loader.mjs --test \
  src/lib/inventory/inventoryCollectorTailscaleGate.test.ts
```

## Como validar a câmera

1. No aparelho (tailnet), abrir `https://<hostname>/collector` — cadeado válido.
2. Chrome/Android: câmera abre e o `BarcodeDetector` lê o QR.
3. Prova negativa: abrir via `http://` → a página mostra "Conexão sem HTTPS: o
   navegador bloqueia a câmera" e a entrada manual continua disponível (regra
   de secure context do browser; sem bypass).

## Rollback

1. Remover/desabilitar o vhost Nginx (`nginx -s reload`).
2. Remover `INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY` do ambiente correspondente
   e reiniciar o serviço na janela apropriada → volta ao 2C puro.
3. Nenhuma migração/estado envolvido — a flag só muda a origem do endereço.

## Checklist de homologação física (servidor-01 + Template A)

- [ ] `tailscale cert` emitido; Nginx sobe apenas no IP Tailscale do servidor-01.
- [ ] **Conferir o `proxy_pass`: 127.0.0.1:3001. A porta :3000 do servidor-01 é
      o gateway de produção.**
- [ ] Flag ligada SOMENTE no service de homologação.
- [ ] `curl https://<hostname>/api/inventory/collector/context` de um node NÃO
      cadastrado → 403.
- [ ] Cadastrar o device (`POST /api/inventory/collector-devices`, humano).
- [ ] Do aparelho: contexto retorna o nome do device.
- [ ] Spoof: header dedicado enviado de fora do host não escolhe identidade;
      `X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP` sem efeito (testes
      automatizados cobrem).
- [ ] Câmera abre em HTTPS; QR resolve; contagem grava com actorType DEVICE.
- [ ] Verificar no banco de HOMOLOGAÇÃO (nunca no de produção) a Observation
      criada — prova de que o upstream é o ambiente certo.
- [ ] Desativar o device no registry → 403 imediato.
