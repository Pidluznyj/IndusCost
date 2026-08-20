# Stock Collector — Ingress HTTPS seguro pelo tailnet (Fase 3A)

> Template de referência. **Nada deste documento é aplicado automaticamente** —
> a instalação no host é uma janela operacional própria, fora do deploy da app.

## Arquitetura

```
DEVICE (tailnet, ex.: 100.64.x.y)
  → HTTPS  https://induscost-collector.<tailnet>.ts.net/collector
  → Nginx local (escuta SOMENTE no IP Tailscale do servidor, porta 443)
      · termina TLS (certificado Tailscale)
      · SOBRESCREVE o header dedicado: X-IndusCost-Tailscale-Peer = $remote_addr
  → IndusCost em loopback (127.0.0.1:3000)
      · flag INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY=1
      · socket loopback + header dedicado → peer real
      · Tailscale LocalAPI WhoIs → StableID
      · Device Registry (active) → contexto DEVICE
```

O header **nunca autoriza sozinho**: ele apenas informa qual endereço perguntar
ao WhoIs. Identidade continua sendo `StableID + Device Registry`, fail-closed.

## Requisitos

- Tailscale ativo no servidor (`tailscaled` com LocalAPI em
  `/var/run/tailscale/tailscaled.sock`) e MagicDNS habilitado no tailnet.
- HTTPS válido: `tailscale cert` emite certificado para o hostname MagicDNS do
  host (ex.: `servidor-01.<tailnet>.ts.net`). Sem Cloudflare no caminho — o
  Collector é superfície privada do tailnet, e um proxy externo destruiria o
  peer usado pelo WhoIs.
- **Não usar `tailscale serve`/`funnel` para o Collector**: eles fazem o proxy
  a partir do próprio tailscaled e o peer visto pela app vira loopback sem o
  header dedicado — a identidade se perde.

## Certificado

```bash
# no servidor (uma vez; renovar conforme validade)
tailscale cert servidor-01.<tailnet>.ts.net
# gera servidor-01.<tailnet>.ts.net.crt / .key no diretório corrente
```

## Template Nginx (referência — ajustar hostname/caminhos)

```nginx
# /etc/nginx/sites-available/induscost-collector
# HTTPS privado do tailnet para o Stock Collector.
server {
    # Escutar SOMENTE no IP Tailscale do host — nunca 0.0.0.0.
    listen 100.64.0.10:443 ssl;           # ← IP Tailscale do servidor
    server_name servidor-01.SEU-TAILNET.ts.net;

    ssl_certificate     /etc/nginx/tls/servidor-01.SEU-TAILNET.ts.net.crt;
    ssl_certificate_key /etc/nginx/tls/servidor-01.SEU-TAILNET.ts.net.key;

    location / {
        proxy_pass http://127.0.0.1:3000;

        # IDENTIDADE DEVICE: sempre SOBRESCREVER o header dedicado com o peer
        # real da conexão TLS. proxy_set_header substitui qualquer valor que o
        # cliente tenha enviado — o cliente nunca escolhe.
        proxy_set_header X-IndusCost-Tailscale-Peer $remote_addr;

        # NÃO usar $proxy_add_x_forwarded_for para identidade: XFF é apenas
        # informativo e a app o ignora por regra.
        proxy_set_header Host $host;

        # WebSocket/HMR se necessário:
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

Checklist do template:
- porta 3000 continua fechada para fora (firewall/host — não expor);
- `listen` amarrado ao IP Tailscale (o proxy não existe fora do tailnet);
- header dedicado sobrescrito incondicionalmente (`proxy_set_header`);
- nenhum outro vhost pode fazer proxy para 127.0.0.1:3000 com esse header.

## Feature flag da aplicação

```
INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY=1
```

- **Default: desligada** → comportamento 2C puro (peer = socket; header
  ignorado; o Collector exige conexão direta do tailnet).
- Ligada: o header dedicado só é considerado quando `socket.remoteAddress` é
  loopback (127.0.0.0/8 ou ::1) e o header contém exatamente **um** IP válido.
  Header ausente/malformado/repetido em conexão loopback → 403.
- Conexões diretas do tailnet continuam funcionando com a flag ligada.

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
2. Remover `INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY` do ambiente e reiniciar o
   serviço na janela apropriada → volta ao 2C puro (peer direto no socket).
3. Nenhuma migração/estado envolvido — a flag só muda a origem do endereço.

## Checklist de homologação física

- [ ] `tailscale cert` emitido; Nginx sobe apenas no IP Tailscale.
- [ ] `curl -k https://<hostname>/api/inventory/collector/context` de um node
      NÃO cadastrado → 403.
- [ ] Cadastrar o device (`POST /api/inventory/collector-devices`, humano).
- [ ] Do aparelho: contexto retorna o nome do device.
- [ ] Spoof: `curl http://127.0.0.1:3000/... -H "X-IndusCost-Tailscale-Peer: <ip-de-device>"`
      **de fora do host** não é possível (porta fechada); do host, sem flag →
      403; com flag, o IP informado ainda precisa passar no WhoIs + Registry.
- [ ] `X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP` em qualquer request →
      sem efeito (testes automatizados cobrem).
- [ ] Câmera abre em HTTPS; QR resolve; contagem grava com actorType DEVICE.
- [ ] Desativar o device no registry → 403 imediato.
