import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mailbox, parseCompleted, examples, noticeFor } from '../server/mailbox-local';
import { forwardingCode } from '../src/forwarding';

const event = (id = 'callback-1') => ({ ...examples.risk!, completedAt: '2026-11-02T12:00:00Z', eventId: id });

test('D48: sólo un mensaje finalizado genera bandeja, resumen y aviso privado', async () => {
  const box = new Mailbox();
  assert.equal(box.list('alice').length, 0);
  const result = await box.complete('alice', event());
  assert.equal(result.duplicate, false);
  const entry = box.list('alice')[0]!;
  assert.equal(entry.assessment, 'attention');
  assert.equal(entry.source, 'local-test');
  assert.equal(entry.read, false);
  assert.equal(result.notice?.body, 'Tienes un nuevo mensaje en tu buzón.');
  assert.equal(JSON.stringify(result.notice).includes('código'), false);
  assert.equal(JSON.stringify(result.notice).includes('+1555'), false);
});

test('duplicado, incluso concurrente o posterior al borrado, no duplica ni resucita contenido', async () => {
  let calls = 0;
  const box = new Mailbox(async () => { calls++; await new Promise(r => setTimeout(r, 5)); return { assessment: 'unassessed', summary: 'Resumen de prueba.' }; });
  const results = await Promise.all([box.complete('alice', event()), box.complete('alice', event())]);
  assert.equal(calls, 1);
  assert.equal(results.filter(r => r.notice).length, 1);
  const id = results[0]!.id;
  assert.equal(box.list('alice').length, 1);
  assert.equal(box.delete('alice', id), true);
  const repeated = await box.complete('alice', event());
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.notice, undefined);
  assert.equal(box.read('alice', id), undefined);
  assert.deepEqual(box.list('alice'), []);
});

test('otro buzón no puede leer, borrar ni marcar el mensaje', async () => {
  const box = new Mailbox();
  const { id } = await box.complete('alice', event());
  assert.equal(box.read('bob', id), undefined);
  assert.equal(box.delete('bob', id), false);
  assert.deepEqual(box.list('bob'), []);
  assert.equal(box.list('alice')[0]?.read, false);
  assert.equal(box.read('alice', id)?.read, true);
});

test('el contrato rechaza audio, ownerId del cliente y campos inválidos', () => {
  for (const bad of [null, [], { ...event(), ownerId: 'bob' }, { ...event(), audio: 'blob' }, { ...event(), caller: '*21*123#' }, { ...event(), version: 2 }, { ...event(), transcript: 'a'.repeat(4001) }, { ...event(), completedAt: 'ayer' }]) {
    assert.throws(() => parseCompleted(bad));
  }
});

test('modelo falla o responde inválido: conserva mensaje y marca no evaluado, nunca seguro', async () => {
  for (const analyse of [async () => { throw new Error('falla de prueba'); }, async () => ({ summary: '', assessment: 'safe' as never })]) {
    const box = new Mailbox(analyse);
    const { id } = await box.complete('alice', event());
    assert.equal(box.read('alice', id)?.assessment, 'unassessed');
    assert.match(box.read('alice', id)!.summary, /No se pudo analizar/);
  }
});

test('sin mensaje y contenido legítimo no se certifican como seguros', async () => {
  const box = new Mailbox();
  for (const kind of ['empty', 'delivery']) await box.complete('alice', { ...examples[kind], completedAt: '2026-11-02T12:00:00Z', eventId: kind });
  assert.equal(box.list('alice').every(e => e.assessment === 'unassessed'), true);
});

test('desvío se muestra como texto manual, sin activar ni aceptar destinos inválidos', () => {
  assert.equal(forwardingCode('+56255550101'), '**67*+56255550101#');
  for (const bad of ['tel:+56255550101', '+156255550101', '**21*+56255550101#', '+56600123456']) assert.throws(() => forwardingCode(bad));
});

test('límite de cincuenta mensajes también se aplica a entradas simultáneas', async () => {
  const box = new Mailbox(async () => { await new Promise(r => setTimeout(r, 5)); return { assessment: 'unassessed', summary: 'Prueba.' }; });
  const results = await Promise.allSettled(Array.from({ length: 60 }, (_, i) => box.complete('alice', event('event-' + i))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 50);
  assert.equal(box.list('alice').length, 50);
});
