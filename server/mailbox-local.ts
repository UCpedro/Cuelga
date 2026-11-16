/** Contrato D48 v1. No incluye ownerId: lo resuelve la frontera autenticada. */
export interface CompletedMessage {
  version: 1;
  eventId: string;
  caller: string | null;
  completedAt: string;
  transcript: string;
}
export type Assessment = 'attention' | 'unassessed';
export interface Analysis { summary: string; assessment: Assessment }
export interface MailMessage extends Analysis {
  id: string;
  caller: string | null;
  completedAt: string;
  transcript: string;
  read: boolean;
  source: 'local-test';
}
export interface MailNotice {
  kind: 'mailbox'; messageId: string; title: string; body: string;
}
export const noticeFor = (id: string): MailNotice => ({
  kind: 'mailbox', messageId: id, title: 'Cuelga', body: 'Tienes un nuevo mensaje en tu buzón.',
});
export class InputError extends Error {}
export class CapacityError extends Error {}

export function newId(): string {
  // getRandomValues también funciona en WebViews sin randomUUID/secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function parseCompleted(input: unknown): CompletedMessage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Evento inválido');
  const e = input as Record<string, unknown>;
  const keys = ['version', 'eventId', 'caller', 'completedAt', 'transcript'];
  if (Object.keys(e).some(k => !keys.includes(k)) || keys.some(k => !(k in e))) throw new InputError('Campos inválidos');
  if (e.version !== 1 || typeof e.eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.eventId)) throw new InputError('Versión o identificador inválido');
  if (e.caller !== null && (typeof e.caller !== 'string' || !/^\+[1-9][0-9]{6,14}$/.test(e.caller))) throw new InputError('Número inválido');
  if (typeof e.completedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(e.completedAt) || !Number.isFinite(Date.parse(e.completedAt))) throw new InputError('Fecha inválida');
  if (typeof e.transcript !== 'string' || e.transcript.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e.transcript)) throw new InputError('Mensaje inválido');
  return { version: 1, eventId: e.eventId, caller: e.caller as string | null, completedAt: e.completedAt, transcript: e.transcript.trim() };
}

/** Doble determinista de análisis: NO es IA ni una medición de fraude. */
export async function localAnalysis(text: string): Promise<Analysis> {
  if (!text) return { summary: 'Quien llamó no dejó un mensaje. No se pudo evaluar.', assessment: 'unassessed' };
  const sensitive = /(?:c[oó]digo|clave|transfer|contrase[ñn]a)/i.test(text);
  return {
    summary: sensitive ? 'El mensaje menciona códigos, claves o transferencias. Verifica por un canal oficial antes de actuar.' : 'Hay un mensaje para revisar. Su contenido no permite confirmar la identidad de quien llamó.',
    assessment: sensitive ? 'attention' : 'unassessed',
  };
}

type Receipt = { id: string };
export class Mailbox {
  private messages = new Map<string, Map<string, MailMessage>>();
  private receipts = new Map<string, Map<string, Receipt>>();
  private flights = new Map<string, Promise<{ id: string; duplicate: boolean; notice?: MailNotice }>>();
  private pending = new Map<string, number>();
  constructor(private analyse: (text: string) => Promise<Analysis> = localAnalysis) {}

  async complete(owner: string, input: unknown): Promise<{ id: string; duplicate: boolean; notice?: MailNotice }> {
    const event = parseCompleted(input);
    const old = this.receipts.get(owner)?.get(event.eventId);
    if (old) return { id: old.id, duplicate: true };
    const flightKey = JSON.stringify([owner, event.eventId]);
    const active = this.flights.get(flightKey);
    if (active) return { id: (await active).id, duplicate: true };
    const operation = this.insert(owner, event);
    this.flights.set(flightKey, operation);
    try { return await operation; } finally { this.flights.delete(flightKey); }
  }

  private async insert(owner: string, event: CompletedMessage) {
    const box = this.messages.get(owner) ?? new Map<string, MailMessage>();
    const receipts = this.receipts.get(owner) ?? new Map<string, Receipt>();
    // Reservar antes de await: el límite también incluye eventos concurrentes.
    if (receipts.size >= 200 || box.size + (this.pending.get(owner) ?? 0) >= 50) throw new CapacityError('Buzón de prueba lleno');
    const id = newId();
    this.pending.set(owner, (this.pending.get(owner) ?? 0) + 1);
    receipts.set(event.eventId, { id });
    this.receipts.set(owner, receipts);
    this.messages.set(owner, box);
    let analysis: Analysis;
    try {
      analysis = await this.analyse(event.transcript);
      if (!['attention', 'unassessed'].includes(analysis.assessment) || typeof analysis.summary !== 'string' || !analysis.summary.trim() || analysis.summary.length > 280) throw new Error('Salida inválida');
    } catch {
      analysis = { summary: 'No se pudo analizar el mensaje. Revísalo con precaución y verifica por un canal oficial.', assessment: 'unassessed' };
    }
    box.set(id, { id, caller: event.caller, completedAt: event.completedAt, transcript: event.transcript, read: false, source: 'local-test', ...analysis });
    const pending = (this.pending.get(owner) ?? 1) - 1;
    if (pending) this.pending.set(owner, pending); else this.pending.delete(owner);
    return { id, duplicate: false, notice: noticeFor(id) };
  }

  list(owner: string): MailMessage[] {
    return [...(this.messages.get(owner)?.values() ?? [])].map(e => ({ ...e })).sort((a,b) => b.completedAt.localeCompare(a.completedAt));
  }
  read(owner: string, id: string): MailMessage | undefined {
    const entry = this.messages.get(owner)?.get(id);
    if (!entry) return undefined;
    entry.read = true;
    return { ...entry };
  }
  delete(owner: string, id: string): boolean {
    // Conservar sólo recibo de evento sin contenido para no resucitarlo por un callback repetido.
    return this.messages.get(owner)?.delete(id) ?? false;
  }
  clear(owner: string): void {
    this.messages.delete(owner);
    this.receipts.delete(owner);
  }
}

export const examples: Record<string, Omit<CompletedMessage, 'eventId' | 'completedAt'>> = {
  risk: { version: 1, caller: '+15550000101', transcript: 'Ejemplo ficticio: soy de Banco Ejemplo. Dígame el código que le llegó para anular la compra.' },
  delivery: { version: 1, caller: '+15550000102', transcript: 'Ejemplo ficticio: llamo de Despacho Ejemplo para coordinar la entrega. Puede revisar su pedido por su canal habitual.' },
  empty: { version: 1, caller: null, transcript: '' },
};
