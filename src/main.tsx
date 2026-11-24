import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, CuelgaApi, newOperationId, type AiConsent, type MailMessage, type Mailbox, type UtilityStatus, type ReviewResult } from './api';
import { apnsEnvironment, disablePush, enablePush, sessionStore, isNativeIos, type PushResult } from './native';
import { IosLegalLinks } from './legal';
import { forwardingCheck, forwardingCode, forwardingRemove } from './forwarding';
import './style.css';

const api = new CuelgaApi(sessionStore);

type View = 'loading' | 'welcome' | 'login' | 'register' | 'consent' | 'app' | 'finish-deletion' | 'offline' | 'disabled' | 'unavailable';
type Tab = 'revisar' | 'buzon' | 'desvio' | 'datos';

const DATA_NOTICE = [
  'Cuelga recibe en un número suyo las llamadas que tú rechazas y desvías. Quien llama escucha un saludo y puede dejar un mensaje.',
  'Zadarma recibe esas llamadas y graba el mensaje. Si lo aceptas, Zadarma lo pasa a texto y Anthropic (Claude) recibe ese texto y resume qué te pedían.',
  'El borrado del audio en Zadarma y de posibles copias por correo requiere gestión manual del equipo; no es automático ni inmediato. El texto y el resumen se guardan 90 días. Puedes borrar cada mensaje o tu cuenta cuando quieras.',
  'Cuelga no lee tus contactos ni tus mensajes, y no escucha las llamadas que contestas: sólo recibe las que tú desvías al buzón.',
  'Para revisar un SMS, WhatsApp o link, tú pegas el texto. No guardamos ese texto. Los links se revisan con reglas y consultas a URLhaus; si son acortados, se intenta conocer su destino.',
];

const time = (iso: string) => new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const titleFor = (m: MailMessage) => m.assessment === 'attention' ? 'Revisa antes de actuar' : m.assessment === 'unassessed' ? 'Hay un mensaje para ti' : 'Tienes un mensaje de voz';

function PublicLinks() {
  if (isNativeIos) return <IosLegalLinks />;
  return <aside className="public-links" aria-label="Información de Cuelga">
    <a href="https://cuelga-prototipo.vercel.app/privacidad" target="_blank" rel="noopener noreferrer">Privacidad</a>
    <a href="https://cuelga-prototipo.vercel.app/terminos" target="_blank" rel="noopener noreferrer">Términos</a>
    <a href="https://cuelga-prototipo.vercel.app/soporte" target="_blank" rel="noopener noreferrer">Soporte</a>
  </aside>;
}

function Field(props: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: string }) {
  return <div className="field">
    <label htmlFor={props.id}>{props.label}</label>
    <input id={props.id} type={props.type ?? 'text'} value={props.value} autoComplete={props.autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      onChange={e => props.onChange(e.target.value)} aria-describedby={props.hint ? `${props.id}-hint` : undefined} />
    {props.hint && <small id={`${props.id}-hint`} className="muted">{props.hint}</small>}
  </div>;
}

function App() {
  const [view, setView] = useState<View>('loading');
  const [tab, setTab] = useState<Tab>('revisar');
  const [status, setStatus] = useState<UtilityStatus | null>(null);
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [texto, setTexto] = useState('');
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [caller, setCaller] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [operationId, setOperationId] = useState(newOperationId);
  const [pushState, setPushState] = useState<PushResult | null>(null);
  const [deviceConfirmed, setDeviceConfirmed] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  const pushCleanup = useRef<(() => void) | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, [view, tab, selected]);

  const fail = useCallback(async (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'CONSENT_WITHDRAWING') {
        setConsentPending(true);
        setStatus(s => s && { ...s, account: { ...s.account, aiConsent: 'declined' } });
        setMailbox(m => m && { ...m, messages: m.messages.map(msg => ({ ...msg, transcript: null, summary: null, assessment: null, textStatus: 'not_requested' })) });
        setNotice(error.message); return;
      }
      if (error.code === 'NETWORK') { setView('offline'); return; }
      if (error.code === 'APP_DISABLED') { setView('disabled'); return; }
      if (error.code === 'PREMIUM_REQUIRED') {
        setStatus(s => s && { ...s, plan: { premium: false }, mailbox: { state: 'not_active', forwardingNumber: null } });
        setMailbox(null); setSelected(null);
        setNotice('No pudimos acceder a tus llamadas. Vuelve a intentar.');
        return;
      }
      if (error.status === 401 && error.code === 'AUTH_REQUIRED') {
        await sessionStore.clear();
        pushCleanup.current?.(); pushCleanup.current = null;
        await disablePush();
        setReview(null); setTexto(''); setCaller(''); setSelected(null);
        setStatus(null); setMailbox(null); setView('welcome');
        setNotice('Tu sesión terminó. Vuelve a entrar.');
        return;
      }
      setNotice(error.message);
      return;
    }
    setNotice('Algo falló. Vuelve a intentar.');
  }, []);

  const refreshMailbox = useCallback(async () => {
    try {
      const current = await api.utilityStatus();
      setStatus(current);
      setMailbox(current.plan.premium ? await api.calls() : null);
    }
    catch (error) { await fail(error); }
  }, [fail]);

  const startPush = useCallback(async () => {
    if (pushCleanup.current) return;
    const { result, cleanup } = await enablePush(
      async token => { setDeviceConfirmed(await api.registerDevice(token, apnsEnvironment)); },
      (id, generation) => { if (api.acceptsPush(generation)) { setTab('buzon'); setSelected(id); void refreshMailbox(); } },
    );
    pushCleanup.current = cleanup;
    setPushState(result);
  }, [refreshMailbox]);

  const load = useCallback(async () => {
    setNotice('');
    try {
      if (!(await api.hasSession())) { setView('welcome'); return; }
      if (await api.hasPendingDeletion()) { setView('finish-deletion'); return; }
      const current = await api.utilityStatus();
      setStatus(current);
      if (current.account.aiConsent === 'not_requested') { setView('consent'); return; }
      setView('app');
      setMailbox(current.plan.premium ? await api.calls() : null);
      void startPush();
    } catch (error) {
      setView('unavailable');
      if (error instanceof ApiError && (error.status >= 500 || error.code === 'INVALID_RESPONSE') && error.code !== 'APP_DISABLED') setView('unavailable');
      await fail(error);
    }
  }, [fail, startPush]);

  useEffect(() => { void load(); }, [load]);

  // Al volver a la app se actualizan el estado y la bandeja, sin depender de los avisos.
  useEffect(() => {
    if (view !== 'app') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        await refreshMailbox();
      })();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [view, refreshMailbox]);

  const pending = Boolean(status?.plan.premium && (mailbox?.messages.some(m => m.textStatus === 'pending')
    || (selected && !mailbox?.messages.some(m => m.id === selected))));
  useEffect(() => {
    if (view !== 'app' || !pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const messages = await api.calls();
        if (!cancelled) { setMailbox(messages); timer = setTimeout(() => void poll(), 10000); }
      } catch (error) {
        if (cancelled) return;
        await fail(error);
        // Una caída transitoria no corta para siempre la actualización de una llamada pendiente.
        if (!cancelled && error instanceof ApiError && (error.status >= 500 || error.code === 'INVALID_RESPONSE')) {
          timer = setTimeout(() => void poll(), 30000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 10000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [view, pending, fail]);

  async function submit(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setNotice('');
    try { await action(); }
    catch (error) { await fail(error); }
    finally { setBusy(false); }
  }

  const login = () => submit(async () => {
    const { pendingDeletion } = await api.login(identifier.trim(), password);
    setPassword('');
    if (pendingDeletion) { setView('finish-deletion'); return; }
    await load();
  });

  const register = () => submit(async () => {
    if (!accepted) { setNotice('Lee y acepta el aviso de datos para crear tu cuenta.'); return; }
    if ([...password].length < 8) { setNotice('La contraseña necesita al menos 8 caracteres.'); return; }
    await api.register(identifier.trim(), password);
    setPassword('');
    await load();
  });

  const reviewText = () => submit(async () => {
    setReview(null); setReviewFailed(false);
    if (!texto.trim()) { setNotice('Pega el mensaje o el link que te llegó.'); return; }
    try { setReview(await api.review(texto)); }
    catch (error) { setReviewFailed(true); throw error; }
  });

  const claimCall = () => submit(async () => {
    const id = await api.claim(caller.trim());
    setSelected(id); setCaller('');
    setNotice('La llamada quedó en tu cuenta. El resumen puede demorar unos minutos.');
    await refreshMailbox();
  });

  const chooseConsent = (value: boolean) => submit(async () => {
    const result: AiConsent = await api.setAiConsent(value);
    setConsentPending(false);
    setStatus(s => s && { ...s, account: { ...s.account, aiConsent: result } });
    if (result === 'declined') {
      // La base ya borró el texto: tampoco se deja en pantalla (revisión Codex 09-11, H3).
      setMailbox(m => m && { ...m, messages: m.messages.map(msg => ({ ...msg, transcript: null, summary: null, assessment: null,
        textStatus: msg.textStatus === 'failed' ? 'failed' : 'not_requested' })) });
    }
    if (view !== 'consent') await refreshMailbox();
    if (view === 'consent') await load();
    else setNotice(result === 'accepted' ? 'Listo: tus próximos mensajes se pasarán a texto y se resumirán.' : 'Listo: sólo te avisaremos que tienes un mensaje de voz, sin texto.');
  });

  async function signOutLocal(message: string) {
    pushCleanup.current?.(); pushCleanup.current = null;
    await disablePush();
    setStatus(null); setMailbox(null); setSelected(null); setTab('revisar'); setPushState(null); setDeviceConfirmed(false);
    setTexto(''); setReview(null); setReviewFailed(false); setCaller('');
    setIdentifier(''); setPassword(''); setDeletePassword('');
    setOperationId(newOperationId());
    setView('welcome'); setNotice(message);
  }

  const logout = () => submit(async () => {
    const reached = await api.logout();
    await signOutLocal(reached ? 'Saliste de tu cuenta.' : 'Saliste en este iPhone. No pudimos avisar al servidor; vuelve a entrar y salir cuando tengas conexión para cerrar las otras sesiones.');
  });

  const deleteAccount = () => submit(async () => {
    if (!window.confirm('¿Borrar tu cuenta y todos tus mensajes? No se puede deshacer.')) return;
    setNotice('Borrando tu cuenta y tus mensajes de Cuelga.');
    try { await api.deleteAccount(deletePassword, operationId); }
    catch (error) {
      // Sin respuesta no se sabe si se borró: se conserva el mismo comprobante para reintentar (vale una hora).
      if (error instanceof ApiError && error.code === 'NETWORK') {
        setView('finish-deletion');
        setNotice('No pudimos confirmar el resultado. Conservamos tu comprobante en este equipo para que reintentes el mismo borrado cuando vuelva la conexión. El comprobante del servidor dura una hora.');
        return;
      }
      if (error instanceof ApiError && ['ACCOUNT_DELETION_PENDING', 'ACCOUNT_DELETION_UNCONFIRMED', 'DELETION_UNAVAILABLE'].includes(error.code)) {
        setView('finish-deletion');
        setNotice('Todavía no pudimos confirmar el borrado. Vuelve a intentar con tu contraseña; conservamos el comprobante para retomar la misma solicitud.');
        return;
      }
      if (error instanceof ApiError && ['DELETION_RECEIPT_MISMATCH', 'DELETION_RECEIPT_EXPIRED'].includes(error.code)) {
        setView('finish-deletion');
        setNotice('No pudimos retomar con este comprobante o tu sesión venció. Toca «Salir y volver a entrar» e ingresa con la misma cuenta y contraseña para iniciar una nueva solicitud o terminar el borrado pendiente. Esto no confirma que la cuenta se haya borrado.');
        return;
      }
      throw error;
    }
    setOperationId(newOperationId());
    await signOutLocal('Se borraron tu cuenta y tus mensajes guardados en Cuelga. Esto no confirma el borrado del audio en Zadarma ni de posibles copias por correo: esa gestión sigue siendo manual.');
  });

  const deleteMessage = (id: string) => submit(async () => {
    if (!window.confirm('¿Borrar este mensaje? No se puede deshacer.')) return;
    await api.deleteMessage(id);
    setSelected(null);
    await refreshMailbox();
    setNotice('Mensaje borrado.');
  });

  const current = mailbox?.messages.find(m => m.id === selected) ?? null;
  const signedIn = view === 'app';

  return <div className="shell">
    <header><div className="brand"><span className="mark" aria-hidden="true">C</span><span>Cuelga</span></div></header>
    <main>
      {view === 'loading' && <p role="status">Cargando…</p>}

      {view === 'offline' && <section>
        <h1 ref={heading} tabIndex={-1}>Sin conexión</h1>
        <p className="intro">No pudimos conectar con Cuelga. Revisa tu conexión a internet y vuelve a intentar.</p>
        <button onClick={() => void load()}>Reintentar</button>
      </section>}

      {view === 'disabled' && <section>
        <h1 ref={heading} tabIndex={-1}>Cuelga está en preparación</h1>
        <p className="intro">El servicio todavía no está abierto. Vuelve a intentar más tarde.</p>
        <button onClick={() => void load()}>Reintentar</button>
      </section>}

      {view === 'unavailable' && <section>
        <h1 ref={heading} tabIndex={-1}>El servicio no está disponible</h1>
        <p className="intro">No pudimos cargar tu cuenta. Vuelve a intentar en unos minutos.</p>
        <button disabled={busy} onClick={() => void submit(load)}>Reintentar</button>
      </section>}

      {view === 'welcome' && <section>
        <p className="eyebrow">REVISA ANTES DE ACTUAR</p>
        <h1 ref={heading} tabIndex={-1}>Antes de devolver la llamada.</h1>
        <p className="intro">Crea tu cuenta para revisar el SMS, WhatsApp o link que te llegó. También puedes reclamar llamadas desviadas al buzón y leer qué te pedían, si aceptas que se pasen a texto. Cuelga es gratis.</p>
        <div className="actions">
          <button onClick={() => { setNotice(''); setView('login'); }}>Entrar</button>
          <button className="secondary" onClick={() => { setNotice(''); setView('register'); }}>Crear cuenta</button>
        </div>
      </section>}

      {view === 'login' && <form onSubmit={e => { e.preventDefault(); void login(); }}>
        <h1 ref={heading} tabIndex={-1}>Entrar</h1>
        <Field id="login-id" label="Correo" type="email" value={identifier} onChange={setIdentifier} autoComplete="username" />
        <Field id="login-pass" label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="actions">
          <button disabled={busy || !identifier.trim() || !password}>Entrar</button>
          <button type="button" className="link" onClick={() => setView('welcome')}>Volver</button>
        </div>
      </form>}

      {view === 'register' && <form onSubmit={e => { e.preventDefault(); void register(); }}>
        <h1 ref={heading} tabIndex={-1}>Crear cuenta</h1>
        <p className="intro">Crea tu cuenta con tu correo y una contraseña. No necesitas invitación.</p>
        <Field id="reg-id" label="Correo" type="email" value={identifier} onChange={setIdentifier} autoComplete="username" />
        <Field id="reg-pass" label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="Al menos 8 caracteres." />
        <section className="notice-box" aria-labelledby="notice-title">
          <h2 id="notice-title">Aviso de datos</h2>
          {DATA_NOTICE.map(line => <p key={line}>{line}</p>)}
        </section>
        <label className="check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /> <span>Leí y acepto el aviso de datos.</span></label>
        <div className="actions">
          <button disabled={busy || !identifier.trim() || !password || !accepted}>Crear cuenta</button>
          <button type="button" className="link" onClick={() => setView('welcome')}>Volver</button>
        </div>
      </form>}

      {view === 'consent' && <section>
        <h1 ref={heading} tabIndex={-1}>Antes de empezar</h1>
        <p className="intro">Cuando alguien deja un mensaje en tu buzón, Cuelga puede pasarlo a texto y resumir qué te pedían.</p>
        <ul className="plain">
          <li><strong>Zadarma</strong> recibe la llamada que desvías, graba el mensaje y, si aceptas, lo pasa a texto.</li>
          <li><strong>Anthropic (Claude)</strong> recibe el texto y escribe el resumen.</li>
        </ul>
        <p>¿Aceptas que Zadarma pase tus mensajes a texto y que Anthropic (Claude) reciba ese texto para resumirlo?</p>
        <p className="muted">Si no aceptas, igual te avisamos que tienes un mensaje de voz, con el número y la hora, pero sin texto ni resumen. El borrado del audio en Zadarma y de posibles copias por correo requiere gestión manual del equipo; no es automático ni inmediato. Puedes cambiarlo cuando quieras en Tus datos.</p>
        <div className="actions">
          <button disabled={busy} onClick={() => void chooseConsent(true)}>Acepto</button>
          <button className="secondary" disabled={busy} onClick={() => void chooseConsent(false)}>No, sólo avisarme</button>
        </div>
      </section>}

      {view === 'finish-deletion' && <form onSubmit={e => { e.preventDefault(); void deleteAccount(); }}>
        <h1 ref={heading} tabIndex={-1}>Termina de borrar tu cuenta</h1>
        <p className="intro">Hay una solicitud de borrado sin confirmar. Escribe tu contraseña y reintenta para comprobar o completar el borrado.</p>
        <Field id="fin-pass" label="Contraseña" type="password" value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" />
        <button className="danger" disabled={busy || !deletePassword}>{busy ? 'Borrando…' : 'Reintentar borrado'}</button>
        <p className="muted">El comprobante del servidor dura una hora. Si vence y todavía puedes entrar, vuelve a iniciar sesión para hacer una nueva solicitud. El audio en Zadarma y las copias por correo tienen borrado manual; no podemos confirmar aquí su eliminación.</p>
        <button type="button" className="link" disabled={busy} onClick={() => void logout()}>Salir y volver a entrar</button>
      </form>}

      {signedIn && tab === 'revisar' && <section>
        <h1 ref={heading} tabIndex={-1}>Revisar mensaje o link</h1>
        <p className="intro">Pega el SMS, WhatsApp o link que te llegó. Revisamos señales de alerta; un resultado sin señales no asegura que sea legítimo.</p>
        <form onSubmit={e => { e.preventDefault(); void reviewText(); }}>
          <label htmlFor="review-text">Mensaje o link</label>
          <textarea id="review-text" rows={6} maxLength={2000} value={texto} disabled={busy} autoCorrect="off" autoCapitalize="none" spellCheck={false}
            onChange={e => { setTexto(e.target.value); setReview(null); setReviewFailed(false); }} aria-describedby="review-help" />
          <p className="muted" id="review-help">Hasta 2.000 caracteres. No guardamos el texto que pegas. Se revisan hasta tres links distintos.</p>
          <button disabled={busy}>{busy ? 'Revisando…' : reviewFailed ? 'Reintentar revisión' : 'Revisar'}</button>
          <button type="button" className="link" disabled={busy} onClick={() => { setTexto(''); setReview(null); setReviewFailed(false); setNotice(''); }}>Limpiar</button>
        </form>
        {review && <section className={`review-result ${review.nivel}`} aria-live="polite" aria-label="Resultado de la revisión">
          <h2>{review.nivel === 'alto' ? 'Hay señales de alerta fuertes' : review.nivel === 'precaucion' ? 'Revisa con precaución' : 'No encontramos señales de alerta'}</h2>
          <p>No entregues claves ni códigos. Verifica por un canal oficial que ya conozcas antes de abrir un link o transferir plata.</p>
          {review.senales.map(s => <div key={s.id}><h3>{s.titulo}</h3><p>{s.explicacion}</p></div>)}
          {review.links.map((link, index) => <div className="review-link" key={index}>
            <p className="pasted-link">{link.texto}</p>
            <p>{!link.resultado ? 'No pudimos revisar este link. Vuelve a intentar más tarde.'
              : link.resultado.veredicto === 'peligroso' ? 'Link peligroso: no lo abras.'
              : link.resultado.veredicto === 'sospechoso' ? 'Link sospechoso: verifica por un canal oficial.'
              : 'No encontramos señales en este link. Eso no asegura que sea legítimo.'}</p>
            {link.resultado && <details><summary>Ver detalle del link</summary>
              <p>Sitio: {link.resultado.sitio}</p>
              {link.resultado.destino && <p>Destino: {link.resultado.destino}</p>}
              {link.resultado.senales.map(s => <p key={s.id}><strong>{s.titulo}</strong>: {s.explicacion}</p>)}
              <p>{link.resultado.listaNegra === 'listado' ? 'Aparece en la lista de sitios peligrosos de URLhaus.'
                : link.resultado.listaNegra === 'no-listado' ? 'No aparece en URLhaus; la lista no cubre todas las estafas.'
                : 'No pudimos consultar URLhaus. La revisión de este link está incompleta.'}</p>
            </details>}
          </div>)}
          <p className="muted">Puedes revisar sin tope diario.</p>
        </section>}
      </section>}

      {signedIn && tab === 'buzon' && !current && <section>
        <h1 ref={heading} tabIndex={-1}>Tus llamadas</h1>
        {status && !status.plan.premium && <p className="intro">No pudimos acceder a tus llamadas ahora. Toca Actualizar llamadas para reintentar.</p>}
        {status?.plan.premium && !selected && <form onSubmit={e => { e.preventDefault(); void claimCall(); }}>
          <h2>Reclamar una llamada</h2>
          <p>Después de rechazar y desviar una llamada, escribe el número que te llamó. Buscamos la llamada sin reclamar más reciente de ese número en las últimas 24 horas. Si llamó con número oculto, no podemos identificarla.</p>
          <Field id="caller" label="Número que te llamó" type="tel" value={caller} onChange={setCaller} hint="Por ejemplo, 9 1234 5678. Para otro país, incluye + y el código de país." />
          <button disabled={busy || !caller.trim()}>Reclamar llamada</button>
        </form>}
        {status?.plan.premium && mailbox === null && <p role="status">Cargando llamadas…</p>}
        {selected && <section className="empty"><h2>Procesando tu llamada</h2><p>La llamada quedó reclamada. Estamos esperando que aparezca en tu buzón. Actualizamos mientras está pendiente.</p><button className="secondary" onClick={() => setSelected(null)}>Ver todas las llamadas</button></section>}
        {mailbox?.state === 'active' && !mailbox.messages.length && <section className="empty">
          <div className="empty-symbol" aria-hidden="true">↙</div>
          <h2>No tienes mensajes</h2>
          <p>Después de desviar una llamada, reclámala con el número que te llamó.</p>
        </section>}
        {mailbox && mailbox.messages.length > 0 && <ul className="messages">{mailbox.messages.map(m => <li key={m.id}>
          <button className="message" onClick={() => setSelected(m.id)}>
            <span className={`indicator ${m.assessment ?? 'unassessed'}`} aria-hidden="true">{m.assessment === 'attention' ? '!' : '↙'}</span>
            <span className="message-copy"><strong>{titleFor(m)}</strong>{m.summary && <span>{m.summary}</span>}<small>{m.caller ?? 'Número no disponible'} · {time(m.receivedAt)}{!m.read && ' · Nuevo'}</small></span>
            <span aria-hidden="true">›</span>
          </button></li>)}</ul>}
        <button className="secondary" disabled={busy} onClick={() => void submit(refreshMailbox)}>Actualizar llamadas</button>
      </section>}

      {signedIn && tab === 'buzon' && current && <article className="detail">
        <button className="back" onClick={() => setSelected(null)}>← Volver al buzón</button>
        <h1 ref={heading} tabIndex={-1}>{titleFor(current)}</h1>
        <p className="muted">{current.caller ?? 'Número no disponible'} · {time(current.receivedAt)}. Un número en pantalla no confirma quién llama.</p>
        <p className="muted">{current.durationSeconds === null ? 'Duración no disponible.' : `Duración: ${current.durationSeconds} segundos.`}</p>
        {current.assessment && <div className={`assessment ${current.assessment}`}>{current.assessment === 'attention' ? 'Atención al contenido' : 'Sin evaluación concluyente'}</div>}
        {current.summary && <p className="summary">{current.summary}</p>}
        {current.textStatus === 'ready' && <><h2>Lo que dejó quien llamó</h2><blockquote>{current.transcript || 'No dejó un mensaje.'}</blockquote></>}
        {current.textStatus === 'pending' && <p>Todavía no tenemos el texto de este mensaje. Igual sabes quién llamó y cuándo.</p>}
        {current.textStatus === 'failed' && <p>No pudimos pasar este mensaje a texto. Igual sabes quién llamó y cuándo.</p>}
        {current.textStatus === 'not_requested' && <p>No aceptaste que el audio se pase a texto, así que no podemos mostrar lo que dijo. Puedes cambiarlo en Tus datos para los próximos mensajes.</p>}
        <p>Si quieres devolver la llamada, hazlo por el canal oficial de esa institución, con un número que ya conozcas o que esté en su página o tu tarjeta, no al número que te llamó. Si te piden claves, códigos o dinero, no los entregues.</p>
        <button className="danger" disabled={busy} onClick={() => void deleteMessage(current.id)}>Borrar mensaje</button>
        <button className="secondary" disabled={busy} onClick={() => void submit(refreshMailbox)}>Actualizar llamada</button>
      </article>}

      {signedIn && tab === 'desvio' && <section>
        <h1 ref={heading} tabIndex={-1}>Desvío al buzón</h1>
        {status?.mailbox.forwardingNumber ? <>
          <p className="intro">Para que las llamadas que rechazas lleguen a tu buzón, marca este código una vez en la app Teléfono.</p>
          <code className="manual-code">{forwardingCode(status.mailbox.forwardingNumber)}</code>
          <ol>
            <li>Anota primero cómo está tu buzón de voz, por si quieres volver atrás.</li>
            <li>Marca el código de arriba y llama.</li>
            <li>Comprueba que quedó activo marcando <code>{forwardingCheck}</code>.</li>
            <li>Para quitarlo, marca <code>{forwardingRemove}</code>.</li>
          </ol>
          <p className="muted">La disponibilidad depende de tu compañía y plan. Consulta si permite desviar a este número; el tramo desviado puede tener costo. Cuelga no activa el desvío por ti ni abre la app Teléfono.</p>
        </> : <p className="intro">No pudimos obtener el código de desvío. Vuelve a intentar más tarde.</p>}
      </section>}

      {signedIn && tab === 'datos' && <section className="privacy">
        <h1 ref={heading} tabIndex={-1}>Tus datos</h1>
        <PublicLinks />
        <p className="muted">Cuenta: {status?.account.identifier}</p>
        <h2>Qué hace Cuelga con tus datos</h2>
        {DATA_NOTICE.map(line => <p key={line}>{line}</p>)}
        <h2>Pasar tus mensajes a texto</h2>
        <p>Zadarma recibe la llamada y graba el mensaje. Con tu permiso, Zadarma lo pasa a texto y Anthropic (Claude) recibe ese texto y lo resume.</p>
        <p>{status?.account.aiConsent === 'accepted' ? 'Aceptaste que Zadarma pase tus mensajes a texto y que Anthropic (Claude) los resuma.' : 'No aceptaste: sólo te avisamos que tienes un mensaje de voz, sin texto.'}</p>
        {consentPending
          ? <button className="secondary" disabled={busy} onClick={() => void chooseConsent(false)}>Comprobar retiro del permiso</button>
          : status?.account.aiConsent === 'accepted'
          ? <button className="secondary" disabled={busy} onClick={() => void chooseConsent(false)}>Dejar de pasarlos a texto</button>
          : <button className="secondary" disabled={busy} onClick={() => void chooseConsent(true)}>Aceptar que se pasen a texto</button>}
        <h2>Avisos</h2>
        <p>{pushState === 'registered' && deviceConfirmed ? 'Este iPhone recibirá un aviso cuando tengas un mensaje nuevo. El aviso no muestra el número ni el contenido.'
          : pushState === 'denied' ? 'Los avisos están desactivados. Igual verás tus mensajes al abrir la app. Puedes activarlos en Ajustes del iPhone.'
          : pushState === 'registered' ? 'Los avisos de Cuelga todavía no están activos. Verás tus mensajes al abrir la app.'
          : 'Verás tus mensajes al abrir la app.'}</p>
        <h2>Salir</h2>
        <button className="secondary" disabled={busy} onClick={() => void logout()}>Salir de la cuenta</button>
        <h2>Borrar tu cuenta</h2>
        <p>Se borran tu cuenta y tus mensajes guardados en Cuelga. No se puede deshacer y no necesitas escribir a soporte para iniciar el borrado.</p>
        <p>El borrado del audio en Zadarma y de posibles copias por correo sigue siendo manual; borrar aquí no confirma su eliminación. Borrar tu cuenta tampoco desactiva el desvío de tu compañía: quítalo marcando <code>{forwardingRemove}</code> en Teléfono.</p>
        <form onSubmit={e => { e.preventDefault(); void deleteAccount(); }}>
          <Field id="del-pass" label="Escribe tu contraseña para confirmar" type="password" value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" />
          <button className="danger" disabled={busy || !deletePassword}>{busy ? 'Borrando…' : 'Borrar mi cuenta'}</button>
        </form>
      </section>}

      {['welcome', 'login', 'register', 'consent', 'finish-deletion'].includes(view) && <PublicLinks />}
      <p role="status" className="status">{notice}</p>
    </main>
    {signedIn && <nav aria-label="Secciones de Cuelga">{([['revisar', 'Revisar'], ['buzon', 'Llamadas'], ['desvio', 'Desvío'], ['datos', 'Tus datos']] as const).map(([key, label]) =>
      <button key={key} disabled={busy} aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setSelected(null); setNotice(''); }}>{label}</button>)}</nav>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
