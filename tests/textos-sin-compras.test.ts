import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Plan K (D88): la app va a Apple sin compras. Misma vara que el plan (grep de main.tsx y legal.tsx, sin el código que
// lee plan.premium): ningún texto habla de Premium, suscripción, compra, renovación, restaurar compras ni StoreKit.
test('main.tsx y legal.tsx no tienen textos de compra (vara del Plan K)', () => {
  const vara = /premium|suscrip|compra|renovaci|restaurar compras|storekit/i;
  const permitido = /plan\.premium|PREMIUM_REQUIRED|plan: \{ premium/;
  const quedan = ['src/main.tsx', 'src/legal.tsx'].flatMap(f => readFileSync(f, 'utf8').split(/\r?\n/)
    .map((l, i) => `${f}:${i + 1}: ${l.trim()}`).filter(l => vara.test(l) && !permitido.test(l)));
  assert.deepEqual(quedan, []);
});

test('main.tsx no importa los módulos de compras ni muestra un tope diario', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  assert.doesNotMatch(main, /from '\.\/(premium|apple-purchases)'/);
  assert.doesNotMatch(main, /Te quedan \$\{/);
});
