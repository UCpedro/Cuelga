import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore, memorySessionStorage, SESSION_KEY, type SecureSessionStorage } from '../src/session-store';
import { CuelgaApi } from '../src/api';

const session = { accessToken: 'aaa.bbb.ccc', refreshToken: 'refresh-test', expiresAt: 2000000000 };
function legacyStore(value: string | null) {
  return {
    value, reads: 0, removes: 0,
    async get({ key }: { key: string }) { assert.equal(key, SESSION_KEY); this.reads++; return { value: this.value }; },
    async remove({ key }: { key: string }) { assert.equal(key, SESSION_KEY); this.removes++; this.value = null; },
  };
}

test('migra una vez a Llavero, borra Preferences y posteriores cargas usan sólo Llavero', async () => {
  const legacy = legacyStore(JSON.stringify(session));
  const secure = memorySessionStorage();
  const store = createSessionStore(secure, legacy);
  assert.deepEqual(await store.load(), session);
  assert.equal(legacy.value, null);
  assert.deepEqual(JSON.parse((await secure.get()).value!), session);
  assert.deepEqual(await createSessionStore(secure, legacy).load(), session);
  assert.equal(legacy.reads, 1);
});

test('si guardar en Llavero falla, no borra la sesión antigua ni degrada su almacenamiento', async () => {
  const legacy = legacyStore(JSON.stringify(session));
  const secure = memorySessionStorage();
  const broken: SecureSessionStorage = { ...secure, async set() { throw new Error('llavero bloqueado'); } };
  await assert.rejects(createSessionStore(broken, legacy).load());
  assert.equal(legacy.removes, 0);
  assert.notEqual(legacy.value, null);
  assert.equal((await secure.get()).value, null);
});

test('si Llavero no se puede leer, no usa el token viejo de Preferences', async () => {
  const legacy = legacyStore(JSON.stringify(session));
  const broken = { ...memorySessionStorage(), async get(): Promise<{ value: null }> { throw new Error('bloqueado'); } };
  await assert.rejects(createSessionStore(broken, legacy).load());
  assert.equal(legacy.reads, 0);
});

test('una migración interrumpida después de guardar retoma y limpia Preferences', async () => {
  const legacy = legacyStore(JSON.stringify(session));
  const secure = memorySessionStorage();
  const remove = legacy.remove.bind(legacy);
  legacy.remove = async () => { throw new Error('interrumpido'); };
  await assert.rejects(createSessionStore(secure, legacy).load());
  assert.notEqual((await secure.get()).value, null);
  legacy.remove = remove;
  assert.deepEqual(await createSessionStore(secure, legacy).load(), session);
  assert.equal(legacy.value, null);
});

test('sesión dañada se limpia en ambos almacenes sin exponer el valor', async () => {
  const legacy = legacyStore('contenido privado inválido');
  const secure = memorySessionStorage();
  assert.equal(await createSessionStore(secure, legacy).load(), null);
  assert.equal(legacy.value, null);
  await secure.set({ value: 'inválido' });
  assert.equal(await createSessionStore(secure, legacy).load(), null);
  assert.equal((await secure.get()).value, null);
});

test('migración y salida simultáneas no reviven el token; una nueva entrada usa Llavero', async () => {
  const secure = memorySessionStorage();
  const legacy = legacyStore(JSON.stringify(session));
  const store = createSessionStore(secure, legacy);
  await Promise.all([store.load(), store.clear()]);
  assert.equal(await store.load(), null);
  const api = new CuelgaApi(store, async url => url.endsWith('/sesion/entrar')
    ? Response.json({ ok: true, session }) : Response.json({ ok: true }));
  await api.login('persona@ejemplo.invalid', 'contraseña ficticia');
  assert.equal(legacy.value, null);
  assert.deepEqual(await store.load(), session);
  assert.equal(await api.logout(), true);
  assert.equal(await store.load(), null);
  assert.equal((await secure.get()).value, null);
  assert.equal(legacy.value, null);
});

test('respaldo web sólo vive en memoria y una instancia nueva no restaura tokens', async () => {
  const memory = memorySessionStorage();
  await memory.set({ value: JSON.stringify(session) });
  assert.notEqual((await memory.get()).value, null);
  assert.equal((await memorySessionStorage().get()).value, null);
});

test('salir intenta limpiar Preferences aunque Llavero falle y comunica el error', async () => {
  const legacy = legacyStore(JSON.stringify(session));
  const broken = { ...memorySessionStorage(), async remove() { throw new Error('bloqueado'); } };
  await assert.rejects(createSessionStore(broken, legacy).clear(), /Vuelve a intentar/);
  assert.equal(legacy.value, null);
});
