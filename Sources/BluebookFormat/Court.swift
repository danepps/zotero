import Foundation

/// Court parenthetical (Bluebook Tables T1/T7). Keyed off CourtListener's stable
/// `court_id`, which is far more reliable than parsing court display names.
///
/// A value of `""` means *omit the court* — e.g. the U.S. Supreme Court, where the
/// `U.S.` reporter already implies the court, so Bluebook prints only the year.
public enum Court {

    static let table: [String: String] = [
        "scotus": "",            // omit — U.S. reporter implies the court
        "ca1": "1st Cir.",
        "ca2": "2d Cir.",
        "ca3": "3d Cir.",
        "ca4": "4th Cir.",
        "ca5": "5th Cir.",
        "ca6": "6th Cir.",
        "ca7": "7th Cir.",
        "ca8": "8th Cir.",
        "ca9": "9th Cir.",
        "ca10": "10th Cir.",
        "ca11": "11th Cir.",
        "cadc": "D.C. Cir.",
        "cafc": "Fed. Cir.",
    ]

    /// Bluebook court string for a CL court id, or nil if unknown (caller prints
    /// the year-only parenthetical, which is safe though sometimes incomplete).
    public static func abbreviation(for courtID: String?) -> String? {
        guard let id = courtID else { return nil }
        return table[id]
    }

    /// The trailing parenthetical, e.g. "(9th Cir. 2018)", "(2015)" for SCOTUS,
    /// or "(2018)" when the court id is unknown. Returns nil when there's no year
    /// (Bluebook requires a date; caller decides how to degrade).
    public static func parenthetical(courtID: String?, year: Int?) -> String? {
        guard let year = year else { return nil }
        let court = abbreviation(for: courtID)
        if let court = court, !court.isEmpty {
            return "(\(court) \(year))"
        }
        // court == "" (omit, e.g. SCOTUS) or unknown -> year only.
        return "(\(year))"
    }
}
