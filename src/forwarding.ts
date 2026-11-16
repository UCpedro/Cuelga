/** D46/D47 y revisión prompt8: instrucciones para marcar a mano; nunca producir URI tel:. */
export function forwardingCode(destination: string): string {
  if (!/^\+56[2-9][0-9]{8}$/.test(destination) || /^\+56(?:600|809)/.test(destination)) throw new Error('Número chileno con formato inválido');
  return `**67*${destination}#`;
}
/** Comprobar y quitar el desvío por ocupado (códigos estándar de la red). */
export const forwardingCheck = '*#67#';
export const forwardingRemove = '##67#';
