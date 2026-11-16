import { test, expect, type Page } from '@playwright/test';

// Servidor simulado en el navegador: la app de verdad, sin red ni cuentas reales.
// Misma dirección que el servidor de Vite (playwright.config.ts), así el navegador no hace preflight.
const api = 'http://127.0.0.1:5178/api/movil/v1';
const session = { accessToken: 'aaa.bbb.ccc', refreshToken: 'refresh-1', expiresAt: Math.floor(Date.now() / 1000) + 3600 };

test('privacidad, términos y soporte son visibles antes del registro y en Tus datos', async ({ page }) => {
  await mockServer(page, { consent: 'declined' });
  await page.goto('/');
  const links = async () => {
    for (const [label, path] of [['Privacidad', 'privacidad'], ['Términos', 'terminos'], ['Soporte', 'soporte']]) {
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', `https://cuelga-prototipo.vercel.app/${path}`);
    }
  };
  await links();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await links();
  await page.getByLabel('Correo', { exact: true }).fill('ana@ejemplo.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-larga');
  await page.getByLabel('Leí y acepto el aviso de datos.').check();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByRole('button', { name: 'Tus datos', exact: true }).click();
  await links();
  expect(await page.evaluate(() => localStorage.getItem('CapacitorStorage.cuelga.sesion.v1'))).toBeNull();
});

test('borrado: contraseña mala conserva cuenta; sin red ofrece reintento y éxito aclara audio externo', async ({ page }) => {
  await mockServer(page, { consent: 'declined' });
  let attempts = 0;
  let operation: string | undefined;
  await page.route(`${api}/cuenta/borrar`, async route => {
    const body = route.request().postDataJSON();
    expect(body.confirmation).toBe(true);
    if (attempts++ === 0) return route.fulfill({ status: 401, json: { ok: false, code: 'REAUTH_INVALID', error: 'No pudimos comprobar tu contraseña.' } });
    if (attempts === 2) { operation = body.operationId; return route.abort('internetdisconnected'); }
    expect(body.operationId).toBe(operation);
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByLabel('Correo', { exact: true }).fill('ana@ejemplo.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-larga');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Tus datos', exact: true }).click();
  await page.getByLabel('Escribe tu contraseña para confirmar').fill('contraseña-mala');
  await page.getByRole('button', { name: 'Borrar mi cuenta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No pudimos comprobar tu contraseña.');
  await expect(page.getByRole('heading', { name: 'Tus datos', exact: true })).toBeVisible();
  await page.getByLabel('Escribe tu contraseña para confirmar').fill('contraseña-larga');
  await page.getByRole('button', { name: 'Borrar mi cuenta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar borrado' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar borrado' }).click();
  await expect(page.getByRole('status')).toContainText('Se borraron tu cuenta y tus mensajes guardados en Cuelga.');
  await expect(page.getByRole('status')).toContainText('Esto no confirma el borrado del audio');
  await expect(page.getByRole('heading', { name: 'Antes de devolver la llamada.' })).toBeVisible();
});

async function mockServer(page: Page, opts: { consent?: string; offline?: boolean; premium?: boolean; reviewCode?: string; expired?: boolean; failPoll?: boolean } = {}) {
  let consent = opts.consent ?? 'not_requested';
  let claimed = false;
  let callsAfterClaim = 0;
  const seen: string[] = [];
  await page.route(`${api}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/movil/v1', '');
    seen.push(`${route.request().method()} ${path}`);
    if (opts.offline) return route.abort('internetdisconnected');
    // CORS abierto sólo en este mock; el CORS real se prueba en src/lib/cuelga/mobile.test.ts.
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
      headers: { 'Access-Control-Allow-Origin': '*' } });
    if (opts.expired) return json(401, { ok: false, code: 'AUTH_REQUIRED', error: 'Entra a tu cuenta para continuar.' });
    if (!['/sesion/entrar', '/sesion/registro'].includes(path) && route.request().headers().authorization !== `Bearer ${session.accessToken}`) return json(401, { ok: false, code: 'AUTH_REQUIRED', error: 'Entra a tu cuenta para continuar.' });
    switch (path) {
      case '/sesion/entrar': return json(200, { ok: true, session });
      case '/sesion/registro': expect(route.request().postDataJSON()).not.toHaveProperty('invitation'); return json(201, { ok: true, session });
      case '/llamadas/estado': return json(200, { ok: true, account: { identifier: 'ana@ejemplo.invalid', aiConsent: consent }, plan: { premium: opts.premium === true }, mailbox: { state: opts.premium ? 'active' : 'not_active', forwardingNumber: opts.premium ? '+56225830699' : null } });
      case '/consentimiento-ia': consent = route.request().postDataJSON().accepted ? 'accepted' : 'declined'; return json(200, { ok: true, aiConsent: consent });
      case '/llamadas': {
        const ready = claimed && callsAfterClaim++ > 0;
        if (opts.failPoll && callsAfterClaim === 2) { opts.failPoll = false; return json(503, { ok: false, code: 'SERVICE_UNAVAILABLE', error: 'El servicio no está disponible ahora.' }); }
        return json(200, { ok: true, state: 'active', messages: claimed ? [{ id: '22222222-2222-4222-8222-222222222222', receivedAt: '2026-11-13T15:00:00Z', caller: '+56912345678', read: false, durationSeconds: 42,
          textStatus: ready ? 'ready' : 'pending', assessment: ready ? 'attention' : null, summary: ready ? 'Pide un código.' : null, transcript: ready ? 'Dime tu código.' : null }] : [] });
      }
      case '/llamadas/reclamar': claimed = true; return json(202, { ok: true, id: '22222222-2222-4222-8222-222222222222', textStatus: 'pending' });
      case '/mensajes/revisar':
        if (opts.reviewCode) { const code = opts.reviewCode; opts.reviewCode = undefined; return json(code === 'QUOTA_EXCEEDED' ? 429 : 503, { ok: false, code, error: code === 'QUOTA_EXCEEDED' ? 'Usaste tus 20 revisiones de hoy.' : 'El servicio no está disponible ahora.' }); }
        return json(200, { ok: true, nivel: 'precaucion', senales: [{ id: 'codigo', titulo: 'Te piden un código', explicacion: 'No compartas códigos.', fuerza: 'media' }], fragmentos: [], links: [], restantes: 19 });
      case '/sesion/salir': return json(200, { ok: true });
      default: return json(404, { ok: false, code: 'NOT_FOUND' });
    }
  });
  return seen;
}

test('recibo no recuperable permite reingresar y otra cuenta recibe una operación nueva', async ({ page }) => {
  await mockServer(page, { consent: 'declined' });
  const operations: string[] = [];
  await page.route(`${api}/cuenta/borrar`, async route => {
    operations.push(route.request().postDataJSON().operationId);
    return route.fulfill({ status: 409, json: { ok: false, code: 'DELETION_RECEIPT_MISMATCH' } });
  });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  const enter = async (email: string) => {
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByLabel('Correo', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-larga');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('button', { name: 'Tus datos', exact: true }).click();
    await page.getByLabel('Escribe tu contraseña para confirmar').fill('contraseña-larga');
    await page.getByRole('button', { name: 'Borrar mi cuenta', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Esto no confirma que la cuenta se haya borrado.');
  };
  await enter('ana@ejemplo.invalid');
  await page.getByRole('button', { name: 'Salir y volver a entrar', exact: true }).click();
  await enter('bea@ejemplo.invalid');
  expect(operations).toHaveLength(2);
  expect(operations[0]).not.toBe(operations[1]);
});

test('entrar con correo, rechazar IA, revisar disponible sin Premium y salir', async ({ page }) => {
  const seen = await mockServer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByLabel('Correo', { exact: true }).fill('ana@ejemplo.invalid');
  await page.getByLabel('Contraseña').fill('contraseña-larga');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Antes de empezar' })).toBeVisible();
  await expect(page.getByText('Zadarma', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Anthropic (Claude)', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'No, sólo avisarme' }).click();
  await expect(page.getByRole('heading', { name: 'Revisar mensaje o link' })).toBeVisible();
  await page.getByRole('button', { name: 'Llamadas', exact: true }).click();
  await expect(page.getByText('es parte de Premium', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reclamar llamada', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Desvío', exact: true }).click();
  await expect(page.getByText('El código de desvío está disponible con Premium.', { exact: false })).toBeVisible();
  await expect(page.locator('code.manual-code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tus datos', exact: true }).click();
  await expect(page.getByText('Con tu permiso, Zadarma', { exact: false })).toBeVisible();
  await expect(page.getByText('No aceptaste', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Salir de la cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Antes de devolver la llamada.' })).toBeVisible();
  expect(seen).toContain('POST /consentimiento-ia');
  expect(seen).toContain('POST /sesion/salir');
});

test('registro sin invitación → vacío → revisión prudente; no guarda texto pegado', async ({ page }) => {
  await mockServer(page, { consent: 'declined' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.getByLabel('Código de invitación')).toHaveCount(0);
  await page.getByLabel('Correo', { exact: true }).fill('ana@ejemplo.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-larga');
  await page.getByLabel('Leí y acepto el aviso de datos.').check();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar', exact: true }).first().click();
  await expect(page.getByRole('status').last()).toContainText('Pega el mensaje');
  await page.getByLabel('Mensaje o link', { exact: true }).fill('No compartas el código de Banco Ejemplo.');
  await page.getByRole('button', { name: 'Revisar', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Revisa con precaución' })).toBeVisible();
  await expect(page.getByText('Te quedan 19 revisiones hoy.')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Banco Ejemplo');
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
  await expect(page.getByLabel('Mensaje o link', { exact: true })).toHaveValue('');
});

for (const reviewCode of ['QUOTA_EXCEEDED', 'SERVICE_UNAVAILABLE']) {
  test(`${reviewCode}: muestra el error y permite reintentar`, async ({ page }) => {
    await page.addInitScript(s => localStorage.setItem('CapacitorStorage.cuelga.sesion.v1', JSON.stringify(s)), session);
    await mockServer(page, { consent: 'declined', reviewCode });
    await page.goto('/');
    await page.getByLabel('Mensaje o link', { exact: true }).fill('Mensaje con un código de prueba.');
    await page.getByRole('button', { name: 'Revisar', exact: true }).first().click();
    await expect(page.getByRole('status').last()).toContainText(reviewCode === 'QUOTA_EXCEEDED' ? '20 revisiones' : 'no está disponible');
    await page.getByRole('button', { name: 'Reintentar revisión', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Revisa con precaución' })).toBeVisible();
  });
}

test('Premium: código manual, reclamo, pendiente → caída transitoria → resumen actualizado', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(s => localStorage.setItem('CapacitorStorage.cuelga.sesion.v1', JSON.stringify(s)), session);
  await mockServer(page, { consent: 'accepted', premium: true, failPoll: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Desvío', exact: true }).click();
  await expect(page.locator('code.manual-code')).toHaveText('**67*+56225830699#');
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Llamadas', exact: true }).click();
  await page.getByLabel('Número que te llamó', { exact: true }).fill('9 1234 5678');
  await page.getByRole('button', { name: 'Reclamar llamada', exact: true }).click();
  await expect(page.getByText('Todavía no tenemos el texto', { exact: false })).toBeVisible();
  await page.clock.fastForward(10000);
  await expect(page.getByRole('status').last()).toContainText('no está disponible');
  await page.clock.fastForward(30000);
  await expect(page.getByText('Pide un código.', { exact: true })).toBeVisible();
  await expect(page.getByText('Duración: 42 segundos.', { exact: true })).toBeVisible();
});

test('la revisión en curso bloquea editar el texto al que pertenece el resultado', async ({ page }) => {
  await page.addInitScript(s => localStorage.setItem('CapacitorStorage.cuelga.sesion.v1', JSON.stringify(s)), session);
  await mockServer(page, { consent: 'declined' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${api}/mensajes/revisar`, async route => {
    await gate;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, nivel: 'sin-senales', senales: [], links: [], restantes: 19 }) });
  });
  await page.goto('/');
  const field = page.getByLabel('Mensaje o link', { exact: true });
  await field.fill('Hola, nos vemos mañana.');
  await page.getByRole('button', { name: 'Revisar', exact: true }).first().click();
  await expect(field).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: 'No encontramos señales de alerta' })).toBeVisible();
  await expect(field).toBeEnabled();
  await field.fill('Necesito tu clave y tu código.');
  await expect(page.getByRole('heading', { name: 'No encontramos señales de alerta' })).toHaveCount(0);
});

test('una respuesta vacía al abrir ofrece reintento', async ({ page }) => {
  await page.addInitScript(s => localStorage.setItem('CapacitorStorage.cuelga.sesion.v1', JSON.stringify(s)), session);
  await mockServer(page, { consent: 'declined' });
  let invalid = true;
  await page.route(`${api}/llamadas/estado`, route => invalid
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.fallback());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'El servicio no está disponible' })).toBeVisible();
  invalid = false;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisar mensaje o link' })).toBeVisible();
});

test('sesión vencida vuelve al ingreso y elimina la sesión local', async ({ page }) => {
  await page.addInitScript(s => localStorage.setItem('CapacitorStorage.cuelga.sesion.v1', JSON.stringify(s)), session);
  await mockServer(page, { expired: true });
  await page.goto('/');
  await expect(page.getByText('Tu sesión terminó. Vuelve a entrar.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('CapacitorStorage.cuelga.sesion.v1'))).toBeNull();
});

test('sin conexión dice que no pudo conectar y no muestra mensajes', async ({ page }) => {
  await page.addInitScript(s => localStorage.setItem('CapacitorStorage.cuelga.sesion.v1', JSON.stringify(s)), session);
  await mockServer(page, { offline: true, consent: 'accepted' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sin conexión' })).toBeVisible();
  await expect(page.locator('ul.messages')).toHaveCount(0);
});
