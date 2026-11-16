import { parseSession, type Session, type SessionStore } from './api';

export const SESSION_KEY = 'cuelga.sesion.v1';
export interface SecureSessionStorage {
  get(): Promise<{ value: string | null }>;
  set(options: { value: string }): Promise<void>;
  remove(): Promise<void>;
}
export interface LegacySessionStorage {
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
}

/** Respaldo de navegador/pruebas: sólo memoria, nunca localStorage ni Preferences. */
export function memorySessionStorage(): SecureSessionStorage {
  let value: string | null = null;
  return {
    async get() { return { value }; },
    async set(next) { value = next.value; },
    async remove() { value = null; },
  };
}

export function createSessionStore(secure: SecureSessionStorage, legacy: LegacySessionStorage): SessionStore {
  // Cargar, migrar, renovar y salir se ordenan: una carga vieja no revive la sesión al salir.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const next = queue.then(action);
    queue = next.catch(() => undefined);
    return next;
  }
  const removeLegacy = () => legacy.remove({ key: SESSION_KEY });
  return {
    load: () => serial(async () => {
      const stored = await secure.get(); // Si el Llavero falla, no degradar a Preferences.
      const value = stored.value ?? (await legacy.get({ key: SESSION_KEY })).value;
      if (value === null) { await removeLegacy(); return null; }
      let session: Session;
      try { session = parseSession(JSON.parse(value)); }
      catch { await secure.remove(); await removeLegacy(); return null; }
      if (stored.value === null) await secure.set({ value: JSON.stringify(session) });
      // Sólo se borra el valor antiguo después de guardarlo con éxito.
      await removeLegacy();
      return session;
    }),
    save: session => serial(async () => {
      await secure.set({ value: JSON.stringify(parseSession(session)) });
      await removeLegacy();
    }),
    clear: () => serial(async () => {
      // Intentar ambos borrados incluso si uno falla, sin ocultar ese error.
      const results = await Promise.allSettled([secure.remove(), removeLegacy()]);
      if (results.some(result => result.status === 'rejected')) throw new Error('No pudimos cerrar la sesión en este equipo. Vuelve a intentar.');
    }),
  };
}
