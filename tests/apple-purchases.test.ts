import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, type AppleConfig } from '../src/api';
import { ApplePurchases, subscriptionPeriod, type AppleProduct, type AppleServer, type AppleTransaction, type StoreKitBridge } from '../src/apple-purchases';
import { PremiumContent } from '../src/premium';
import { IosLegalLinks } from '../src/legal';

const account = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const config: AppleConfig = { appAccountToken: account, productId: 'cl.cuelga.premium', premium: false, source: 'none' };
const product: AppleProduct = { id: config.productId, displayName: 'Cuelga Premium', displayPrice: '$1.490', periodValue: 1, periodUnit: 'month' };
const transaction: AppleTransaction = { transactionId: '12345', productId: product.id, appAccountToken: account, signedTransaction: 'firmado.por.apple' };

function fixture() {
  const events: string[] = [];
  let callback: ((value: AppleTransaction) => void) | undefined;
  const f = {
    config: { ...config }, state: 'purchased' as 'purchased' | 'cancelled' | 'pending',
    transactions: [transaction], product: { ...product }, rejected: false, active: true,
    server: {} as AppleServer, bridge: {} as StoreKitBridge,
    emit(value = transaction) { callback?.(value); }, events,
  };
  f.server = {
    async appleConfig() { events.push('config'); return f.config; },
    async appleTransaction(signed, restore) {
      events.push(`${restore ? 'restore-server' : 'server'}:${signed}`);
      if (f.rejected) throw new ApiError('APPLE_INVALID_SIGNATURE', 400, 'La firma no es válida.');
      return f.active;
    },
  };
  f.bridge = {
    async products(options) { assert.equal(options.productId, product.id); events.push('product'); return { products: [f.product] }; },
    async purchase(options) { assert.deepEqual(options, { productId: product.id, appAccountToken: account }); events.push('purchase'); return { state: f.state, ...(f.state === 'purchased' ? { transaction: f.transactions[0] } : {}) }; },
    async pending() { events.push('pending'); return { transactions: f.transactions }; },
    async restore() { events.push('restore'); return { transactions: f.transactions }; },
    async finish(options) { events.push(`finish:${options.transactionId}`); },
    async manage() { events.push('manage'); },
    async addListener(_, listener) { callback = listener; return { async remove() { callback = undefined; events.push('remove'); } }; },
  };
  return { ...f, purchases: new ApplePurchases(f.server, f.bridge), fixture: f };
}

test('compra usa el token opaco del servidor y termina sólo después de su confirmación', async () => {
  const f = fixture();
  assert.equal(await f.purchases.purchase(), 'purchased');
  assert.deepEqual(f.events, ['config', 'purchase', 'server:firmado.por.apple', 'finish:12345']);
});

test('Premium por MP o Apple se relee antes de comprar y no abre otra compra', async () => {
  for (const source of ['mp', 'apple'] as const) {
    const f = fixture(); f.fixture.config = { ...config, premium: true, source };
    assert.equal(await f.purchases.purchase(), 'already-premium');
    assert.deepEqual(f.events, ['config']);
  }
});

test('compra cancelada o pendiente no activa acceso ni termina una transacción', async () => {
  for (const state of ['cancelled', 'pending'] as const) {
    const f = fixture(); f.fixture.state = state;
    assert.equal(await f.purchases.purchase(), state);
    assert.deepEqual(f.events, ['config', 'purchase']);
  }
});

test('firma rechazada por servidor nunca se termina ni entrega acceso', async () => {
  const f = fixture(); f.fixture.rejected = true;
  await assert.rejects(f.purchases.purchase(), (error: unknown) => error instanceof ApiError && error.code === 'APPLE_INVALID_SIGNATURE');
  assert.ok(!f.events.some(event => event.startsWith('finish')));
});

test('transacción de otra cuenta o de otro producto no se registra ni se termina', async () => {
  for (const value of [{ ...transaction, appAccountToken: other }, { ...transaction, productId: 'otro.producto' }]) {
    const f = fixture();
    await assert.rejects(f.purchases.accept(value, config), (error: unknown) => error instanceof ApiError && error.code === 'APPLE_NOT_YOURS');
    assert.deepEqual(f.events, []);
  }
});

test('restaurar verifica las compras de la misma cuenta con servidor; otra cuenta no se adjudica', async () => {
  const f = fixture(); f.fixture.transactions = [transaction, { ...transaction, transactionId: '67890', appAccountToken: other }];
  assert.equal(await f.purchases.reconcile(true), 1);
  assert.deepEqual(f.events, ['config', 'restore', 'restore-server:firmado.por.apple', 'finish:12345']);
});

test('una respuesta sin Premium vigente no se interpreta como compra activada', async () => {
  const f = fixture(); f.fixture.active = false;
  await assert.rejects(f.purchases.purchase(), (error: unknown) => error instanceof ApiError && error.code === 'APPLE_NOT_ACTIVE');
});

test('repeticiones simultáneas del mismo recibo sólo se registran y terminan una vez', async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([f.purchases.accept(transaction, config), f.purchases.accept(transaction, config)]), [true, true]);
  assert.deepEqual(f.events, ['server:firmado.por.apple', 'finish:12345']);
});

test('salir mientras el servidor confirma no termina ni revive la compra en otra sesión', async () => {
  const f = fixture();
  let release!: (value: boolean) => void;
  f.fixture.server.appleTransaction = async () => new Promise<boolean>(resolve => { release = resolve; });
  const accepting = f.purchases.accept(transaction, config);
  const rejection = assert.rejects(accepting, (error: unknown) => error instanceof ApiError && error.code === 'SESSION_CHANGED');
  f.purchases.invalidate(); release(true); await rejection;
  assert.ok(!f.events.some(event => event.startsWith('finish')));
});

test('actualizaciones escuchan StoreKit y refrescan sólo después de confirmar', async () => {
  const f = fixture();
  let resolve!: () => void;
  const updated = new Promise<void>(r => { resolve = r; });
  const errors: unknown[] = [];
  const stop = await f.purchases.listen(async () => { f.events.push('updated'); resolve(); }, e => errors.push(e));
  f.fixture.emit(); await updated; stop();
  assert.deepEqual(f.events, ['config', 'server:firmado.por.apple', 'finish:12345', 'updated', 'remove']);
  assert.deepEqual(errors, []);
});

test('sin StoreKit no consulta un precio ni ofrece una compra falsa', async () => {
  const f = fixture(); const web = new ApplePurchases(f.fixture.server, null);
  assert.equal(web.available, false);
  assert.equal(await web.product(config), null);
  assert.equal(await web.reconcile(), 0);
  await assert.rejects(web.purchase(), (error: unknown) => error instanceof ApiError && error.status === 503);
  assert.deepEqual(f.events, []);
});

test('pantalla Premium muestra el precio de StoreKit, período, renovación y acciones; MP vigente no ofrece comprar', () => {
  const props = { available: true, product, busy: false, buy() {}, restore() {}, manage() {}, links: React.createElement(IosLegalLinks) };
  const html = renderToStaticMarkup(React.createElement(PremiumContent, { ...props, premium: false }));
  for (const text of ['$1.490', '1 mes', 'renovación automática', 'Restaurar compras', 'Gestionar suscripción', '#terminos', '#privacidad', 'Suscribirme con Apple']) assert.ok(html.includes(text), text);
  assert.ok(!/mercado.?pago|990|\/planes|checkout/i.test(html));
  const mp = renderToStaticMarkup(React.createElement(PremiumContent, { ...props, premium: true, source: 'mp' }));
  assert.ok(mp.includes('Ya tienes Premium'));
  assert.ok(!mp.includes('Suscribirme'));
  assert.ok(!mp.includes('$1.490'));
  assert.equal(subscriptionPeriod({ ...product, periodValue: 3 }), '3 meses');
});

test('producto sin precio, de otro id o sin período válido deja de ofrecer compra', async () => {
  for (const wrong of [{ ...product, id: 'otro' }, { ...product, displayPrice: '' }, { ...product, periodValue: 0 }]) {
    const f = fixture(); f.fixture.product = wrong;
    await assert.rejects(f.purchases.product(config));
  }
});

test('interruptor apagado conserva 503 y no ofrece una compra ni un precio', async () => {
  const f = fixture();
  f.fixture.server.appleConfig = async () => { throw new ApiError('APPLE_DISABLED', 503, 'Compras no disponibles.'); };
  await assert.rejects(f.purchases.purchase(), (error: unknown) => error instanceof ApiError && error.code === 'APPLE_DISABLED' && error.status === 503);
  assert.deepEqual(f.events, []);
});
