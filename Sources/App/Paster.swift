#if canImport(AppKit)
import AppKit
import BluebookFormat

/// Paste-back: put the formatted citation on the pasteboard as **both** RTF (italics
/// preserved for Word/Pages/Mail/contenteditable) and plain string (graceful
/// degradation), then reactivate the previously-frontmost app and synthesize ⌘V.
///
/// This is the Raycast/Alfred approach and the most reliable cross-app insertion
/// method; it depends on the Accessibility permission (see `Permissions`).
enum Paster {

    /// Writes both flavors to the general pasteboard.
    static func writeToPasteboard(_ rich: RichText) {
        let pb = NSPasteboard.general
        pb.clearContents()
        if let rtfData = rich.rtfDocument.data(using: .utf8) {
            pb.setData(rtfData, forType: .rtf)
        }
        pb.setString(rich.plainText, forType: .string)
    }

    /// Reactivate `app`, then post a ⌘V key-down/up via a private event source so
    /// it lands in the now-frontmost app. Caller must have dismissed our panel
    /// first so focus actually returns to the target.
    static func paste(into app: NSRunningApplication?) {
        app?.activate(options: [])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            synthesizeCmdV()
        }
    }

    private static func synthesizeCmdV() {
        guard Permissions.isTrusted else {
            Permissions.ensureTrusted(prompt: true)
            return
        }
        let source = CGEventSource(stateID: .combinedSessionState)
        let vKey: CGKeyCode = 0x09 // "v"
        let down = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: true)
        down?.flags = .maskCommand
        let up = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: false)
        up?.flags = .maskCommand
        down?.post(tap: .cgAnnotatedSessionEventTap)
        up?.post(tap: .cgAnnotatedSessionEventTap)
    }
}
#endif
