import Capacitor
import StoreKit
import UIKit

@objc(CuelgaStoreKitPlugin)
public class CuelgaStoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CuelgaStoreKitPlugin"
    public let jsName = "CuelgaStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise)
    ]

    private var updates: Task<Void, Never>?
    // Se toca sólo desde tareas MainActor. Nunca persiste ni imprime recibos.
    private var unfinished: [String: Transaction] = [:]

    public override func load() {
        updates = Task { @MainActor [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                guard let self = self, let payload = self.payload(result) else { continue }
                self.notifyListeners("transaction", data: payload, retainUntilConsumed: true)
            }
        }
    }

    deinit { updates?.cancel() }

    @MainActor private func payload(_ result: VerificationResult<Transaction>) -> [String: Any]? {
        guard case .verified(let transaction) = result,
              let account = transaction.appAccountToken else { return nil }
        let transactionId = String(transaction.id)
        unfinished[transactionId] = transaction
        return ["transactionId": transactionId, "productId": transaction.productID,
                "appAccountToken": account.uuidString.lowercased(),
                "signedTransaction": result.jwsRepresentation]
    }

    @objc func products(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("No pudimos consultar Premium.", "APPLE_INVALID_PRODUCT"); return
        }
        Task { @MainActor in
            do {
                let products = try await Product.products(for: [productId])
                let values: [[String: Any]] = products.compactMap { product in
                    guard product.type == .autoRenewable, let period = product.subscription?.subscriptionPeriod else { return nil }
                    let unit: String
                    switch period.unit {
                    case .day: unit = "day"
                    case .week: unit = "week"
                    case .month: unit = "month"
                    case .year: unit = "year"
                    @unknown default: return nil
                    }
                    return ["id": product.id, "displayName": product.displayName,
                            "displayPrice": product.displayPrice, "periodValue": period.value, "periodUnit": unit]
                }
                call.resolve(["products": values])
            } catch { call.reject("No pudimos consultar el precio de Apple. Vuelve a intentar.", "APPLE_UNAVAILABLE") }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"),
              let rawAccount = call.getString("appAccountToken"), let account = UUID(uuidString: rawAccount) else {
            call.reject("No pudimos identificar tu cuenta para comprar.", "APPLE_INVALID_ACCOUNT"); return
        }
        Task { @MainActor in
            do {
                guard let product = try await Product.products(for: [productId]).first,
                      product.type == .autoRenewable else {
                    call.reject("Premium no está disponible en Apple ahora.", "APPLE_UNAVAILABLE"); return
                }
                let result = try await product.purchase(options: [.appAccountToken(account)])
                switch result {
                case .success(let verification):
                    guard let transaction = self.payload(verification) else {
                        call.reject("No pudimos verificar la compra con Apple.", "APPLE_UNVERIFIED"); return
                    }
                    // JS la envía al servidor. Se termina recién desde finish, después de su confirmación.
                    call.resolve(["state": "purchased", "transaction": transaction])
                case .userCancelled: call.resolve(["state": "cancelled"])
                case .pending: call.resolve(["state": "pending"])
                @unknown default: call.reject("No pudimos comprobar la compra.", "APPLE_UNAVAILABLE")
                }
            } catch { call.reject("No pudimos completar la compra. Vuelve a intentar.", "APPLE_UNAVAILABLE") }
        }
    }

    @MainActor private func transactions(productId: String) async -> [[String: Any]] {
        var result: [String: [String: Any]] = [:]
        for await verification in Transaction.unfinished {
            guard case .verified(let transaction) = verification, transaction.productID == productId,
                  let value = payload(verification) else { continue }
            result[String(transaction.id)] = value
        }
        for await verification in Transaction.currentEntitlements {
            guard case .verified(let transaction) = verification, transaction.productID == productId,
                  let value = payload(verification) else { continue }
            result[String(transaction.id)] = value
        }
        return Array(result.values)
    }

    @objc func pending(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("No pudimos comprobar tus compras.", "APPLE_INVALID_PRODUCT"); return
        }
        Task { @MainActor in call.resolve(["transactions": await self.transactions(productId: productId)]) }
    }

    @objc func restore(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("No pudimos restaurar tus compras.", "APPLE_INVALID_PRODUCT"); return
        }
        Task { @MainActor in
            do {
                // Sólo se llama después de tocar Restaurar: sync puede pedir el ingreso a Apple.
                try await AppStore.sync()
                call.resolve(["transactions": await self.transactions(productId: productId)])
            } catch { call.reject("No pudimos restaurar tus compras. Vuelve a intentar.", "APPLE_UNAVAILABLE") }
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId") else {
            call.reject("No pudimos confirmar la compra.", "APPLE_INVALID_TRANSACTION"); return
        }
        Task { @MainActor in
            if let transaction = self.unfinished[transactionId] {
                await transaction.finish()
                self.unfinished.removeValue(forKey: transactionId)
            }
            call.resolve()
        }
    }

    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !ProcessInfo.processInfo.isiOSAppOnMac,
                  let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("Abre Ajustes de Apple y entra a Suscripciones para gestionar tu plan.", "APPLE_MANAGE_UNAVAILABLE"); return
            }
            do { try await AppStore.showManageSubscriptions(in: scene); call.resolve() }
            catch { call.reject("No pudimos abrir tus suscripciones de Apple. Intenta desde Ajustes de Apple.", "APPLE_MANAGE_UNAVAILABLE") }
        }
    }
}
