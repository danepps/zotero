#if canImport(AppKit)
import AppKit
import SwiftUI
import BluebookFormat
import CourtListener
import KeyboardShortcuts

/// Agent (LSUIElement) app delegate: owns the menu-bar item, the global hotkey,
/// and the floating search panel. Captures the frontmost app before showing the
/// panel so paste-back can restore focus.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var panel: SearchPanel?
    private var model: SearchViewModel?
    private var priorApp: NSRunningApplication?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // no Dock icon (also set LSUIElement)

        // Nudge the Accessibility permission early so paste-back works on first use.
        Permissions.ensureTrusted(prompt: true)

        setUpMenuBar()
        setUpPanel()

        KeyboardShortcuts.onKeyUp(for: .summon) { [weak self] in
            self?.togglePanel()
        }
    }

    private func setUpMenuBar() {
        let item = NSStatusItem.let_make()
        item.button?.image = NSImage(systemSymbolName: "quote.bubble", accessibilityDescription: "Bluebook")
        let menu = NSMenu()
        menu.addItem(withTitle: "Search…", action: #selector(togglePanel), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.items.forEach { $0.target = self }
        item.menu = menu
        statusItem = item
    }

    private func setUpPanel() {
        let client = SearchClient(apiKey: AppSettings.shared.apiKey)
        let model = SearchViewModel(client: client)
        self.model = model
        let view = SearchView(model: model) { [weak self] rich in
            self?.insert(rich)
        }
        panel = SearchPanel(rootView: view)
    }

    @objc private func togglePanel() {
        guard let panel else { return }
        if panel.isVisible {
            panel.orderOut(nil)
            return
        }
        // Remember who had focus so we can paste back into it.
        priorApp = NSWorkspace.shared.frontmostApplication
        // Reset transient state for a fresh invocation.
        model?.query = ""
        model?.results = []
        model?.pincite = ""
        model?.signal = nil
        model?.statusMessage = nil
        NSApp.activate(ignoringOtherApps: true)
        panel.center()
        panel.makeKeyAndOrderFront(nil)
    }

    private func insert(_ rich: RichText) {
        Paster.writeToPasteboard(rich)
        panel?.orderOut(nil)
        Paster.paste(into: priorApp)
    }
}

private extension NSStatusItem {
    static func let_make() -> NSStatusItem {
        NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    }
}
#endif
