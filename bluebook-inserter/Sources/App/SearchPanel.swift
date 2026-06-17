#if canImport(AppKit)
import AppKit
import SwiftUI

/// A nonactivating floating panel that can still become key (so its text field
/// accepts typing) while the app runs as an agent. Spotlight-style: centered,
/// borderless-ish, dismisses on Esc / resign-key.
final class SearchPanel: NSPanel {

    init(rootView: some View) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
            styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        animationBehavior = .utilityWindow

        let hosting = NSHostingView(rootView: rootView)
        contentView = hosting
    }

    // Must be overridable to true for a nonactivating panel to accept key input.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    func toggleCentered() {
        if isVisible {
            orderOut(nil)
        } else {
            center()
            makeKeyAndOrderFront(nil)
        }
    }

    override func cancelOperation(_ sender: Any?) {
        orderOut(nil) // Esc dismisses
    }
}
#endif
