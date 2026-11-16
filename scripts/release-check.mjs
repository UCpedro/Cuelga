import { readFileSync } from 'node:fs';
// Las diez marcas del plan de la 1.0 (fase 9). Faltar una, sobrar una o no ser true es "no enviar".
const required = ['deviceBuildVerified', 'appleAccountAuthorized', 'bundleIdConfirmed', 'backendOwnershipVerified',
  'remoteNotificationsVerified', 'forwardedCallVerified', 'privacyAndRetentionApproved', 'supportAndPrivacyUrlsPublished',
  'reviewerAccessPrepared', 'storeMetadataApproved'];
const readiness = JSON.parse(readFileSync(new URL('../store-readiness.json', import.meta.url), 'utf8'));
const unknown = Object.keys(readiness).filter(name => !required.includes(name));
const pending = required.filter(name => readiness[name] !== true);
if (unknown.length || pending.length) {
  if (unknown.length) console.error('NO ENVIAR A APPLE: marcas desconocidas: ' + unknown.join(', '));
  if (pending.length) console.error('NO ENVIAR A APPLE: pendientes sin evidencia: ' + pending.join(', '));
  process.exitCode = 1;
} else {
  console.log('Lista documental completa; no firma ni envía. El titular debe revisar las evidencias y autorizar envío.');
}
