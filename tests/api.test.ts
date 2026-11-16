import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, CuelgaApi, parseMailbox, parseMessage, parseStatus, parseUtilityStatus, parseReview, type Session, type SessionStore } from '../src/api';

const base = 'https://servidor.invalid/api/movil/v1';
const now = 1_800_000_000_000;
const operation = '123e4567-e89b-42d3-a456-426614174000';
const fresh = (n = 1): Session => ({ accessToken: `aaa.bbb.c${n}`, refreshToken: `refresh-${n}`, expiresAt: now / 1000 + 3600 });

function memoryStore(initial: Session | null = null): SessionStore & { value: Session | null; clears: number } {
  const store = {
    value: initial, clears: 0,
    async load() { return store.value; },
    async save(s: Session) { store.value = s; },
    async clear() { store.value = null; store.clears++; },
  };
  return store;
}

type Call = { url: string; method: string; auth: string | null; body: unknown };
function server(routes: Record<string, (call: Call) => { status: number; body: unknown } | 'network'>) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const call = { url, method: init.method ?? 'GET', auth: headers.get('authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    assert.equal(init.credentials, 'omit');
    const handler = routes[url.slice(base.length)];
    if (!handler) throw new Error(`ruta inesperada ${url}`);
    const result = handler(call);
    if (result === 'network') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetcher };
}

const status = { ok: true, account: { identifier: 'ana', aiConsent: 'not_requested' }, mailbox: { state: 'not_active', forwardingNumber: null } };

test('entrar guarda la sesión y las rutas con cuenta mandan la llave corta', async () => {
  const store = memoryStore();
  const s = server({
    '/sesion/entrar': () => ({ status: 200, body: { ok: true, session: fresh() } }),
    '/estado': () => ({ status: 200, body: status }),
  });
  const api = new CuelgaApi(store, s.fetcher, base, () => now);
  assert.deepEqual(await api.login('ana', 'contraseña-larga'), { pendingDeletion: false });
  assert.deepEqual(store.value, fresh());
  assert.equal((await api.status()).mailbox.state, 'not_active');
  assert.equal(s.calls[0]!.auth, null);
  assert.equal(s.calls[1]!.auth, `Bearer ${fresh().accessToken}`);
});

test('un borrado a medias al entrar lleva a terminar el borrado', async () => {
  const s = server({ '/sesion/entrar': () => ({ status: 200, body: { ok: true, session: fresh(), next: 'delete-account' } }) });
  assert.deepEqual(await new CuelgaApi(memoryStore(), s.fetcher, base, () => now).login('ana', 'x'.repeat(12)), { pendingDeletion: true });
});

test('con un 401 renueva una sola vez y repite el pedido con la llave nueva', async () => {
  const store = memoryStore(fresh(1));
  let first = true;
  const s = server({
    '/buzon': call => {
      if (first) { first = false; return { status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } }; }
      assert.equal(call.auth, `Bearer ${fresh(2).accessToken}`);
      return { status: 200, body: { ok: true, state: 'not_active', messages: [] } };
    },
    '/sesion/renovar': call => { assert.deepEqual(call.body, { refreshToken: 'refresh-1' }); return { status: 200, body: { ok: true, session: fresh(2) } }; },
  });
  assert.deepEqual(await new CuelgaApi(store, s.fetcher, base, () => now).mailbox(), { state: 'not_active', messages: [] });
  assert.deepEqual(store.value, fresh(2));
  assert.equal(s.calls.filter(c => c.url.endsWith('/sesion/renovar')).length, 1);
});

test('renueva antes de pedir si a la llave le queda menos de un minuto, y una sola vez para pedidos simultáneos', async () => {
  const store = memoryStore({ ...fresh(1), expiresAt: now / 1000 + 30 });
  const s = server({
    '/sesion/renovar': () => ({ status: 200, body: { ok: true, session: fresh(2) } }),
    '/estado': () => ({ status: 200, body: status }),
  });
  const api = new CuelgaApi(store, s.fetcher, base, () => now);
  await Promise.all([api.status(), api.status(), api.status()]);
  assert.equal(s.calls.filter(c => c.url.endsWith('/sesion/renovar')).length, 1);
});

test('un 401 que no es AUTH_REQUIRED (contraseña mala al borrar) no renueva ni repite', async () => {
  const store = memoryStore(fresh(1));
  const s = server({
    '/cuenta/borrar': () => ({ status: 401, body: { ok: false, code: 'REAUTH_INVALID', error: 'No pudimos comprobar tu contraseña.' } }),
    '/sesion/renovar': () => ({ status: 200, body: { ok: true, session: fresh(2) } }),
  });
  await assert.rejects(new CuelgaApi(store, s.fetcher, base, () => now).deleteAccount('contraseña-mala-x', operation),
    (e: unknown) => e instanceof ApiError && e.code === 'REAUTH_INVALID');
  assert.equal(s.calls.length, 1);
  assert.deepEqual(store.value, fresh(1));
});

test('si la llave larga se rechaza, se borra la sesión y no se repite', async () => {
  const store = memoryStore(fresh(1));
  const s = server({
    '/estado': () => ({ status: 401, body: { ok: false, code: 'AUTH_REQUIRED', error: 'Entra a tu cuenta para continuar.' } }),
    '/sesion/renovar': () => ({ status: 401, body: { ok: false, code: 'AUTH_REQUIRED', error: 'Entra a tu cuenta para continuar.' } }),
  });
  await assert.rejects(new CuelgaApi(store, s.fetcher, base, () => now).status(), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.equal(store.value, null);
  assert.equal(s.calls.length, 2);
});

test('sin red dice NETWORK y no inventa datos; sin sesión ni siquiera llama', async () => {
  const s = server({ '/buzon': () => 'network' });
  await assert.rejects(new CuelgaApi(memoryStore(fresh()), s.fetcher, base, () => now).mailbox(), (e: unknown) => e instanceof ApiError && e.code === 'NETWORK');
  const none = server({});
  await assert.rejects(new CuelgaApi(memoryStore(), none.fetcher, base, () => now).mailbox(), (e: unknown) => e instanceof ApiError && e.code === 'AUTH_REQUIRED');
  assert.equal(none.calls.length, 0);
});

test('piloto apagado y errores del servidor llegan con su código y su texto', async () => {
  const s = server({ '/estado': () => ({ status: 503, body: { ok: false, code: 'APP_DISABLED', error: 'La aplicación todavía está en preparación.' } }) });
  await assert.rejects(new CuelgaApi(memoryStore(fresh()), s.fetcher, base, () => now).status(),
    (e: unknown) => e instanceof ApiError && e.code === 'APP_DISABLED' && e.message.includes('preparación'));
});

test('salir borra la sesión del iPhone aunque el servidor no conteste', async () => {
  const store = memoryStore(fresh());
  const s = server({ '/sesion/salir': () => 'network' });
  assert.equal(await new CuelgaApi(store, s.fetcher, base, () => now).logout(), false);
  assert.equal(store.value, null);
  const ok = memoryStore(fresh());
  const t = server({ '/sesion/salir': () => ({ status: 200, body: { ok: true } }) });
  assert.equal(await new CuelgaApi(ok, t.fetcher, base, () => now).logout(), true);
  assert.equal(ok.value, null);
});

test('borrar la cuenta manda la confirmación completa y borra la sesión sólo si el servidor confirma', async () => {
  const store = memoryStore(fresh());
  const s = server({ '/cuenta/borrar': call => {
    assert.deepEqual(call.body, { confirmation: true, password: 'contraseña-larga', operationId: operation });
    return { status: 503, body: { ok: false, code: 'ACCOUNT_DELETION_UNCONFIRMED', error: 'No pudimos confirmar.' } };
  } });
  const api = new CuelgaApi(store, s.fetcher, base, () => now);
  await assert.rejects(api.deleteAccount('contraseña-larga', operation));
  assert.notEqual(store.value, null);
});

test('borrado sin respuesta conserva comprobante al reiniciar y lo consulta aun con token vencido', async () => {
  const store = memoryStore(fresh());
  let complete = false;
  const s = server({ '/cuenta/borrar': call => {
    assert.equal((call.body as { operationId: string }).operationId, operation);
    return complete ? { status: 200, body: { ok: true } } : 'network';
  } });
  await assert.rejects(new CuelgaApi(store, s.fetcher, base, () => now).deleteAccount('contraseña-larga', operation));
  assert.equal(store.value?.deletionOperationId, operation);
  complete = true;
  const restarted = new CuelgaApi(store, s.fetcher, base, () => now + 7200000);
  assert.equal(await restarted.hasPendingDeletion(), true);
  await restarted.deleteAccount('contraseña-larga', '22222222-2222-4222-8222-222222222222');
  assert.equal(store.value, null);
  assert.equal(s.calls.length, 2);
  assert.ok(s.calls.every(call => call.url.endsWith('/cuenta/borrar')));
});

test('token vencido de cuenta activa renueva y conserva la operación de borrado', async () => {
  const store = memoryStore({ ...fresh(), expiresAt: now / 1000 - 10 });
  const s = server({
    '/cuenta/borrar': call => call.auth === `Bearer ${fresh().accessToken}`
      ? { status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } }
      : { status: 200, body: { ok: true } },
    '/sesion/renovar': () => ({ status: 200, body: { ok: true, session: fresh(2) } }),
  });
  await new CuelgaApi(store, s.fetcher, base, () => now).deleteAccount('contraseña-larga', operation);
  assert.equal(s.calls.length, 3);
  assert.equal((s.calls[2]!.body as { operationId: string }).operationId, operation);
  assert.equal(store.value, null);
});

test('después del borrado no reutiliza tokens para listar ni renovar', async () => {
  const store = memoryStore(fresh());
  const s = server({ '/cuenta/borrar': () => ({ status: 200, body: { ok: true } }) });
  const api = new CuelgaApi(store, s.fetcher, base, () => now);
  await api.deleteAccount('contraseña-larga', operation);
  await assert.rejects(api.calls(), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
  assert.equal(s.calls.length, 1);
});

test('una renovación en vuelo no revive la sesión después de salir', async () => {
  const store = memoryStore(fresh());
  let finish!: (response: Response) => void;
  let started!: () => void;
  const refreshing = new Promise<void>(resolve => { started = resolve; });
  const api = new CuelgaApi(store, async url => {
    if (url.endsWith('/estado')) return Response.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
    if (url.endsWith('/sesion/renovar')) { started(); return new Promise<Response>(resolve => { finish = resolve; }); }
    return Response.json({ ok: true });
  }, base, () => now);
  const request = api.status();
  const rejected = assert.rejects(request, (error: unknown) => error instanceof ApiError && error.code === 'SESSION_CHANGED');
  await refreshing;
  await api.logout();
  finish(Response.json({ ok: true, session: fresh(2) }));
  await rejected;
  assert.equal(store.value, null);
});

test('recibo incompleto con token vencido conserva comprobante y permite reingresar para terminar', async () => {
  const store = memoryStore({ ...fresh(), expiresAt: now / 1000 - 1, deletionOperationId: operation });
  let reentered = false;
  const s = server({
    '/cuenta/borrar': () => reentered ? { status: 200, body: { ok: true } }
      : { status: 409, body: { ok: false, code: 'DELETION_RECEIPT_MISMATCH' } },
    '/sesion/renovar': () => ({ status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } }),
    '/sesion/entrar': () => { reentered = true; return { status: 200, body: { ok: true, session: fresh(2), next: 'delete-account' } }; },
  });
  const api = new CuelgaApi(store, s.fetcher, base, () => now);
  await assert.rejects(api.deleteAccount('contraseña-larga', operation), (error: unknown) => error instanceof ApiError && error.code === 'DELETION_RECEIPT_MISMATCH');
  assert.equal(store.value?.deletionOperationId, operation);
  await api.logout();
  assert.equal(store.value, null);
  assert.deepEqual(await api.login('ana', 'contraseña-larga'), { pendingDeletion: true });
  await api.deleteAccount('contraseña-larga', '22222222-2222-4222-8222-222222222222');
  assert.equal(store.value, null);
});

test('el permiso de IA tiene que volver con el valor pedido', async () => {
  const s = server({ '/consentimiento-ia': () => ({ status: 200, body: { ok: true, aiConsent: 'accepted' } }) });
  const api = new CuelgaApi(memoryStore(fresh()), s.fetcher, base, () => now);
  assert.equal(await api.setAiConsent(true), 'accepted');
  await assert.rejects(api.setAiConsent(false), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_RESPONSE');
});

test('descarta avisos de un vínculo anterior y respuestas de registro posteriores a salir', async () => {
  const generation='33333333-3333-4333-8333-333333333333';
  const store=memoryStore(fresh());
  let release:(()=>void)|undefined;
  let pause=false;
  const api=new CuelgaApi(store,async(url)=>{
    if(url.endsWith('/aparato')) {
      if(pause) await new Promise<void>(resolve=>{release=resolve;});
      return Response.json({ok:true,registered:true,bindingGeneration:generation});
    }
    return Response.json({ok:true});
  },base,()=>now);
  assert.equal(api.acceptsPush(generation),false);
  await api.registerDevice('a'.repeat(64),'production');
  assert.equal(api.acceptsPush(generation),true);
  assert.equal(api.acceptsPush('old-generation'),false);
  pause=true;
  const pending=api.registerDevice('a'.repeat(64),'production');
  // Da oportunidad a la solicitud de llegar al transporte simulado.
  await new Promise(resolve=>setTimeout(resolve,0));
  await api.logout(); release!();
  assert.equal(await pending,false); assert.equal(api.acceptsPush(generation),false);
});

test('el contrato rechaza "seguro", números raros y campos de más largo', () => {
  const message = { id: '22222222-2222-4222-8222-222222222222', receivedAt: '2026-11-09T15:04:05Z', caller: '+56900000000', assessment: 'attention', summary: 'Pide un código.', transcript: 'Hola.', textStatus: 'ready', read: false };
  assert.equal(parseMessage(message).assessment, 'attention');
  assert.equal(parseMessage({ ...message, assessment: null, summary: null, transcript: null }).summary, null);
  for (const bad of [{ assessment: 'safe' }, { assessment: 'seguro' }, { caller: 'tel:+56900000000' }, { id: '1' }, { receivedAt: 'ayer' }, { summary: 'x'.repeat(2001) }, { read: 'no' }, { textStatus: 'listo' }]) {
    assert.throws(() => parseMessage({ ...message, ...bad }));
  }
  assert.throws(() => parseMailbox({ state: 'activo', messages: [] }));
  assert.throws(() => parseStatus({ ...status, mailbox: { state: 'active', forwardingNumber: 'tel:+56225830699' } }));
  assert.equal(parseStatus({ ...status, mailbox: { state: 'active', forwardingNumber: '+56225830699' } }).mailbox.forwardingNumber, '+56225830699');
});

test('registro abierto manda correo y contraseña sin invitación y guarda la sesión', async () => {
  const store = memoryStore();
  const s = server({ '/sesion/registro': call => {
    assert.deepEqual(call.body, { identifier: 'ana@ejemplo.invalid', password: 'contraseña-larga', notice: true });
    return { status: 201, body: { ok: true, session: fresh() } };
  } });
  await new CuelgaApi(store, s.fetcher, base, () => now).register('ana@ejemplo.invalid', 'contraseña-larga');
  assert.deepEqual(store.value, fresh());
});

const utility = { ...status, account: { identifier: 'ana@ejemplo.invalid', aiConsent: 'accepted' }, plan: { premium: true }, mailbox: { state: 'active', forwardingNumber: '+56225830699' } };
const revision = { ok: true, nivel: 'sin-senales', senales: [], links: [], restantes: 19 };
const message = { id: '22222222-2222-4222-8222-222222222222', receivedAt: '2026-11-13T15:04:05Z', caller: '+56900000000', assessment: null, summary: null, transcript: null, textStatus: 'pending', read: false, durationSeconds: 42 };

test('revisión y reclamo sólo usan rutas móviles con bearer; pendiente se actualiza a resumen', async () => {
  let ready = false;
  const s = server({
    '/llamadas/estado': () => ({ status: 200, body: utility }),
    '/mensajes/revisar': call => { assert.deepEqual(call.body, { texto: 'Nos vemos mañana.' }); return { status: 200, body: revision }; },
    '/llamadas/reclamar': call => { assert.deepEqual(call.body, { caller: '912345678' }); return { status: 202, body: { ok: true, id: message.id, textStatus: 'pending' } }; },
    '/llamadas': () => ({ status: 200, body: { ok: true, state: 'active', messages: [{ ...message, ...(ready ? { textStatus: 'ready', summary: 'Pide un código.', transcript: 'Dime tu código.', assessment: 'attention' } : {}) }] } }),
  });
  const api = new CuelgaApi(memoryStore(fresh()), s.fetcher, base, () => now);
  assert.equal((await api.utilityStatus()).plan.premium, true);
  assert.equal((await api.review('Nos vemos mañana.')).restantes, 19);
  assert.equal(await api.claim('912345678'), message.id);
  assert.equal((await api.calls()).messages[0]!.textStatus, 'pending');
  ready = true;
  assert.equal((await api.calls()).messages[0]!.summary, 'Pide un código.');
  assert.equal((await api.calls()).messages[0]!.durationSeconds, 42);
  assert.ok(s.calls.every(c => c.auth === `Bearer ${fresh().accessToken}`));
});

test('sin sesión no intenta revisar, reclamar ni listar Premium', async () => {
  const s = server({});
  const api = new CuelgaApi(memoryStore(), s.fetcher, base, () => now);
  for (const action of [() => api.review('texto'), () => api.claim('912345678'), () => api.calls(), () => api.utilityStatus()]) {
    await assert.rejects(action(), (e: unknown) => e instanceof ApiError && e.code === 'AUTH_REQUIRED');
  }
  assert.equal(s.calls.length, 0);
});

test('texto vacío, cupo agotado, sin Premium y servicio caído conservan código y reintento explícito', async () => {
  for (const [path, code, http, action] of [
    ['/mensajes/revisar', 'TEXT_EMPTY', 422, (api: CuelgaApi) => api.review('')],
    ['/mensajes/revisar', 'QUOTA_EXCEEDED', 429, (api: CuelgaApi) => api.review('Mensaje de prueba')],
    ['/llamadas/reclamar', 'PREMIUM_REQUIRED', 403, (api: CuelgaApi) => api.claim('912345678')],
    ['/llamadas', 'SERVICE_UNAVAILABLE', 503, (api: CuelgaApi) => api.calls()],
  ] as const) {
    const s = server({ [path]: () => ({ status: http, body: { ok: false, code, retryAfter: 30, error: 'Vuelve a intentar.' } }) });
    await assert.rejects(action(new CuelgaApi(memoryStore(fresh()), s.fetcher, base, () => now)), (e: unknown) => e instanceof ApiError && e.code === code && e.retryAfter === 30);
    assert.equal(s.calls.length, 1);
  }
});

test('revisión sin red falla y permite reintentar; una sesión vencida rechazada se borra', async () => {
  let offline = true;
  const s = server({ '/mensajes/revisar': () => offline ? 'network' : { status: 200, body: revision } });
  const api = new CuelgaApi(memoryStore(fresh()), s.fetcher, base, () => now);
  await assert.rejects(api.review('Nos vemos mañana.'), (e: unknown) => e instanceof ApiError && e.code === 'NETWORK');
  offline = false;
  assert.equal((await api.review('Nos vemos mañana.')).nivel, 'sin-senales');
  const store = memoryStore({ ...fresh(), expiresAt: now / 1000 - 1 });
  const expired = server({ '/sesion/renovar': () => ({ status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } }) });
  await assert.rejects(new CuelgaApi(store, expired.fetcher, base, () => now).review('Nos vemos mañana.'));
  assert.equal(store.value, null);
  assert.equal(expired.calls.length, 1);
});

test('validadores rechazan Premium inventado, resultados vacíos o seguros y duración inválida', () => {
  assert.equal(parseUtilityStatus(utility).plan.premium, true);
  assert.throws(() => parseUtilityStatus({ ...utility, plan: { premium: 'true' } }));
  assert.throws(() => parseUtilityStatus({ ...utility, plan: { premium: false } }));
  assert.throws(() => parseUtilityStatus(status));
  assert.throws(() => parseReview({}));
  assert.throws(() => parseReview({ ...revision, nivel: 'seguro' }));
  assert.throws(() => parseReview({ ...revision, restantes: -1 }));
  assert.throws(() => parseReview({ ...revision, links: [{ texto: 'ejemplo.invalid', resultado: { veredicto: 'seguro' } }] }));
  assert.throws(() => parseMessage({ ...message, durationSeconds: -1 }));
  assert.equal(parseMessage({ ...message, durationSeconds: undefined }).durationSeconds, null);
});
