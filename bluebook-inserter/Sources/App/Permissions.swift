#if canImport(AppKit)
import AppKit
import ApplicationServices

/// Accessibility (TCC) gate. Synthesizing ⌘V with `CGEvent` requires the app to be
/// trusted for Accessibility. We check on launch and before the first paste,
/// prompting the system dialog when untrusted.
enum Permissions {

    /// Whether the process is currently trusted for Accessibility.
    static var isTrusted: Bool {
        AXIsProcessTrusted()
    }

    /// Check trust, optionally prompting the user with the system dialog (which
    /// deep-links to System Settings ▸ Privacy & Security ▸ Accessibility).
    @discardableResult
    static func ensureTrusted(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }
}
#endif
