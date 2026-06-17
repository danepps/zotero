import Foundation

/// Assembles a full Bluebook **case** citation as `RichText`:
///
///   [<italic signal> ]<name>, <vol> <reporter> <page>[, <pincite>] (<court> <year>).
///
/// e.g. `See Obergefell v. Hodges, 576 U.S. 644, 681 (2015).`
///
/// Pure and deterministic: given a `CaseRecord` + options it returns styled text
/// you can paste as RTF (italics preserved) or plain (degraded). No UI/network.
public enum CaseCitation {

    public struct Options {
        public var style: CitationStyle
        public var signal: Signal?
        public var pincite: String?
        public init(style: CitationStyle = .lawReview,
                    signal: Signal? = nil,
                    pincite: String? = nil) {
            self.style = style
            self.signal = signal
            self.pincite = pincite
        }
    }

    public enum FormatError: Error, Equatable {
        case noReporter        // unpublished / no usable reporter citation
        case noYear
    }

    /// Build the citation. Throws when the record can't yield a valid full cite
    /// (no reporter, or no date) so the caller can grey the result out rather
    /// than paste something malformed.
    public static func format(_ record: CaseRecord, options: Options = Options()) throws -> RichText {
        guard let citation = Reporter.primary(from: record.citations),
              let reporterText = Reporter.render(citation, pincite: options.pincite) else {
            throw FormatError.noReporter
        }
        guard let parenthetical = Court.parenthetical(courtID: record.courtID, year: record.year) else {
            throw FormatError.noYear
        }

        var out = RichText()

        // Signal (always italic), with a trailing space.
        if let signal = options.signal, !signal.text.isEmpty {
            out.append(signal.text, italic: true)
            out.append(" ")
        }

        // Case name (italic vs roman per style; procedural phrases stay italic).
        out.append(CaseName.render(record.name, style: options.style))

        // ", <vol> <reporter> <page>[, <pincite>] (<court> <year>)."
        out.append(", \(reporterText) \(parenthetical).")

        return out
    }
}
