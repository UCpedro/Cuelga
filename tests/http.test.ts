import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { localServer } from '../server/app';
import { examples } from '../server/mailbox-local';

test('HTTP real loopback: autenticación, ingreso, duplicado, aislamiento, inválidos y borrado', async t => {
  const server = localServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const session = async () => {
    const r = await fetch(base + '/sessions', { method: 'POST' });
    assert.equal(r.status, 201);
    return (await r.json() as { token: string }).token;
  };
  const alice = await session(), bob = await session();
  const request = (path: string, token?: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await request('/messages')).status, 401);
  const event = { ...examples.risk, eventId: 'provider-001', completedAt: '2026-11-02T12:00:00Z' };
  const created = await request('/messages/completed', alice, 'POST', event);
  assert.equal(created.status, 201);
  const { id } = await created.json() as { id: string };
  assert.equal((await request('/messages/completed', alice, 'POST', event)).status, 200);
  assert.equal((await request('/messages/' + id, bob)).status, 404);
  assert.equal((await request('/messages/' + id, bob, 'DELETE')).status, 404);
  assert.equal((await request('/messages/completed', alice, 'POST', { ...event, ownerId: 'bob' })).status, 400);
  assert.equal((await request('/messages/completed', alice, 'POST', { ...event, transcript: 'x'.repeat(25000) })).status, 413);
  assert.equal((await request('/messages/' + id, alice, 'DELETE')).status, 200);
  assert.deepEqual(await (await request('/messages', alice)).json(), { messages: [] });
  assert.equal((await request('/session', alice, 'DELETE')).status, 200);
  assert.equal((await request('/messages', alice)).status, 401);
  const denied = await fetch(base + '/sessions', { method: 'POST', headers: { Origin: 'https://example.com' } });
  assert.equal(denied.status, 403);
});
