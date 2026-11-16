import React, { useEffect, useRef, useState } from 'react';

type Document = 'privacidad' | 'terminos' | 'soporte';

// Textos candidatos para el paquete iOS: requieren aprobación humana antes de enviarlo a revisión.
// Los enlaces se resuelven dentro del paquete; no llevan a páginas web con navegación comercial.
export function IosLegalLinks() {
  const [document, setDocument] = useState<Document | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (document) dialog.current?.showModal();
    else dialog.current?.close();
  }, [document]);
  return <>
    <aside className="public-links" aria-label="Información de Cuelga">
      {([['privacidad', 'Privacidad'], ['terminos', 'Términos'], ['soporte', 'Soporte']] as const).map(([id, title]) =>
        <a key={id} href={`#${id}`} onClick={event => { event.preventDefault(); setDocument(id); }}>{title}</a>)}
    </aside>
    <dialog className="legal-document" ref={dialog} onCancel={() => setDocument(null)} onClose={() => setDocument(null)}>
      <button className="secondary" onClick={() => setDocument(null)}>Cerrar</button>
      {document === 'terminos' && <>
        <h2>Términos de Cuelga Premium en iPhone</h2>
        <p>Cuelga es un proyecto académico del Grupo 74 del curso ING2030 de la Pontificia Universidad Católica de Chile. El titular de la app en App Store es Pedro San Miguel.</p>
        <p>Premium agrega el reclamo de llamadas desviadas al buzón y su lectura. Con tu permiso, los mensajes se pasan a texto y se resumen. La revisión de mensajes y links sigue disponible con tu cuenta y un cupo gratis diario; Premium elimina ese cupo.</p>
        <p>La compra en iPhone se hace con Apple. El precio, la moneda y el período son los que muestra App Store antes de confirmar. Es una suscripción con renovación automática: Apple cobra al confirmar y en cada renovación mientras no la canceles. No ofrecemos un período de prueba gratis.</p>
        <p>Puedes restaurar tus compras desde Premium → Restaurar compras usando la misma cuenta de Cuelga. Una compra no se puede trasladar a una cuenta distinta.</p>
        <p>Para gestionar o cancelar la renovación, entra a Premium → Gestionar suscripción, o a Ajustes de Apple → tu cuenta → Suscripciones. Cancelar la renovación conserva el acceso hasta la fecha de vencimiento del período pagado. Borrar tu cuenta de Cuelga no cancela la suscripción de Apple: cancélala en Apple para evitar renovaciones.</p>
        <p>Si necesitas un reembolso de una compra de Apple, solicítalo a Apple. Si Premium no se activa, toca Restaurar compras o escríbenos. No vuelvas a comprar para intentar activarlo.</p>
        <p>Cuelga revisa señales de alerta; no garantiza detectar todas las estafas ni confirma que un mensaje sea legítimo. La disponibilidad del desvío depende de tu compañía y plan; el tramo desviado puede tener costo. Cuelga no activa el desvío por ti.</p>
        <p>Contacto: <a href="mailto:cuelga.12345@gmail.com">cuelga.12345@gmail.com</a>.</p>
      </>}
      {document === 'privacidad' && <>
        <h2>Privacidad de Cuelga en iPhone</h2>
        <p>Cuelga es un proyecto académico del Grupo 74 del curso ING2030 de la Pontificia Universidad Católica de Chile. El titular de la app es Pedro San Miguel.</p>
        <p>Usamos tu correo o nombre de usuario y la información necesaria para comprobar tu contraseña, mantener la sesión y registrar tu aceptación del aviso de datos y del uso de inteligencia artificial. La app guarda la sesión en el Llavero de iOS; no guarda la contraseña.</p>
        <p>El texto de SMS, WhatsApp o links que pegas se envía a nuestro servidor para revisarlo y no se guarda, tampoco su resultado. Contamos las revisiones para aplicar el cupo gratis. Los links se consultan en URLhaus y, si son acortados, se intenta conocer su destino sin abrir la página final.</p>
        <p>En llamadas desviadas guardamos el número de quien llamó si está disponible, la hora y la duración. Zadarma recibe y graba el mensaje. Con tu permiso, Zadarma lo pasa a texto y Anthropic (Claude) recibe el texto para resumirlo. No puedes escuchar el audio desde la app. Sin permiso de IA, sólo se muestra la información de la llamada.</p>
        <p>Supabase guarda las cuentas, los mensajes y el estado de Premium; Vercel aloja el servidor. Apple procesa las compras y maneja los datos de pago. Cuelga recibe identificadores de transacción, producto, ambiente, vigencia y revocación, vinculados a tu cuenta mediante un identificador opaco; no ve tu tarjeta ni tu contraseña de Apple. Apple también entrega avisos genéricos al iPhone, sin el número ni el contenido del mensaje.</p>
        <p>Los textos y resúmenes de llamadas se conservan 90 días; puedes borrar cada mensaje antes. Las llamadas sin reclamar se pueden reclamar durante 24 horas. Retirar el permiso de IA también borra el texto, resumen y valoración anteriores. El borrado del audio en Zadarma y de posibles copias por correo requiere gestión manual del equipo; no es automático ni inmediato. Borrar en Cuelga no acredita el borrado de esas copias.</p>
        <p>Puedes borrar tu cuenta y tus mensajes en Tus datos → Borrar mi cuenta. Borrar tu cuenta no cancela la renovación de Apple ni desactiva el desvío de tu compañía; gestiona la suscripción en Apple y quita el desvío desde Teléfono. Si necesitas ayuda con tus datos o audio, escríbenos a <a href="mailto:cuelga.12345@gmail.com">cuelga.12345@gmail.com</a>.</p>
        <p>No leemos tus contactos ni tus mensajes, ni escuchamos las llamadas que contestas. No usamos publicidad ni seguimiento ni vendemos datos. Tú eliges qué texto revisar y si aceptas pasar a texto los mensajes del buzón.</p>
      </>}
      {document === 'soporte' && <>
        <h2>Soporte de Cuelga</h2>
        <p>Escríbenos a <a href="mailto:cuelga.12345@gmail.com">cuelga.12345@gmail.com</a>. No incluyas contraseñas, códigos, datos de tarjeta ni mensajes de otras personas.</p>
        <p>Si compraste con Apple y Premium no aparece, entra a la misma cuenta de Cuelga y toca Premium → Restaurar compras. Para cancelar la renovación, toca Gestionar suscripción. No necesitas comprar otra vez.</p>
        <p>Para quitar el desvío por ocupado, marca <code>##67#</code> en Teléfono y comprueba con <code>*#67#</code>. Si tenías otro buzón, consulta a tu compañía cómo restaurarlo. Borrar Cuelga no quita ese desvío.</p>
        <p>Puedes borrar tu cuenta en Tus datos. El borrado del audio en Zadarma y de posibles copias por correo requiere gestión manual del equipo: escríbenos para solicitarlo.</p>
      </>}
    </dialog>
  </>;
}
