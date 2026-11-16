/**
 * Cliente del contrato app ↔ servidor (D60).
 * Contrato: innova/cuelga/app/CONTRATO-APP-SERVIDOR.md. Se agrega, no se cambia:
 * la versión publicada tiene que seguir entendiendo al servidor.
 */
export interface Session { accessToken: string; refreshToken: string; expiresAt: number; deletionOperationId?: string }
export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}
export type AiConsent = 'not_requested' | 'accepted' | 'declined';
export type MailboxState = 'not_active' | 'active';
export interface Status {
  account: { identifier: string; aiConsent: AiConsent };
  mailbox: { state: MailboxState; forwardingNumber: string | null };
}
export interface UtilityStatus extends Status { plan: { premium: boolean } }
export interface AppleConfig {
  appAccountToken: string;
  productId: string;
  premium: boolean;
  source: 'mp' | 'apple' | 'none';
}
export interface ReviewSignal { id: string; titulo: string; explicacion: string; fuerza: 'fuerte' | 'media' }
export interface ReviewedLink {
  texto: string;
  resultado: null | {
    veredicto: 'peligroso' | 'sospechoso' | 'sin-senales';
    sitio: string;
    destino: string | null;
    listaNegra: 'listado' | 'no-listado' | 'no-conectada' | 'fallo';
    senales: ReviewSignal[];
  };
}
export interface ReviewResult {
  nivel: 'sin-senales' | 'precaucion' | 'alto';
  senales: ReviewSignal[];
  links: ReviewedLink[];
  restantes: number | null;
}
export interface MailMessage {
  id: string;
  receivedAt: string;
  caller: string | null;
  assessment: 'attention' | 'unassessed' | null;
  summary: string | null;
  transcript: string | null;
  /** pending: se está pasando a texto; ready: hay texto; not_requested: sin permiso de IA; failed: no se pudo. */
  textStatus: 'pending' | 'ready' | 'not_requested' | 'failed';
  read: boolean;
  durationSeconds: number | null;
}
export interface Mailbox { state: MailboxState; messages: MailMessage[] }

/** NETWORK: no hubo respuesta. INVALID_RESPONSE: el servidor contestó algo fuera del contrato. */
export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string, public readonly retryAfter?: number) { super(message); }
}

type Env = { VITE_CUELGA_API?: string };
const env = (import.meta as ImportMeta & { env?: Env }).env;
export const API_BASE = env?.VITE_CUELGA_API ?? 'https://cuelga-prototipo.vercel.app/api/movil/v1';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const phone = /^\+[1-9][0-9]{6,14}$/;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new ApiError('INVALID_RESPONSE', 0, 'Recibimos una respuesta que no entendemos. Actualiza la app o vuelve a intentar.');

export function parseSession(value: unknown): Session {
  if (!isObject(value) || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string'
    || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)
    || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value.accessToken) || !value.refreshToken) throw invalid();
  if (value.deletionOperationId !== undefined && (typeof value.deletionOperationId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.deletionOperationId))) throw invalid();
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt,
    ...(value.deletionOperationId ? { deletionOperationId: value.deletionOperationId as string } : {}) };
}

export function parseStatus(value: unknown): Status {
  if (!isObject(value) || !isObject(value.account) || !isObject(value.mailbox)) throw invalid();
  const { account, mailbox } = value;
  if (typeof account.identifier !== 'string' || !['not_requested', 'accepted', 'declined'].includes(account.aiConsent as string)) throw invalid();
  if (!['not_active', 'active'].includes(mailbox.state as string)) throw invalid();
  if (mailbox.forwardingNumber !== null && (typeof mailbox.forwardingNumber !== 'string' || !/^\+56[2-9][0-9]{8}$/.test(mailbox.forwardingNumber) || /^\+56(?:600|809)/.test(mailbox.forwardingNumber))) throw invalid();
  return {
    account: { identifier: account.identifier, aiConsent: account.aiConsent as AiConsent },
    mailbox: { state: mailbox.state as MailboxState, forwardingNumber: mailbox.forwardingNumber as string | null },
  };
}

export function parseUtilityStatus(value: unknown): UtilityStatus {
  const status = parseStatus(value);
  if (!isObject(value) || !isObject(value.plan) || typeof value.plan.premium !== 'boolean') throw invalid();
  const premium = value.plan.premium;
  if (premium ? status.mailbox.state !== 'active' || !status.mailbox.forwardingNumber
    : status.mailbox.state !== 'not_active' || status.mailbox.forwardingNumber !== null) throw invalid();
  return { ...status, plan: { premium } };
}

function nullableText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
}

export function parseMessage(value: unknown): MailMessage {
  if (!isObject(value) || typeof value.id !== 'string' || !uuid.test(value.id)) throw invalid();
  if (typeof value.receivedAt !== 'string' || !Number.isFinite(Date.parse(value.receivedAt))) throw invalid();
  if (value.caller !== null && (typeof value.caller !== 'string' || !phone.test(value.caller))) throw invalid();
  // El contrato no tiene "seguro": cualquier otra valoración se rechaza (D11, D18, D53).
  if (value.assessment !== null && value.assessment !== 'attention' && value.assessment !== 'unassessed') throw invalid();
  if (typeof value.read !== 'boolean') throw invalid();
  if (!['pending', 'ready', 'not_requested', 'failed'].includes(value.textStatus as string)) throw invalid();
  const duration = value.durationSeconds ?? null;
  if (duration !== null && (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 0)) throw invalid();
  return {
    id: value.id, receivedAt: value.receivedAt, caller: value.caller as string | null,
    assessment: value.assessment as MailMessage['assessment'],
    summary: nullableText(value.summary, 2000), transcript: nullableText(value.transcript, 8000),
    textStatus: value.textStatus as MailMessage['textStatus'], read: value.read,
    durationSeconds: duration as number | null,
  };
}

export function parseMailbox(value: unknown): Mailbox {
  if (!isObject(value) || !['not_active', 'active'].includes(value.state as string) || !Array.isArray(value.messages)) throw invalid();
  if (value.messages.length > 500) throw invalid();
  return { state: value.state as MailboxState, messages: value.messages.map(parseMessage) };
}

function signals(value: unknown): ReviewSignal[] {
  if (!Array.isArray(value) || value.length > 50) throw invalid();
  return value.map(s => {
    if (!isObject(s) || typeof s.id !== 'string' || s.id.length > 100 || typeof s.titulo !== 'string' || s.titulo.length > 500
      || typeof s.explicacion !== 'string' || s.explicacion.length > 4000 || !['fuerte', 'media'].includes(s.fuerza as string)) throw invalid();
    return { id: s.id, titulo: s.titulo, explicacion: s.explicacion, fuerza: s.fuerza as ReviewSignal['fuerza'] };
  });
}

export function parseReview(value: unknown): ReviewResult {
  if (!isObject(value) || !['sin-senales', 'precaucion', 'alto'].includes(value.nivel as string)
    || !Array.isArray(value.links) || value.links.length > 3
    || (value.restantes !== null && (typeof value.restantes !== 'number' || !Number.isInteger(value.restantes) || value.restantes < 0 || value.restantes > 20))) throw invalid();
  const links: ReviewedLink[] = value.links.map(link => {
    if (!isObject(link) || typeof link.texto !== 'string' || link.texto.length > 2000) throw invalid();
    if (link.resultado === null) return { texto: link.texto, resultado: null };
    const r = link.resultado;
    if (!isObject(r) || !['peligroso', 'sospechoso', 'sin-senales'].includes(r.veredicto as string)
      || typeof r.sitio !== 'string' || r.sitio.length > 2000
      || !['listado', 'no-listado', 'no-conectada', 'fallo'].includes(r.listaNegra as string)) throw invalid();
    return { texto: link.texto, resultado: { veredicto: r.veredicto as NonNullable<ReviewedLink['resultado']>['veredicto'],
      sitio: r.sitio, destino: nullableText(r.destino ?? null, 2000), listaNegra: r.listaNegra as NonNullable<ReviewedLink['resultado']>['listaNegra'], senales: signals(r.senales) } };
  });
  return { nivel: value.nivel as ReviewResult['nivel'], senales: signals(value.senales), links, restantes: value.restantes as number | null };
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class CuelgaApi {
  private refreshing: Promise<Session> | null = null;
  private bindingGeneration: string | null = null;
  private bindingRevision = 0;
  acceptsPush(generation: unknown) { return typeof generation === 'string' && generation === this.bindingGeneration; }

  constructor(
    private readonly store: SessionStore,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly base = API_BASE,
    private readonly now = () => Date.now(),
  ) {}

  private async call(path: string, init: { method: 'GET' | 'POST'; body?: unknown; token?: string }) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method: init.method, headers, cache: 'no-store', credentials: 'omit',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ApiError('NETWORK', 0, 'No pudimos conectar con Cuelga. Revisa tu conexión y vuelve a intentar.');
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw invalid(); }
    if (!isObject(data)) throw invalid();
    if (!response.ok || data.ok !== true) {
      const code = typeof data.code === 'string' ? data.code : 'SERVICE_UNAVAILABLE';
      const message = typeof data.error === 'string' ? data.error : 'El servicio no está disponible ahora. Vuelve a intentar.';
      const retryAfter = typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
      throw new ApiError(code, response.status, message, retryAfter);
    }
    return data;
  }

  private async refresh(current: Session): Promise<Session> {
    const revision = this.bindingRevision;
    this.refreshing ??= (async () => {
      try {
        const data = await this.call('/sesion/renovar', { method: 'POST', body: { refreshToken: current.refreshToken } });
        const next = { ...parseSession(data.session), ...(current.deletionOperationId ? { deletionOperationId: current.deletionOperationId } : {}) };
        if (revision !== this.bindingRevision) throw new ApiError('SESSION_CHANGED', 409, 'La sesión cambió. Vuelve a intentar.');
        await this.store.save(next);
        return next;
      } catch (error) {
        // Una llave larga rechazada no se reintenta: se borra y se vuelve a entrar.
        if (error instanceof ApiError && error.status === 401 && revision === this.bindingRevision) await this.store.clear();
        throw error;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  private async authed(path: string, method: 'GET' | 'POST', body?: unknown) {
    let session = await this.store.load();
    if (!session) throw new ApiError('AUTH_REQUIRED', 401, 'Entra a tu cuenta para continuar.');
    if (session.expiresAt * 1000 - this.now() < 60_000) session = await this.refresh(session);
    try { return await this.call(path, { method, body, token: session.accessToken }); }
    catch (error) {
      // Sólo una llave vencida o revocada se renueva; un 401 por contraseña mala no se repite.
      if (!(error instanceof ApiError) || error.status !== 401 || error.code !== 'AUTH_REQUIRED') throw error;
      const renewed = await this.refresh(session);
      return this.call(path, { method, body, token: renewed.accessToken });
    }
  }

  async hasSession() { return (await this.store.load()) !== null; }
  async hasPendingDeletion() { return Boolean((await this.store.load())?.deletionOperationId); }

  async login(identifier: string, password: string): Promise<{ pendingDeletion: boolean }> {
    this.bindingGeneration=null; this.bindingRevision++;
    const data = await this.call('/sesion/entrar', { method: 'POST', body: { identifier, password } });
    await this.store.save(parseSession(data.session));
    return { pendingDeletion: data.next === 'delete-account' };
  }

  async register(identifier: string, password: string, invitation?: string) {
    const data = await this.call('/sesion/registro', { method: 'POST', body: { identifier, password, ...(invitation ? { invitation } : {}), notice: true } });
    await this.store.save(parseSession(data.session));
  }

  /** Siempre borra la sesión del iPhone, aunque el servidor no conteste. */
  async logout(): Promise<boolean> {
    this.bindingGeneration=null; this.bindingRevision++;
    try { await this.authed('/sesion/salir', 'POST', {}); return true; }
    catch { return false; }
    finally { await this.store.clear(); }
  }

  async status() { return parseStatus(await this.authed('/estado', 'GET')); }
  async mailbox() { return parseMailbox(await this.authed('/buzon', 'GET')); }
  async utilityStatus() { return parseUtilityStatus(await this.authed('/llamadas/estado', 'GET')); }
  async appleConfig(): Promise<AppleConfig> {
    const data = await this.authed('/apple/config', 'GET');
    if (typeof data.appAccountToken !== 'string' || !uuid.test(data.appAccountToken)
      || typeof data.productId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(data.productId)
      || typeof data.premium !== 'boolean' || !['mp', 'apple', 'none'].includes(data.source as string)
      || (data.premium ? data.source === 'none' : data.source !== 'none')) throw invalid();
    return { appAccountToken: data.appAccountToken, productId: data.productId, premium: data.premium, source: data.source as AppleConfig['source'] };
  }
  async appleTransaction(signedTransaction: string, restore = false): Promise<boolean> {
    const data = await this.authed(restore ? '/apple/restaurar' : '/apple/transaccion', 'POST', { signedTransaction });
    if (typeof data.premium !== 'boolean') throw invalid();
    return data.premium;
  }
  async calls() { return parseMailbox(await this.authed('/llamadas', 'GET')); }
  async review(texto: string) { return parseReview(await this.authed('/mensajes/revisar', 'POST', { texto })); }
  async claim(caller: string): Promise<string> {
    const data = await this.authed('/llamadas/reclamar', 'POST', { caller });
    if (typeof data.id !== 'string' || !uuid.test(data.id) || data.textStatus !== 'pending') throw invalid();
    return data.id;
  }
  async deleteMessage(id: string) { await this.authed('/buzon/borrar', 'POST', { id }); }

  async setAiConsent(accepted: boolean): Promise<AiConsent> {
    const data = await this.authed('/consentimiento-ia', 'POST', { accepted });
    if (data.aiConsent !== (accepted ? 'accepted' : 'declined')) throw invalid();
    return data.aiConsent as AiConsent;
  }

  async registerDevice(token: string, environment: 'production' | 'development') {
    const revision=this.bindingRevision;
    const data = await this.authed('/aparato', 'POST', { token, environment, platform: 'ios' });
    if(revision!==this.bindingRevision) return false;
    this.bindingGeneration=typeof data.bindingGeneration==='string' && uuid.test(data.bindingGeneration) ? data.bindingGeneration : null;
    return data.registered === true;
  }

  async deleteAccount(password: string, operationId: string) {
    this.bindingGeneration=null; this.bindingRevision++;
    const current = await this.store.load();
    if (!current) throw new ApiError('AUTH_REQUIRED', 401, 'Entra a tu cuenta para continuar.');
    const pending = parseSession({ ...current, deletionOperationId: current.deletionOperationId ?? operationId });
    await this.store.save(pending);
    const body = { confirmation: true, password, operationId: pending.deletionOperationId };
    // Primero consultar con el token original, aun vencido: el recibo del servidor permite
    // confirmar un DELETE cuya respuesta se perdió. Renovar antes descartaría esa sesión.
    try { await this.call('/cuenta/borrar', { method: 'POST', body, token: pending.accessToken }); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'REAUTH_INVALID') await this.store.save(current);
      if (!(error instanceof ApiError) || error.code !== 'AUTH_REQUIRED') throw error;
      await this.authed('/cuenta/borrar', 'POST', body);
    }
    await this.store.clear();
  }
}

export function newOperationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
