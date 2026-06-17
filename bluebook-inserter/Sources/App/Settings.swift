import Foundation
import BluebookFormat
#if canImport(KeyboardShortcuts)
import KeyboardShortcuts
#endif

#if canImport(KeyboardShortcuts)
extension KeyboardShortcuts.Name {
    /// Global hotkey to summon the search panel. Default ⌘⇧-Space (user-rebindable
    /// via the recorder in Settings). Avoids Cmd-Space (Spotlight) and Ctrl-Space
    /// (input-source switch).
    static let summon = Self("summon", default: .init(.space, modifiers: [.command, .shift]))
}
#endif

/// User-facing configuration, persisted in `UserDefaults`.
final class AppSettings {
    static let shared = AppSettings()
    private let defaults = UserDefaults.standard

    private enum Key {
        static let style = "citationStyle"          // "lawReview" | "courtDocument"
        static let apiKey = "courtListenerAPIKey"
        static let signals = "signals"              // [String]
    }

    /// Citation style. Default **law-review** (full case name roman).
    var style: CitationStyle {
        get { defaults.string(forKey: Key.style) == "courtDocument" ? .courtDocument : .lawReview }
        set { defaults.set(newValue == .courtDocument ? "courtDocument" : "lawReview", forKey: Key.style) }
    }

    var apiKey: String? {
        get { defaults.string(forKey: Key.apiKey) }
        set { defaults.set(newValue, forKey: Key.apiKey) }
    }

    /// Signal vocabulary; falls back to the shared default list.
    var signals: [Signal] {
        get {
            if let raw = defaults.array(forKey: Key.signals) as? [String], !raw.isEmpty {
                return raw.map(Signal.init)
            }
            return Signal.defaults
        }
        set { defaults.set(newValue.map(\.text), forKey: Key.signals) }
    }
}
