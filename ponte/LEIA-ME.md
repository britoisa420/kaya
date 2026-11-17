# Kaya Ponte

Servidor pequeno e gratuito que liga o Kaya às nuvens **Tuya / Smart Life**, **eWeLink (Sonoff)** e **Shelly**.
Essas nuvens não aceitam chamadas vindas direto de um site, por isso a ponte fica no meio: ela guarda
as suas chaves e só obedece ao Kaya que souber a `KAYA_SENHA`.

ESP32, Tasmota e ESPHome não precisam da ponte: o Kaya fala com eles por MQTT (aba Estufa › Conectar).

## Jeito mais fácil: um clique

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/britoisa420/kaya/tree/main/ponte)

1. Clique no botão acima e entre (ou crie) sua conta Cloudflare grátis.
2. Quando pedir **KAYA_SENHA**, invente uma senha longa. Deixe o resto como está e clique em **Create and deploy**.
3. No fim aparece o endereço, algo como `https://kaya-ponte.SEU-NOME.workers.dev`.
4. No Kaya, em Estufa › Conectar › Kaya Ponte, cole o endereço e a senha e toque em Conectar.
5. Em **Contas das marcas**, cole as chaves da Tuya, Shelly ou eWeLink.

## Jeito manual

### Criar a ponte (Cloudflare Workers, plano grátis)

1. Crie uma conta em https://dash.cloudflare.com e abra **Workers e Pages › Criar › Worker**. Nome: `kaya-ponte`.
2. **Editar código**: apague o exemplo, cole o conteúdo de `worker.js` e clique em **Implantar**.
3. Em **Configurações › Variáveis e segredos**, crie (como *Segredo*):
   - `KAYA_SENHA`: uma senha longa sua.
   - `ORIGEM`: `https://britoisa420.github.io`
4. Configure as marcas que você usa:

| Marca | Variáveis | Onde conseguir |
|---|---|---|
| Tuya / Smart Life | `TUYA_ID`, `TUYA_SECRET`, `TUYA_REGIAO` = `us` | iot.tuya.com › Cloud › Criar projeto (data center *Western America*) › Dispositivos › Vincular conta do app (QR code no Smart Life) |
| Shelly | `SHELLY_SERVIDOR`, `SHELLY_CHAVE` | App Shelly › Configurações do usuário › Chave de autorização na nuvem |
| eWeLink (Sonoff) | `EWELINK_APPID`, `EWELINK_SECRET`, `EWELINK_REGIAO` = `us` e um KV chamado `KAYA` | dev.ewelink.cc › criar app, com URL de retorno `https://kaya-ponte.SEU-NOME.workers.dev/ewelink/retorno`. Depois toque em **Entrar no eWeLink** no Kaya |

5. No Kaya (Estufa › Conectar › Kaya Ponte), cole o endereço `https://kaya-ponte.SEU-NOME.workers.dev` e a senha.

Com o KV `KAYA` ligado, as chaves das marcas podem ser coladas direto no Kaya, em **Contas das marcas**, em vez das variáveis do passo 4.

## Endereços da ponte

- `GET /saude`: quais marcas estão configuradas.
- `GET /aparelhos`: tomadas e sensores de todas as marcas.
- `POST /config` com as chaves das marcas (o app usa esta rota).
- `POST /aparelhos/comando` com `{"id":"tuya:ID:switch_1","ligado":true}`.

Todos pedem o cabeçalho `X-Kaya-Senha`. O plano grátis do Cloudflare permite 100 mil pedidos por dia,
muito mais do que o Kaya usa.
