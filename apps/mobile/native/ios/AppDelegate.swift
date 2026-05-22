import Capacitor
import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(userDidTakeScreenshot),
            name: UIApplication.userDidTakeScreenshotNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(capturedDidChange),
            name: UIScreen.capturedDidChangeNotification,
            object: nil
        )
        return true
    }

    @objc private func userDidTakeScreenshot() {
        dispatchSecurityEvent(kind: "screenshot", blocked: false)
    }

    @objc private func capturedDidChange() {
        dispatchSecurityEvent(kind: UIScreen.main.isCaptured ? "screen_recording_started" : "screen_recording_stopped", blocked: false)
    }

    private func dispatchSecurityEvent(kind: String, blocked: Bool) {
        let script = """
        window.dispatchEvent(new CustomEvent('security:capture_event', {
          detail: { kind: '\(kind)', platform: 'ios', blocked: \(blocked), detectedAt: Date.now() }
        }));
        """
        if let bridgeViewController = window?.rootViewController as? CAPBridgeViewController {
            bridgeViewController.webView?.evaluateJavaScript(script)
        }
    }
}
