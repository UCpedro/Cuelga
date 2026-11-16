import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalIngress, type Delivery, type Binding } from '../server/ingress';
import { Mailbox } from '../server/mailbox-local';

const delivery = (extra = {}): Delivery => ({ integrationId: 'fixture', eventId: 'evt-1',
  destination: '+15550000100', forwardedLine: '+15550000201', caller: '+15550000301',
  completedAt: '2026-11-02T12:00:00Z', transcript: 'Mensaje ficticio: coordinar entrega.', ...extra });
const bindings: Binding[] = [
  { integrationId: 'fixture', destination: '+15550000100', line: '+15550000201', owner: 'alice', mode: 'shared' },
  { integrationId: 'fixture', destination: '+15550000100', line: '+15550000202', owner: 'bob', mode: 'shared' },
];
const request = { body: new Uint8Array([1]), headers: {} };

test('sin verificador o con firma inválida no se acepta ni guarda un evento', async () => {
  const box = new Mailbox();
  assert.equal((await createLocalIngress(box, bindings)(request)).status, 'rejected');
  assert.equal((await createLocalIngress(box, bindings, async () => null)(request)).status, 'rejected');
  assert.deepEqual(box.list('alice'), []);
});

test('veinte callbacks ficticios llegan sólo a su buzón con aviso genérico', async () => {
  const box = new Mailbox();
  const results = [];
  for (let n = 0; n < 20; n++) {
    const owner = n < 10 ? 'alice' : 'bob';
    const evt = delivery({ eventId: 'technical-' + n, forwardedLine: owner === 'alice' ? '+15550000201' : '+15550000202' });
    const result = await createLocalIngress(box, bindings, async () => evt)(request);
    assert.equal(result.status, 'accepted');
    assert.equal(result.notice?.body, 'Tienes un nuevo mensaje en tu buzón.');
    assert.equal(JSON.stringify(result.notice).includes('+1555'), false);
    assert.equal(box.read(owner === 'alice' ? 'bob' : 'alice', result.id), undefined);
    results.push(result);
  }
  assert.equal(results.length, 20);
  assert.equal(box.list('alice').length, 10);
  assert.equal(box.list('bob').length, 10);
});

test('número compartido exige destinatario exacto y rechaza ambigüedad sin guardar', async () => {
  const box = new Mailbox();
  for (const evt of [delivery({ forwardedLine: null }), delivery({ forwardedLine: '+15550000999' }),
    delivery({ destination: '+15550000999' }), delivery({ integrationId: 'otra' })]) {
    assert.deepEqual(await createLocalIngress(box, bindings, async () => evt)(request), { status: 'rejected', reason: 'unresolved' });
  }
  const ambiguous = [...bindings, { ...bindings[0]!, owner: 'mallory' }];
  assert.equal((await createLocalIngress(box, ambiguous, async () => delivery())(request)).status, 'rejected');
  assert.deepEqual(box.list('alice'), []);
  assert.deepEqual(box.list('bob'), []);
});

test('número dedicado permite destino único sin elegir por llamante y rechaza conflictos', async () => {
  const box = new Mailbox();
  const dedicated: Binding[] = [{ ...bindings[0]!, mode: 'dedicated' }];
  const direct = delivery({ forwardedLine: null, caller: '+15550000202' });
  assert.equal((await createLocalIngress(box, dedicated, async () => direct)(request)).status, 'accepted');
  assert.equal(box.list('alice').length, 1);
  assert.deepEqual(box.list('bob'), []);
  assert.equal((await createLocalIngress(box, dedicated, async () => delivery({ forwardedLine: '+15550000202' }))(request)).status, 'rejected');
  assert.equal((await createLocalIngress(box, [...dedicated, bindings[1]!], async () => delivery())(request)).status, 'rejected');
});

test('duplicado concurrente o borrado no repite aviso ni resucita contenido', async () => {
  const box = new Mailbox();
  const ingest = createLocalIngress(box, bindings, async () => delivery());
  const result = await Promise.all([ingest(request), ingest(request)]);
  assert.equal(result.filter(r => r.status === 'accepted').length, 1);
  assert.equal(result.filter(r => r.status === 'duplicate').length, 1);
  const accepted = result.find(r => r.status === 'accepted')!;
  if (accepted.status === 'rejected') throw new Error('rejected');
  box.delete('alice', accepted.id);
  const repeated = await ingest(request);
  assert.equal(repeated.status, 'duplicate');
  assert.equal('notice' in repeated, false);
  assert.deepEqual(box.list('alice'), []);
});

test('dos integraciones con el mismo ID de proveedor no colisionan', async () => {
  const box = new Mailbox();
  const config = [bindings[0]!, { ...bindings[0]!, integrationId: 'segunda' }];
  for (const integrationId of ['fixture', 'segunda']) {
    assert.equal((await createLocalIngress(box, config, async () => delivery({ integrationId }))(request)).status, 'accepted');
  }
  assert.equal(box.list('alice').length, 2);
});

test('campos de cliente, audio, errores y cuerpos grandes se rechazan sin contenido privado', async () => {
  const box = new Mailbox();
  for (const evt of [delivery({ owner: 'bob' }), delivery({ audio: 'privado' }), delivery({ transcript: 'x'.repeat(4001) }),
    delivery({ caller: '123' }), delivery({ completedAt: 'ayer' }), null]) {
    const result = await createLocalIngress(box, bindings, async () => evt)(request);
    assert.equal(result.status, 'rejected');
    assert.equal(JSON.stringify(result).includes('privado'), false);
  }
  assert.deepEqual(await createLocalIngress(box, bindings, async () => { throw new Error('privado'); })(request), { status: 'rejected', reason: 'unverified' });
  assert.deepEqual(await createLocalIngress(box, bindings, async () => delivery())({ ...request, body: new Uint8Array(24001) }), { status: 'rejected', reason: 'invalid' });
  assert.deepEqual(box.list('alice'), []);
});

test('fallo de análisis conserva texto y nunca declara mensaje seguro', async () => {
  const box = new Mailbox(async () => { throw new Error('fallo sintético'); });
  const result = await createLocalIngress(box, bindings, async () => delivery())(request);
  assert.equal(result.status, 'accepted');
  assert.equal(box.list('alice')[0]?.assessment, 'unassessed');
  assert.equal(box.list('alice')[0]?.transcript, 'Mensaje ficticio: coordinar entrega.');
});

test('cambiar configuración externa después no reasigna destinatario', async () => {
  const box = new Mailbox();
  const config = [{ ...bindings[0]! }];
  const ingest = createLocalIngress(box, config, async () => delivery());
  config[0]!.owner = 'mallory';
  assert.equal((await ingest(request)).status, 'accepted');
  assert.equal(box.list('alice').length, 1);
  assert.deepEqual(box.list('mallory'), []);
});
