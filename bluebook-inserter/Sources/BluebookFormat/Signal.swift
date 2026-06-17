import Foundation

/// Introductory signals (Bluebook B1 / Rule 1). Always italicized, in both style
/// modes. The default list mirrors the companion Zotero `bluebook-signals` plugin
/// (`defaultprefs.js`) so users see the same vocabulary.
public struct Signal: Equatable {
    public var text: String   // as typed/stored, lowercase, e.g. "see", "but see"
    public init(_ text: String) { self.text = text }

    /// Capitalize the first letter for sentence-initial use, leaving the rest
    /// (e.g. "See, e.g.,") intact.
    public var capitalized: Signal {
        guard let first = text.first else { return self }
        return Signal(String(first).uppercased() + text.dropFirst())
    }

    /// Default signal vocabulary, matching the bluebook-signals plugin.
    public static let defaults: [Signal] = [
        Signal("e.g.,"),
        Signal("accord"),
        Signal("see"),
        Signal("see also"),
        Signal("see, e.g.,"),
        Signal("cf."),
        Signal("contra"),
        Signal("but see"),
        Signal("see generally"),
    ]
}
