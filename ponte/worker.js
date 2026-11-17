// Kaya Ponte: servidor gratuito (Cloudflare Workers) que liga o Kaya às nuvens
// Tuya / Smart Life, eWeLink (Sonoff) e Shelly. Veja ponte/LEIA-ME.md.
//
// Variáveis e segredos (Workers › kaya-ponte › Settings › Variables and Secrets):
//   KAYA_SENHA        obrigatória. Uma senha longa sua; o Kaya envia em cada pedido.
//   ORIGEM            opcional. Endereço do app, ex.: https://britoisa420.github.io
//   TUYA_ID, TUYA_SECRET, TUYA_REGIAO (us | eu | cn | in; no Brasil use us)
//   SHELLY_SERVIDOR (ex.: https://shelly-49-eu.shelly.cloud), SHELLY_CHAVE
//   EWELINK_APPID, EWELINK_SECRET, EWELINK_REGIAO (us | eu | as) e um KV ligado com o nome KAYA
//
// Com o KV KAYA ligado, as chaves das marcas também podem ser salvas pelo próprio Kaya
// (Estufa › Conectar › Kaya Ponte › Contas das marcas), sem abrir o painel do Cloudflare.

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const temp = v => { v = num(v); return v === null ? null : (Math.abs(v) > 80 ? v / 10 : v); };
const umid = v => { v = num(v); return v === null ? null : (v > 100 ? v / 10 : v); };

// ---------------- Tuya / Smart Life ----------------
const TUYA_HOST = { us: 'https://openapi.tuyaus.com', eu: 'https://openapi.tuyaeu.com', cn: 'https://openapi.tuyacn.com', in: 'https://openapi.tuyain.com' };
let tuyaTok = null;
export async function tuyaSign(env, method, path, body, at, t, nonce) {
  const str = [method, await sha256(body || ''), '', path].join('\n');
  return hex(await hmac(env.TUYA_SECRET, env.TUYA_ID + (at || '') + t + nonce + str)).toUpperCase();
}
async function tuyaReq(env, method, path, body) {
  const host = TUYA_HOST[env.TUYA_REGIAO || 'us'] || TUYA_HOST.us, isTok = path.startsWith('/v1.0/token');
  if (!isTok && (!tuyaTok || Date.now() > tuyaTok.exp)) {
    const j = await tuyaReq(env, 'GET', '/v1.0/token?grant_type=1');
    if (!j.success) throw new Error('Tuya recusou as chaves: ' + (j.msg || j.code));
    tuyaTok = { t: j.result.access_token, exp: Date.now() + (j.result.expire_time - 120) * 1000 };
  }
  const at = isTok ? '' : tuyaTok.t, t = Date.now().toString(), nonce = crypto.randomUUID(), b = body ? JSON.stringify(body) : '';
  const h = { client_id: env.TUYA_ID, sign: await tuyaSign(env, method, path, b, at, t, nonce), t, nonce, sign_method: 'HMAC-SHA256', 'Content-Type': 'application/json' };
  if (at) h.access_token = at;
  const r = await fetch(host + path, { method, headers: h, body: b || undefined });
  const j = await r.json();
  if (!isTok && j.code === 1010) { tuyaTok = null; } // token expirado
  return j;
}
async function tuyaList(env) {
  const out = [];
  let last = '';
  for (let pg = 0; pg < 5; pg++) {
    const j = await tuyaReq(env, 'GET', '/v1.0/iot-01/associated-users/devices?' + (last ? 'last_row_key=' + encodeURIComponent(last) + '&' : '') + 'size=100');
    if (!j.success) throw new Error('Tuya: ' + (j.msg || j.code));
    const r = j.result || {};
    for (const d of r.devices || []) {
      const st = Object.fromEntries((d.status || []).map(s => [s.code, s.value]));
      const sw = Object.keys(st).filter(c => /^(switch|switch_\d+|switch_led|switch_usb\d*)$/.test(c) && typeof st[c] === 'boolean');
      sw.forEach(c => out.push({ id: 'tuya:' + d.id + ':' + c, nome: d.name + (sw.length > 1 ? ' · ' + c.replace('switch_', 'tomada ').replace('switch', 'tomada') : ''), marca: 'Tuya', online: !!d.online, tipo: 'tomada', ligado: !!st[c] }));
      const t = st.va_temperature ?? st.temp_current ?? st.temperature, u = st.va_humidity ?? st.humidity_value ?? st.humidity;
      if (t !== undefined || u !== undefined) out.push({ id: 'tuya:' + d.id + ':sensor', nome: d.name, marca: 'Tuya', online: !!d.online, tipo: 'sensor', temp: temp(t), umid: umid(u) });
    }
    if (!r.has_more || !r.last_row_key) break;
    last = r.last_row_key;
  }
  return out;
}
async function tuyaCmd(env, id, code, on) {
  const j = await tuyaReq(env, 'POST', '/v1.0/iot-03/devices/' + id + '/commands', { commands: [{ code, value: !!on }] });
  if (!j.success) throw new Error('Tuya: ' + (j.msg || j.code));
}

// ---------------- Shelly Cloud ----------------
async function shellyReq(env, path, form) {
  const body = new URLSearchParams(Object.assign({ auth_key: env.SHELLY_CHAVE }, form || {}));
  const r = await fetch(env.SHELLY_SERVIDOR.replace(/\/+$/, '') + path, { method: 'POST', body });
  const j = await r.json();
  if (!j.isok) throw new Error('Shelly: ' + JSON.stringify(j.errors || 'falhou'));
  return j.data;
}
async function shellyList(env) {
  const data = await shellyReq(env, '/device/all_status'), out = [];
  for (const [id, s] of Object.entries(data.devices_status || {})) {
    const online = s.cloud ? !!s.cloud.connected : true;
    (s.relays || []).forEach((r, i) => out.push({ id: 'shelly:' + id + ':' + i, nome: 'Shelly ' + id + (s.relays.length > 1 ? ' · canal ' + (i + 1) : ''), marca: 'Shelly', online, tipo: 'tomada', ligado: !!r.ison }));
    Object.keys(s).filter(k => /^switch:\d+$/.test(k)).forEach(k => out.push({ id: 'shelly:' + id + ':' + k.split(':')[1], nome: 'Shelly ' + id + ' · ' + k, marca: 'Shelly', online, tipo: 'tomada', ligado: !!s[k].output }));
    const t = s.tmp ? s.tmp.tC ?? s.tmp.value : s['temperature:0'] ? s['temperature:0'].tC : undefined;
    const u = s.hum ? s.hum.value : s['humidity:0'] ? s['humidity:0'].rh : undefined;
    if (t !== undefined || u !== undefined) out.push({ id: 'shelly:' + id + ':sensor', nome: 'Shelly ' + id, marca: 'Shelly', online, tipo: 'sensor', temp: num(t), umid: num(u) });
  }
  return out;
}
const shellyCmd = (env, id, ch, on) => shellyReq(env, '/device/relay/control', { id, channel: String(ch), turn: on ? 'on' : 'off' });

// ---------------- eWeLink (Sonoff) ----------------
const EW = r => 'https://' + (r || 'us') + '-apia.coolkit.cc';
async function ewSave(env, v) { if (!env.KAYA) throw new Error('Ligue um KV chamado KAYA na ponte para usar o eWeLink.'); await env.KAYA.put('ewelink', JSON.stringify(v)); }
async function ewLoad(env) { if (!env.KAYA) return null; const v = await env.KAYA.get('ewelink'); return v ? JSON.parse(v) : null; }
async function ewSigned(env, url, obj) {
  const body = JSON.stringify(obj);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CK-Appid': env.EWELINK_APPID, 'X-CK-Nonce': Math.random().toString(36).slice(2, 10), Authorization: 'Sign ' + b64(await hmac(env.EWELINK_SECRET, body)) }, body });
  return r.json();
}
async function ewToken(env) {
  let s = await ewLoad(env);
  if (!s) throw new Error('Entre na conta eWeLink pelo botão do Kaya.');
  if (Date.now() > s.atExp - 3600e3) {
    const r = await fetch(EW(s.region) + '/v2/user/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CK-Appid': env.EWELINK_APPID, Authorization: 'Bearer ' + s.at }, body: JSON.stringify({ rt: s.rt }) });
    const j = await r.json();
    if (j.error) throw new Error('eWeLink pediu novo login: ' + (j.msg || j.error));
    s = Object.assign(s, { at: j.data.at, rt: j.data.rt, atExp: Date.now() + 25 * 86400e3 });
    await ewSave(env, s);
  }
  return s;
}
async function ewReq(env, method, path, body) {
  const s = await ewToken(env);
  const r = await fetch(EW(s.region) + path, { method, headers: { 'Content-Type': 'application/json', 'X-CK-Appid': env.EWELINK_APPID, Authorization: 'Bearer ' + s.at }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.error) throw new Error('eWeLink: ' + (j.msg || j.error));
  return j.data;
}
async function ewList(env) {
  const d = await ewReq(env, 'GET', '/v2/device/thing?num=0'), out = [];
  for (const it of d.thingList || []) {
    const x = it.itemData || {}, p = x.params || {};
    if (Array.isArray(p.switches)) p.switches.slice(0, 4).forEach(s => out.push({ id: 'ewelink:' + x.deviceid + ':' + s.outlet, nome: x.name + ' · tomada ' + (s.outlet + 1), marca: 'eWeLink', online: !!x.online, tipo: 'tomada', ligado: s.switch === 'on' }));
    else if (p.switch) out.push({ id: 'ewelink:' + x.deviceid + ':x', nome: x.name, marca: 'eWeLink', online: !!x.online, tipo: 'tomada', ligado: p.switch === 'on' });
    if (p.currentTemperature !== undefined || p.currentHumidity !== undefined) out.push({ id: 'ewelink:' + x.deviceid + ':sensor', nome: x.name, marca: 'eWeLink', online: !!x.online, tipo: 'sensor', temp: num(p.currentTemperature), umid: num(p.currentHumidity) });
  }
  return out;
}
const ewCmd = (env, id, ch, on) => ewReq(env, 'POST', '/v2/device/thing/status', { type: 1, id, params: ch === 'x' ? { switch: on ? 'on' : 'off' } : { switches: [{ outlet: +ch, switch: on ? 'on' : 'off' }] } });

// ---------------- configuração (variáveis + chaves salvas pelo app no KV) ----------------
const CAMPOS = { tuya: { id: 'TUYA_ID', secret: 'TUYA_SECRET', regiao: 'TUYA_REGIAO' }, shelly: { servidor: 'SHELLY_SERVIDOR', chave: 'SHELLY_CHAVE' }, ewelink: { appid: 'EWELINK_APPID', secret: 'EWELINK_SECRET', regiao: 'EWELINK_REGIAO' } };
async function lerCfg(env) {
  let kv = {};
  if (env.KAYA) { try { kv = JSON.parse((await env.KAYA.get('config')) || '{}'); } catch (e) { kv = {}; } }
  const c = Object.assign({}, env);
  for (const [m, f] of Object.entries(CAMPOS)) for (const [k, v] of Object.entries(f)) if (kv[m] && kv[m][k]) c[v] = kv[m][k];
  return c;
}
async function salvarCfg(env, body) {
  if (!env.KAYA) throw new Error('Ligue um KV chamado KAYA na ponte para salvar as chaves pelo app.');
  let kv = {};
  try { kv = JSON.parse((await env.KAYA.get('config')) || '{}'); } catch (e) { kv = {}; }
  for (const [m, f] of Object.entries(CAMPOS)) {
    if (!body[m]) continue;
    kv[m] = kv[m] || {};
    for (const k of Object.keys(f)) if (body[m][k] !== undefined) { const v = String(body[m][k]).trim(); if (v) kv[m][k] = v; else delete kv[m][k]; }
  }
  if (body.limpar && CAMPOS[body.limpar]) delete kv[body.limpar];
  await env.KAYA.put('config', JSON.stringify(kv));
  if (body.tuya) tuyaTok = null;
}

// ---------------- servidor ----------------
const marcas = env => ({ tuya: !!(env.TUYA_ID && env.TUYA_SECRET), shelly: !!(env.SHELLY_SERVIDOR && env.SHELLY_CHAVE), ewelink: !!(env.EWELINK_APPID && env.EWELINK_SECRET) });
function cors(env) { return { 'Access-Control-Allow-Origin': env.ORIGEM || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Kaya-Senha', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }; }
const json = (env, obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(env)) });
const page = (msg) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:18px system-ui;background:#0b120d;color:#eef6ea;padding:24px">' + msg + '</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export default {
  async fetch(req, rawEnv) {
    const env = await lerCfg(rawEnv);
    const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (!env.KAYA_SENHA) return json(env, { erro: 'Defina a variável KAYA_SENHA na ponte.' }, 500);

    // Login do eWeLink (OAuth). Aberto pelo botão do Kaya, com a senha na URL.
    if (p === '/ewelink/entrar') {
      if (url.searchParams.get('senha') !== env.KAYA_SENHA) return page('Senha da ponte incorreta.');
      if (!marcas(env).ewelink) return page('Configure EWELINK_APPID e EWELINK_SECRET na ponte.');
      const seq = Date.now().toString(), ret = url.origin + '/ewelink/retorno';
      const q = new URLSearchParams({ clientId: env.EWELINK_APPID, seq, authorization: b64(await hmac(env.EWELINK_SECRET, env.EWELINK_APPID + '_' + seq)), redirectUrl: ret, nonce: Math.random().toString(36).slice(2, 10), grantType: 'authorization_code', state: 'kaya', showQRCode: 'false' });
      return Response.redirect('https://c2ccdn.coolkit.cc/oauth/index.html?' + q, 302);
    }
    if (p === '/ewelink/retorno') {
      const code = url.searchParams.get('code'), region = url.searchParams.get('region') || env.EWELINK_REGIAO || 'us';
      if (!code) return page('O eWeLink não devolveu o código de acesso.');
      const j = await ewSigned(env, EW(region) + '/v2/user/oauth/token', { code, redirectUrl: url.origin + '/ewelink/retorno', grantType: 'authorization_code' });
      if (j.error) return page('O eWeLink recusou: ' + (j.msg || j.error));
      await ewSave(env, { region, at: j.data.accessToken, rt: j.data.refreshToken, atExp: +j.data.atExpiredTime || Date.now() + 25 * 86400e3 });
      return page('Pronto! A conta eWeLink está ligada ao Kaya. Pode fechar esta página.');
    }

    if (req.headers.get('X-Kaya-Senha') !== env.KAYA_SENHA) return json(env, { erro: 'senha da ponte incorreta' }, 401);
    try {
      if (p === '/saude') {
        const m = marcas(env);
        return json(env, { ok: true, versao: 2, kv: !!rawEnv.KAYA, marcas: { tuya: m.tuya, shelly: m.shelly, ewelink: m.ewelink ? ((await ewLoad(env)) ? 'conectado' : 'falta entrar') : false } });
      }
      if (p === '/config' && req.method === 'POST') {
        await salvarCfg(rawEnv, await req.json());
        const m = marcas(await lerCfg(rawEnv));
        return json(env, { ok: true, marcas: m });
      }
      if (p === '/aparelhos' && req.method === 'GET') {
        const m = marcas(env), out = [], erros = {};
        const jobs = [['tuya', m.tuya && tuyaList], ['shelly', m.shelly && shellyList], ['ewelink', m.ewelink && ewList]].filter(x => x[1]);
        await Promise.all(jobs.map(async ([k, fn]) => { try { out.push(...await fn(env)); } catch (e) { erros[k] = e.message; } }));
        return json(env, { aparelhos: out, erros, em: new Date().toISOString() });
      }
      if (p === '/aparelhos/comando' && req.method === 'POST') {
        const b = await req.json(), [marca, id, ch] = String(b.id || '').split(':');
        if (!marca || !id || ch === undefined || ch === 'sensor') return json(env, { erro: 'aparelho inválido' }, 400);
        if (marca === 'tuya') await tuyaCmd(env, id, ch, b.ligado);
        else if (marca === 'shelly') await shellyCmd(env, id, ch, b.ligado);
        else if (marca === 'ewelink') await ewCmd(env, id, ch, b.ligado);
        else return json(env, { erro: 'marca desconhecida' }, 400);
        return json(env, { ok: true });
      }
      return json(env, { erro: 'caminho desconhecido' }, 404);
    } catch (e) {
      return json(env, { erro: e.message }, 502);
    }
  }
};
