#if canImport(AppKit)
import AppKit

// SPM executable entry point. We drive NSApplication directly (rather than @main
// SwiftUI App) so the agent can run headless with a floating panel and no main
// window. LSUIElement is also declared in the bundle Info.plist (see README).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
#else
// Non-macOS toolchains (e.g. CI on Linux) can still build/test the pure
// BluebookFormat library; the agent app itself is macOS-only.
print("bluebook-inserter is a macOS app; build on macOS.")
#endif
