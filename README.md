# Kaya

Diário e painel de cultivo para quem tem autorização legal para cultivar.

Abra em: https://britoisa420.github.io/kaya/

- Funciona no navegador do celular e pode ser instalado na tela inicial.
- Os dados ficam no próprio aparelho (com cópia opcional no Google Drive de cada pessoa).
- Para ativar o login com Google, preencha `GOOGLE_CLIENT_ID` em `index.html`.

O Kaya não substitui orientação médica, jurídica ou agronômica.

## Ligar aparelhos de verdade

- **Tuya / Smart Life, eWeLink (Sonoff) e Shelly**: pela nuvem de cada marca, com a [Kaya Ponte](ponte/LEIA-ME.md) (grátis no Cloudflare).
- **ESP32, Tasmota e ESPHome**: por MQTT, direto do app (ex.: HiveMQ Cloud grátis).
- **Home Assistant**: pela API, com um token de acesso.

Inclui `mqtt.min.js` (MQTT.js 5.16.1, licença MIT).
