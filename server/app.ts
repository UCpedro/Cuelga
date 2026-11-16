import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Mailbox, InputError, CapacityError } from './mailbox-local';

/** Harness de integración, NO servidor desplegable ni API de clientes reales. */
export function localServer(mailbox = new Mailbox()) {
  const sessions = new Map<string, { owner: string; until: number }>();
  let count = 0, windowStart = Date.now();
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); count = 0; }
    if (++count > 300) { send(429, { error: 'Límite de prueba' }); return; }
    // Sin CORS público: sólo proxy local o peticiones loopback sin Origin.
    if (req.headers.origin && !['http://127.0.0.1:5178', 'http://localhost:5178'].includes(req.headers.origin)) { send(403, { error: 'Origen rechazado' }); return; }
    for (const [key, value] of sessions) if (value.until < Date.now()) { sessions.delete(key); mailbox.clear(value.owner); }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'POST' && path === '/sessions') {
      if (sessions.size >= 20) { send(429, { error: 'Máximo de sesiones de prueba' }); return; }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { owner: crypto.randomUUID(), until: Date.now() + 30 * 60_000 });
      send(201, { token, mode: 'local-test', expiresIn: 1800 }); return;
    }
    const auth = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const session = auth && sessions.get(auth);
    if (!session) { send(401, { error: 'Sesión de prueba requerida' }); return; }
    if (req.method === 'GET' && path === '/messages') { send(200, { messages: mailbox.list(session.owner) }); return; }
    const match = path.match(/^\/messages\/([a-f0-9-]{36})$/);
    if (match && req.method === 'GET') {
      const entry = mailbox.read(session.owner, match[1]!); send(entry ? 200 : 404, entry ?? { error: 'No disponible' }); return;
    }
    if (match && req.method === 'DELETE') {
      const removed = mailbox.delete(session.owner, match[1]!); send(removed ? 200 : 404, { removed }); return;
    }
    if (req.method === 'DELETE' && path === '/session') {
      mailbox.clear(session.owner); sessions.delete(auth as string); send(200, { removed: true }); return;
    }
    if (req.method !== 'POST' || path !== '/messages/completed') { send(404, { error: 'Ruta no disponible' }); return; }
    let body = '', length = 0;
    try {
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        if (length > 24_000) { send(413, { error: 'Evento demasiado grande' }); return; }
        body += chunk;
      }
      const result = await mailbox.complete(session.owner, JSON.parse(body));
      send(result.duplicate ? 200 : 201, result);
    } catch (error) {
      if (error instanceof InputError || error instanceof SyntaxError) send(400, { error: 'Evento inválido' });
      else if (error instanceof CapacityError) send(429, { error: 'Buzón de prueba lleno' });
      else send(500, { error: 'Fallo de prueba; sin detalles de contenido' });
    }
  });
}
