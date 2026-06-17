import Foundation
import BluebookFormat

/// CourtListener v4 search API wire models (`/api/rest/v4/search/?type=o`).
/// Only the fields we consume are modeled; unknown keys are ignored.
public struct SearchResponse: Decodable {
    public let count: Int?
    public let results: [SearchResult]
}

public struct SearchResult: Decodable {
    public let caseName: String?
    public let court: String?
    public let courtId: String?
    public let dateFiled: String?      // "2015-06-26"
    public let docketNumber: String?
    public let citation: [String]?     // e.g. ["576 U.S. 644", "135 S. Ct. 2584"]

    enum CodingKeys: String, CodingKey {
        case caseName, court, dateFiled, docketNumber, citation
        case courtId = "court_id"
    }

    /// Decision year parsed from `dateFiled` (the leading four digits).
    public var year: Int? {
        guard let d = dateFiled, d.count >= 4 else { return nil }
        return Int(d.prefix(4))
    }

    /// Map this CL result onto the formatter's source-agnostic `CaseRecord`.
    public func toCaseRecord() -> CaseRecord {
        let cites = (citation ?? []).compactMap(CitationParser.parse)
        return CaseRecord(
            name: caseName ?? "",
            citations: cites,
            courtID: courtId,
            year: year,
            docketNumber: docketNumber
        )
    }
}

/// Parses CourtListener's flat citation strings ("576 U.S. 644") into the
/// structured `ReporterCitation` the formatter wants, inferring a rough Bluebook
/// `Kind` from the reporter token so the formatter can prefer the official cite.
public enum CitationParser {

    /// Reporters treated as official (preferred). Extend as needed.
    static let officialReporters: Set<String> = ["U.S.", "U.S. App.", "F. Cas."]

    public static func parse(_ s: String) -> ReporterCitation? {
        // "<volume> <reporter...> <page>" — reporter may contain spaces ("S. Ct.").
        // Volume is the leading integer; page is the trailing integer; reporter is
        // everything between.
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        let parts = trimmed.split(separator: " ").map(String.init)
        guard parts.count >= 3,
              Int(parts.first!) != nil,
              Int(parts.last!) != nil else {
            return nil
        }
        let volume = parts.first!
        let page = parts.last!
        let reporter = parts[1..<(parts.count - 1)].joined(separator: " ")
        let kind: ReporterCitation.Kind =
            officialReporters.contains(reporter) ? .official : .regional
        return ReporterCitation(volume: volume, reporter: reporter, page: page, kind: kind)
    }
}
