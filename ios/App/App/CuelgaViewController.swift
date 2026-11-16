import Capacitor

@objc(CuelgaViewController)
class CuelgaViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CuelgaSessionPlugin())
        bridge?.registerPluginInstance(CuelgaStoreKitPlugin())
    }
}
