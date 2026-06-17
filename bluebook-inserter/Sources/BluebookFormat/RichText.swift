import Foundation

/// A minimal styled-text model: an ordered list of runs, each either roman or
/// italic. The formatter assembles a citation as `RichText`, then projects it to
/// plain text (for plain-text paste targets) and to RTF (for rich targets that
/// keep the italics — Word, Pages, Mail, browser contenteditable).
///
/// RTF italic/escaping follows the same citeproc-js conventions the Zotero
/// `bluebook-citations-fixer` plugin emits (italic = `{\i{}TEXT}`; escape
/// `\ { }`; non-ASCII as `\uN{}`), so the output matches what that pipeline
/// already produces downstream.
public struct RichText: Equatable {
    public struct Run: Equatable {
        public var text: String
        public var italic: Bool
        public init(_ text: String, italic: Bool = false) {
            self.text = text
            self.italic = italic
        }
    }

    public private(set) var runs: [Run]

    public init(_ runs: [Run] = []) { self.runs = runs }

    public static func roman(_ s: String) -> RichText { RichText([Run(s, italic: false)]) }
    public static func italic(_ s: String) -> RichText { RichText([Run(s, italic: true)]) }

    public mutating func append(_ s: String, italic: Bool = false) {
        guard !s.isEmpty else { return }
        runs.append(Run(s, italic: italic))
    }

    public mutating func append(_ other: RichText) {
        runs.append(contentsOf: other.runs)
    }

    public static func + (lhs: RichText, rhs: RichText) -> RichText {
        var out = lhs
        out.append(rhs)
        return out
    }

    /// Unstyled projection — what a plain-text field receives.
    public var plainText: String {
        runs.map(\.text).joined()
    }

    /// RTF body fragment (no document wrapper). Useful in tests and when embedding.
    public var rtfBody: String {
        runs.map { run in
            let escaped = RichText.escapeRTF(run.text)
            // `{\i{}TEXT}` — the empty group is the control-word delimiter, matching
            // citeproc-js / the bluebook-citations-fixer plugin's RTF output.
            return run.italic ? "{\\i{}\(escaped)}" : escaped
        }.joined()
    }

    /// A complete RTF document suitable for `NSPasteboard` (`.rtf` type).
    public var rtfDocument: String {
        "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0 "
            + rtfBody + "}"
    }

    /// Escape a literal string for RTF: backslash/braces, then non-ASCII as
    /// `\uN{}` (decimal codepoint) per the citeproc-js convention.
    static func escapeRTF(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\\": out += "\\\\"
            case "{": out += "\\{"
            case "}": out += "\\}"
            default:
                if scalar.value < 0x80 {
                    out.unicodeScalars.append(scalar)
                } else {
                    out += "\\u\(scalar.value){}"
                }
            }
        }
        return out
    }
}
