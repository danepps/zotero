import Foundation

/// Citation-style mode. Bluebook italicizes the *full* case name in court
/// documents and briefs, but **not** in law-review footnote citations (there the
/// full name is roman; only short forms, procedural phrases, and textual
/// references are italicized). This flag drives that difference.
public enum CitationStyle: Equatable {
    case lawReview       // full case name roman  (default)
    case courtDocument   // full case name italic

    public var italicizeFullName: Bool { self == .courtDocument }
}

/// A reporter citation (one of possibly several parallel cites for a case).
public struct ReporterCitation: Equatable {
    /// Rough Bluebook precedence for picking the citation to print.
    public enum Kind: Int, Equatable, Comparable {
        case official = 0    // e.g. U.S. — preferred
        case neutral = 1     // vendor-neutral / public-domain
        case regional = 2    // e.g. S. Ct., regional reporters
        case specialty = 3
        case unknown = 4
        public static func < (l: Kind, r: Kind) -> Bool { l.rawValue < r.rawValue }
    }

    public var volume: String
    public var reporter: String   // already near-Bluebook from CL, e.g. "U.S.", "F.3d"
    public var page: String
    public var kind: Kind

    public init(volume: String, reporter: String, page: String, kind: Kind = .unknown) {
        self.volume = volume
        self.reporter = reporter
        self.page = page
        self.kind = kind
    }
}

/// Source-agnostic case input the formatter consumes. The `CourtListener` module
/// maps CL's JSON onto this; the formatter never sees the wire format.
public struct CaseRecord: Equatable {
    public var name: String                 // raw, e.g. "Obergefell v. Hodges"
    public var citations: [ReporterCitation]
    public var courtID: String?             // CL stable id, e.g. "scotus", "ca9"
    public var year: Int?
    public var docketNumber: String?

    public init(name: String,
                citations: [ReporterCitation],
                courtID: String? = nil,
                year: Int? = nil,
                docketNumber: String? = nil) {
        self.name = name
        self.citations = citations
        self.courtID = courtID
        self.year = year
        self.docketNumber = docketNumber
    }

    /// Preferred reporter to print: lowest `Kind` rawValue (official first).
    public var preferredCitation: ReporterCitation? {
        citations.min { $0.kind < $1.kind }
    }
}
