import Foundation

/// Reporter selection (Bluebook Table T1). CourtListener already stores reporter
/// abbreviations in near-Bluebook form (`U.S.`, `F.3d`, `S. Ct.`), so this module
/// mostly *chooses* among parallel cites rather than reformatting them: prefer the
/// official reporter, falling back to neutral, then regional/specialty.
public enum Reporter {

    /// The single citation to print for a law-review/court full cite: the highest
    /// precedence (lowest `Kind`) available.
    public static func primary(from citations: [ReporterCitation]) -> ReporterCitation? {
        citations.min { $0.kind < $1.kind }
    }

    /// Render "<vol> <reporter> <page>[, <pincite>]" as roman text. Returns nil
    /// when volume/reporter/page aren't all present (caller falls back to the
    /// docket-number form or greys the result out).
    public static func render(_ c: ReporterCitation, pincite: String?) -> String? {
        let vol = c.volume.trimmingCharacters(in: .whitespaces)
        let rep = c.reporter.trimmingCharacters(in: .whitespaces)
        let page = c.page.trimmingCharacters(in: .whitespaces)
        guard !vol.isEmpty, !rep.isEmpty, !page.isEmpty else { return nil }
        var out = "\(vol) \(rep) \(page)"
        if let p = pincite?.trimmingCharacters(in: .whitespaces), !p.isEmpty {
            out += ", \(p)"
        }
        return out
    }
}
