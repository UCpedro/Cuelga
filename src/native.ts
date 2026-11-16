import { Capacitor, registerPlugin } from '@capacitor/core';
import { createSessionStore, memorySessionStorage, type SecureSessionStorage } from './session-store';
import type { StoreKitBridge } from './apple-purchases';

export const storeKit = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform()
  ? registerPlugin<StoreKitBridge>('CuelgaStoreKit') : null;

const keychain = registerPlugin<SecureSessionStorage>('CuelgaSession');
// En iOS el plugin debe existir: nunca degradar silenciosamente a almacenamiento sin protección.
export const sessionStore = createSessionStore(
  Capacitor.isNativePlatform() ? keychain : memorySessionStorage(),
  {
    async get(options) { return (await import('@capacitor/preferences')).Preferences.get(options); },
    async remove(options) { await (await import('@capacitor/preferences')).Preferences.remove(options); },
  },
);

type Env = { VITE_APNS_ENV?: string };
const env = (import.meta as ImportMeta & { env?: Env }).env;
/** TestFlight y App Store usan production. Sólo una instalación directa desde Xcode usa development. */
export const apnsEnvironment: 'production' | 'development' = env?.VITE_APNS_ENV === 'development' ? 'development' : 'production';

export type PushResult = 'registered' | 'denied' | 'web' | 'error';

/**
 * Pide permiso de avisos y entrega el token al servidor. Los listeners van ANTES de register().
 * El token nunca se imprime. Si la persona niega el permiso, la bandeja igual muestra los
 * mensajes al abrir la app (Apple 4.5.4).
 */
export async function enablePush(
  sendToken: (token: string) => Promise<void>,
  open: (messageId: string, generation: unknown) => void,
): Promise<{ result: PushResult; cleanup: () => void }> {
  if (!Capacitor.isNativePlatform()) return { result: 'web', cleanup: () => {} };
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const handles = await Promise.all([
    PushNotifications.addListener('registration', token => { void sendToken(token.value).catch(() => {}); }),
    PushNotifications.addListener('registrationError', () => {}),
    PushNotifications.addListener('pushNotificationActionPerformed', action => {
      const id: unknown = action.notification.data?.messageId;
      if (typeof id === 'string') open(id, action.notification.data?.bindingGeneration);
    }),
  ]);
  const cleanup = () => { handles.forEach(h => { void h.remove(); }); };
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return { result: 'denied', cleanup };
    await PushNotifications.register();
    return { result: 'registered', cleanup };
  } catch { return { result: 'error', cleanup }; }
}

/** Al salir o borrar la cuenta: este iPhone deja de recibir avisos y se retiran los que había. */
export async function disablePush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllDeliveredNotifications();
    await PushNotifications.removeAllListeners();
    await PushNotifications.unregister();
  } catch { /* El servidor también borra los tokens de la cuenta (fase 7). */ }
}
