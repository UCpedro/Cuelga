import { createHash } from 'node:crypto';
import { Mailbox, parseCompleted } from './mailbox-local';

/** Preparación desconectada. Nunca aceptar este objeto directamente del cliente. */
export interface Delivery {
  integrationId: string; eventId: string; destination: string; forwardedLine: string | null;
  caller: string | null; completedAt: string; transcript: string;
}
/** Asociaciones confiables del servidor; no vienen en un callback ni desde la app. */
export interface Binding {
  integrationId: string; destination: string; line: string; owner: string; mode: 'dedicated' | 'shared';
}
export interface RawDelivery { body: Uint8Array; headers: Readonly<Record<string, string>> }
export type Verifier = (request: RawDelivery) => Promise<unknown | null>;
export type IngressResult = { status: 'rejected'; reason: 'unverified' | 'invalid' | 'unresolved' | 'unavailable' }
  | { status: 'accepted' | 'duplicate'; id: string; notice?: import('./mailbox-local').MailNotice };
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9][0-9]{6,14}$/.test(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);

function parseDelivery(input: unknown): Delivery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  const value = input as Record<string, unknown>;
  const keys = ['integrationId', 'eventId', 'destination', 'forwardedLine', 'caller', 'completedAt', 'transcript'];
  if (Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))
    || !identifier(value.integrationId) || !phone(value.destination)
    || (value.forwardedLine !== null && !phone(value.forwardedLine))) throw new Error('invalid');
  const e = parseCompleted({ version: 1, eventId: value.eventId, caller: value.caller,
    completedAt: value.completedAt, transcript: value.transcript });
  return { integrationId: value.integrationId, destination: value.destination,
    forwardedLine: value.forwardedLine as string | null, eventId: e.eventId,
    caller: e.caller, completedAt: e.completedAt, transcript: e.transcript };
}

export function createLocalIngress(mailbox: Mailbox, config: readonly Binding[], verify?: Verifier) {
  // Copia defensiva: cambiar un objeto externo no reasigna un buzón ya configurado.
  const bindings = config.map(b => ({ ...b }));
  for (const b of bindings) {
    if (!identifier(b.integrationId) || !identifier(b.owner) || !phone(b.destination) || !phone(b.line)
      || !['dedicated', 'shared'].includes(b.mode)) throw new Error('Asociación local inválida');
  }
  return async (request: RawDelivery): Promise<IngressResult> => {
    if (!verify) return { status: 'rejected', reason: 'unverified' };
    if (!(request.body instanceof Uint8Array) || request.body.byteLength > 24_000) return { status: 'rejected', reason: 'invalid' };
    let input: unknown;
    try { input = await verify(request); }
    catch { return { status: 'rejected', reason: 'unverified' }; }
    if (input === null) return { status: 'rejected', reason: 'unverified' };
    let event: Delivery;
    try { event = parseDelivery(input); }
    catch { return { status: 'rejected', reason: 'invalid' }; }
    const candidates = bindings.filter(b => b.integrationId === event.integrationId && b.destination === event.destination);
    const dedicated = candidates.filter(b => b.mode === 'dedicated');
    let binding: Binding | undefined;
    if (dedicated.length) {
      if (candidates.length === 1 && (event.forwardedLine === null || dedicated[0]!.line === event.forwardedLine)) binding = dedicated[0];
    } else if (event.forwardedLine !== null) {
      const matching = candidates.filter(b => b.line === event.forwardedLine);
      if (matching.length === 1) binding = matching[0];
    }
    if (!binding) return { status: 'rejected', reason: 'unresolved' };
    const eventId = createHash('sha256').update(JSON.stringify([event.integrationId, event.eventId])).digest('hex');
    try {
      const result = await mailbox.complete(binding.owner, { version: 1, eventId, caller: event.caller,
        completedAt: event.completedAt, transcript: event.transcript });
      return { status: result.duplicate ? 'duplicate' : 'accepted', id: result.id,
        ...(result.notice ? { notice: result.notice } : {}) };
    } catch { return { status: 'rejected', reason: 'unavailable' }; }
  };
}
