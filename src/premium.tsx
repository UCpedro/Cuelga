import React, { useEffect, useState } from 'react';
import type { AppleConfig } from './api';
import { ApplePurchases, subscriptionPeriod, type AppleProduct, type AppleServer } from './apple-purchases';

type Props = { api: AppleServer; purchases: ApplePurchases; premium: boolean; refreshed: () => Promise<void>; links: React.ReactNode };

/** Pantalla compartida por iOS y el respaldo de navegador; el precio sólo viene de StoreKit. */
export function PremiumPanel({ api, purchases, premium, refreshed, links }: Props) {
  const [config, setConfig] = useState<AppleConfig | null>(null);
  const [product, setProduct] = useState<AppleProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!purchases.available) return;
    let stopped = false;
    setProduct(null); setError(''); setConfig(null);
    void (async () => {
      try {
        const current = await api.appleConfig();
        if (stopped) return;
        setConfig(current);
        if (!current.premium) {
          const value = await purchases.product(current);
          if (!stopped) setProduct(value);
        }
      } catch { if (!stopped) setError('Las compras de Apple no están disponibles ahora. Puedes seguir usando tu cuenta y volver a intentar más tarde.'); }
    })();
    return () => { stopped = true; };
  }, [api, purchases, premium, attempt]);

  async function action(run: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await run()); await refreshed(); setAttempt(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos comprobar el resultado. Vuelve a intentar o toca Restaurar.'); }
    finally { setBusy(false); }
  }

  const hasPremium = premium || config?.premium === true;
  return <>
    <PremiumContent premium={hasPremium} source={config?.source} available={purchases.available} product={product} busy={busy}
      buy={() => void action(async () => {
        const result = await purchases.purchase();
        return result === 'already-premium' ? 'Ya tienes Premium. No necesitas otra suscripción.'
          : result === 'cancelled' ? 'Cancelaste la compra. Tu plan no cambió.'
          : result === 'pending' ? 'La compra está pendiente de aprobación de Apple. Premium se activa cuando Apple y el servidor la confirman.'
          : 'Tu compra quedó comprobada. Premium está activo.';
      })}
      restore={() => void action(async () => await purchases.reconcile(true) > 0
        ? 'Comprobamos tus compras de Apple. El acceso corresponde a la vigencia que confirmó el servidor.'
        : 'No encontramos compras para esta cuenta de Cuelga. Usa la cuenta con la que compraste.')}
      manage={() => void action(async () => { await purchases.manage(); return 'Revisamos tu plan al volver. Cancelar la renovación conserva el período pagado.'; })}
      links={links} />
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {purchases.available && <button className="link" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Actualizar Premium</button>}
  </>;
}

export function PremiumContent(props: { premium: boolean; source?: AppleConfig['source']; available: boolean; product: AppleProduct | null;
  busy: boolean; buy: () => void; restore: () => void; manage: () => void; links: React.ReactNode }) {
  return <div className="premium-content">
    {props.premium ? <>
      <h2>Ya tienes Premium</h2>
      <p>Tu cuenta tiene acceso a Llamadas y revisiones sin tope diario. No necesitas otra suscripción.</p>
      {props.source === 'apple' && <p>Premium por Apple. Puedes cancelar su renovación en Gestionar suscripción.</p>}
    </> : <>
      <p className="intro">Con Premium puedes reclamar llamadas desviadas al buzón y, si aceptas que se pasen a texto, leer su resumen. También puedes revisar mensajes y links sin tope diario.</p>
      {props.product && <>
        <h2>{props.product.displayName}</h2>
        <p className="premium-price">{props.product.displayPrice} por {subscriptionPeriod(props.product)}</p>
        <p>Suscripción con renovación automática cada {subscriptionPeriod(props.product)}. Apple carga el pago a tu cuenta al confirmar la compra y vuelve a cobrar al renovar, a menos que canceles antes. Puedes gestionar o cancelar en las suscripciones de tu cuenta de Apple. Cancelar conserva el acceso hasta el fin del período pagado.</p>
        <button disabled={props.busy} onClick={props.buy}>Suscribirme con Apple</button>
      </>}
      {props.available && !props.product && <p>El precio y la compra estarán disponibles cuando Apple y Cuelga puedan confirmar el producto.</p>}
    </>}
    {!props.available && <p>Las compras y la restauración de Apple están disponibles en la app de iPhone. Este navegador no tiene StoreKit.</p>}
    {props.available && <div className="actions">
      <button className="secondary" disabled={props.busy} onClick={props.restore}>Restaurar compras</button>
      <button className="secondary" disabled={props.busy} onClick={props.manage}>Gestionar suscripción</button>
    </div>}
    {props.links}
  </div>;
}
