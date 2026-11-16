import { ApiError, type AppleConfig } from './api';

export interface AppleProduct {
  id: string;
  displayName: string;
  displayPrice: string;
  periodValue: number;
  periodUnit: 'day' | 'week' | 'month' | 'year';
}
export interface AppleTransaction {
  transactionId: string;
  productId: string;
  appAccountToken: string;
  signedTransaction: string;
}
export interface StoreKitBridge {
  products(options: { productId: string }): Promise<{ products: AppleProduct[] }>;
  purchase(options: { productId: string; appAccountToken: string }): Promise<{ state: 'purchased' | 'cancelled' | 'pending'; transaction?: AppleTransaction }>;
  pending(options: { productId: string }): Promise<{ transactions: AppleTransaction[] }>;
  restore(options: { productId: string }): Promise<{ transactions: AppleTransaction[] }>;
  finish(options: { transactionId: string }): Promise<void>;
  manage(): Promise<void>;
  addListener(event: 'transaction', callback: (transaction: AppleTransaction) => void): Promise<{ remove(): Promise<void> }>;
}
export interface AppleServer {
  appleConfig(): Promise<AppleConfig>;
  appleTransaction(signedTransaction: string, restore?: boolean): Promise<boolean>;
}

const unavailable = () => new ApiError('APPLE_UNAVAILABLE', 503, 'Las compras de Apple no están disponibles ahora. Vuelve a intentar más tarde.');

/** El puente nunca decide Premium: sólo el servidor confirma el derecho y después se termina la transacción. */
export class ApplePurchases {
  private revision = 0;
  private inFlight = new Map<string, Promise<boolean>>();
  constructor(private readonly server: AppleServer, private readonly bridge: StoreKitBridge | null) {}
  get available() { return this.bridge !== null; }
  invalidate() { this.revision++; this.inFlight.clear(); }

  async product(config: AppleConfig): Promise<AppleProduct | null> {
    if (!this.bridge) return null;
    const result = await this.bridge.products({ productId: config.productId });
    const product = result.products.find(p => p.id === config.productId);
    if (!product || !product.displayPrice || !product.displayName || !Number.isSafeInteger(product.periodValue)
      || product.periodValue < 1 || !['day', 'week', 'month', 'year'].includes(product.periodUnit)) throw unavailable();
    return product;
  }

  async accept(transaction: AppleTransaction, config: AppleConfig, restore = false): Promise<boolean> {
    if (!this.bridge) throw unavailable();
    if (transaction.productId !== config.productId || transaction.appAccountToken.toLowerCase() !== config.appAccountToken.toLowerCase()) {
      throw new ApiError('APPLE_NOT_YOURS', 403, 'Esta compra pertenece a otra cuenta de Cuelga. Entra con la cuenta que usaste al comprar.');
    }
    const revision = this.revision;
    const key = `${revision}:${transaction.transactionId}:${transaction.signedTransaction}`;
    const previous = this.inFlight.get(key);
    if (previous) return previous;
    const pending = (async () => {
      const premium = await this.server.appleTransaction(transaction.signedTransaction, restore);
      if (revision !== this.revision) throw new ApiError('SESSION_CHANGED', 409, 'La sesión cambió. Vuelve a entrar para comprobar tu compra.');
      await this.bridge!.finish({ transactionId: transaction.transactionId });
      return premium;
    })();
    this.inFlight.set(key, pending);
    try { return await pending; } finally { this.inFlight.delete(key); }
  }

  async purchase(): Promise<'purchased' | 'cancelled' | 'pending' | 'already-premium'> {
    if (!this.bridge) throw unavailable();
    const revision = this.revision;
    // Relee antes de abrir la hoja de Apple: un Premium recién activado tampoco se cobra otra vez.
    const config = await this.server.appleConfig();
    if (revision !== this.revision) throw new ApiError('SESSION_CHANGED', 409, 'La sesión cambió. Vuelve a intentar.');
    if (config.premium) return 'already-premium';
    const result = await this.bridge.purchase({ productId: config.productId, appAccountToken: config.appAccountToken });
    if (revision !== this.revision) throw new ApiError('SESSION_CHANGED', 409, 'La sesión cambió. Vuelve a entrar para comprobar tu compra.');
    if (result.state !== 'purchased') return result.state;
    if (!result.transaction) throw unavailable();
    const premium = await this.accept(result.transaction, config);
    if (!premium) throw new ApiError('APPLE_NOT_ACTIVE', 409, 'Apple informó la compra, pero Premium no está vigente. Toca Restaurar para comprobarla.');
    return 'purchased';
  }

  async reconcile(restore = false): Promise<number> {
    if (!this.bridge) return 0;
    const revision = this.revision;
    const config = await this.server.appleConfig();
    const result = await (restore ? this.bridge.restore({ productId: config.productId }) : this.bridge.pending({ productId: config.productId }));
    if (revision !== this.revision) return 0;
    let count = 0;
    for (const transaction of result.transactions) {
      // Otra cuenta del mismo Apple ID no puede recibir ni terminar esta compra.
      if (transaction.appAccountToken.toLowerCase() !== config.appAccountToken.toLowerCase()) continue;
      await this.accept(transaction, config, restore);
      if (revision !== this.revision) return count;
      count++;
    }
    return count;
  }

  async listen(updated: () => Promise<void>, failed: (error: unknown) => void): Promise<() => void> {
    if (!this.bridge) return () => {};
    const revision = this.revision;
    const listener = await this.bridge.addListener('transaction', transaction => {
      void (async () => {
        if (revision !== this.revision) return;
        const config = await this.server.appleConfig();
        if (revision !== this.revision || transaction.appAccountToken.toLowerCase() !== config.appAccountToken.toLowerCase()) return;
        await this.accept(transaction, config);
        if (revision === this.revision) await updated();
      })().catch(error => { if (revision === this.revision) failed(error); });
    });
    return () => { void listener.remove(); };
  }

  async manage() { if (!this.bridge) throw unavailable(); await this.bridge.manage(); }
}

export function subscriptionPeriod(product: AppleProduct): string {
  const forms = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'], year: ['año', 'años'] } as const;
  return `${product.periodValue} ${forms[product.periodUnit][product.periodValue === 1 ? 0 : 1]}`;
}
