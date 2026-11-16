import Capacitor
import Security

@objc(CuelgaSessionPlugin)
public class CuelgaSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CuelgaSessionPlugin"
    public let jsName = "CuelgaSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private var query: [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "cl.cuelga.session.v1",
                kSecAttrAccount as String: "session",
                kSecAttrSynchronizable as String: false]
    }

    @objc func get(_ call: CAPPluginCall) {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("No pudimos leer la sesión del Llavero.", "SESSION_STORAGE"); return
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), let data = value.data(using: .utf8) else {
            call.reject("No pudimos guardar la sesión.", "SESSION_STORAGE"); return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            call.reject("No pudimos guardar la sesión en el Llavero.", "SESSION_STORAGE"); return
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("No pudimos borrar la sesión del Llavero.", "SESSION_STORAGE"); return
        }
        call.resolve()
    }
}
