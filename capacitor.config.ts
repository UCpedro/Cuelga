import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Provisional, no registrado ante Apple. El titular debe confirmarlo antes de firmar.
  appId: 'cl.cuelga.buzon',
  appName: 'Cuelga',
  webDir: 'dist',
  // El puente puede registrar argumentos y respuestas con tokens incluso en Debug.
  loggingBehavior: 'none',
  ios: { path: 'ios', contentInset: 'automatic', backgroundColor: '#F4F1EA' },
  // Sin server.url: los recursos van dentro del paquete, sin cargar producción.
};
export default config;
