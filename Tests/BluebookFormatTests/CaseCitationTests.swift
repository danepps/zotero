import XCTest
@testable import BluebookFormat

final class CaseCitationTests: XCTestCase {

    // MARK: fixtures

    private func obergefell(pincite: String? = nil) -> CaseRecord {
        CaseRecord(
            name: "Obergefell v. Hodges",
            citations: [ReporterCitation(volume: "576", reporter: "U.S.", page: "644", kind: .official)],
            courtID: "scotus",
            year: 2015
        )
    }

    // MARK: SCOTUS official reporter, law-review default (roman name)

    func testScotusLawReviewPlain() throws {
        let rt = try CaseCitation.format(obergefell())
        XCTAssertEqual(rt.plainText, "Obergefell v. Hodges, 576 U.S. 644 (2015).")
    }

    func testScotusLawReviewNameIsRoman() throws {
        let rt = try CaseCitation.format(obergefell())
        // Law-review full cite: no italics at all (no \i groups).
        XCTAssertFalse(rt.rtfBody.contains("\\i{}"), "law-review full name must be roman")
    }

    func testPincite() throws {
        let opts = CaseCitation.Options(style: .lawReview, pincite: "681")
        let rt = try CaseCitation.format(obergefell(), options: opts)
        XCTAssertEqual(rt.plainText, "Obergefell v. Hodges, 576 U.S. 644, 681 (2015).")
    }

    // MARK: court-document mode italicizes the full name

    func testCourtDocumentNameIsItalic() throws {
        let opts = CaseCitation.Options(style: .courtDocument, pincite: "681")
        let rt = try CaseCitation.format(obergefell(), options: opts)
        XCTAssertEqual(rt.plainText, "Obergefell v. Hodges, 576 U.S. 644, 681 (2015).")
        XCTAssertTrue(rt.rtfBody.contains("{\\i{}Obergefell v. Hodges}"),
                      "court-document full name must be italic; got \(rt.rtfBody)")
    }

    // MARK: circuit court parenthetical (T7)

    func testCircuitParenthetical() throws {
        let rec = CaseRecord(
            name: "Doe v. Roe",
            citations: [ReporterCitation(volume: "123", reporter: "F.3d", page: "456", kind: .regional)],
            courtID: "ca9",
            year: 2018
        )
        let rt = try CaseCitation.format(rec)
        XCTAssertEqual(rt.plainText, "Doe v. Roe, 123 F.3d 456 (9th Cir. 2018).")
    }

    // MARK: T6 word abbreviation, with "United States" left intact

    func testT6Abbreviation() throws {
        let rec = CaseRecord(
            name: "Standard Oil Company v. United States",
            citations: [ReporterCitation(volume: "221", reporter: "U.S.", page: "1", kind: .official)],
            courtID: "scotus",
            year: 1911
        )
        let rt = try CaseCitation.format(rec)
        XCTAssertEqual(rt.plainText, "Standard Oil Co. v. United States, 221 U.S. 1 (1911).")
    }

    func testT6MultiWordAbbreviation() throws {
        // Association -> Ass'n (curly apostrophe), National -> Nat'l.
        let abbreviated = CaseName.abbreviate("National Education Association")
        XCTAssertEqual(abbreviated, "Nat\u{2019}l Educ. Ass\u{2019}n")
    }

    // MARK: procedural phrase stays italic in BOTH modes

    func testProceduralPhraseLawReview() throws {
        let rec = CaseRecord(
            name: "In re Marriage Cases",
            citations: [ReporterCitation(volume: "183", reporter: "P.3d", page: "384", kind: .regional)],
            courtID: nil,
            year: 2008
        )
        let rt = try CaseCitation.format(rec)
        XCTAssertEqual(rt.plainText, "In re Marriage Cases, 183 P.3d 384 (2008).")
        // "In re " italic even in law-review mode; the rest roman.
        XCTAssertTrue(rt.rtfBody.contains("{\\i{}In re }"), "got \(rt.rtfBody)")
        XCTAssertTrue(rt.rtfBody.contains("Marriage Cases,"), "rest must be roman; got \(rt.rtfBody)")
    }

    func testExRelInlineItalic() throws {
        let rt = CaseName.render("Arizona ex rel. Horne v. United States", style: .lawReview)
        XCTAssertTrue(rt.rtfBody.contains("{\\i{} ex rel. }"), "got \(rt.rtfBody)")
        XCTAssertEqual(rt.plainText, "Arizona ex rel. Horne v. United States")
    }

    // MARK: signal prepend (always italic)

    func testSignalPrepend() throws {
        let opts = CaseCitation.Options(style: .lawReview,
                                        signal: Signal("see").capitalized,
                                        pincite: "681")
        let rt = try CaseCitation.format(obergefell(), options: opts)
        XCTAssertEqual(rt.plainText, "See Obergefell v. Hodges, 576 U.S. 644, 681 (2015).")
        XCTAssertTrue(rt.rtfBody.hasPrefix("{\\i{}See} "), "signal must lead, italic; got \(rt.rtfBody)")
    }

    // MARK: reporter selection prefers official over parallel cites

    func testPrefersOfficialReporter() throws {
        let rec = CaseRecord(
            name: "Brown v. Board of Education",
            citations: [
                ReporterCitation(volume: "74", reporter: "S. Ct.", page: "686", kind: .regional),
                ReporterCitation(volume: "347", reporter: "U.S.", page: "483", kind: .official),
            ],
            courtID: "scotus",
            year: 1954
        )
        let rt = try CaseCitation.format(rec)
        // "Education" abbreviates to "Educ." (T6); the point of this test is that
        // the official U.S. reporter is selected over the parallel S. Ct. cite.
        XCTAssertEqual(rt.plainText, "Brown v. Board of Educ., 347 U.S. 483 (1954).")
    }

    // MARK: degradation — no reporter / no year throw

    func testNoReporterThrows() {
        let rec = CaseRecord(name: "Unpublished v. Case", citations: [], courtID: "ca2", year: 2020)
        XCTAssertThrowsError(try CaseCitation.format(rec)) { error in
            XCTAssertEqual(error as? CaseCitation.FormatError, .noReporter)
        }
    }

    func testNoYearThrows() {
        let rec = CaseRecord(
            name: "Doe v. Roe",
            citations: [ReporterCitation(volume: "1", reporter: "U.S.", page: "1", kind: .official)],
            courtID: "scotus",
            year: nil
        )
        XCTAssertThrowsError(try CaseCitation.format(rec)) { error in
            XCTAssertEqual(error as? CaseCitation.FormatError, .noYear)
        }
    }

    // MARK: RTF escaping of non-ASCII (curly apostrophe -> \uN{})

    func testRTFEscapesCurlyApostrophe() throws {
        let rec = CaseRecord(
            name: "National Association v. Smith",
            citations: [ReporterCitation(volume: "1", reporter: "U.S.", page: "1", kind: .official)],
            courtID: "scotus",
            year: 2000
        )
        let rt = try CaseCitation.format(rec)
        // U+2019 (8217) must be escaped, not emitted raw.
        XCTAssertTrue(rt.rtfBody.contains("\\u8217{}"), "got \(rt.rtfBody)")
        XCTAssertFalse(rt.rtfBody.unicodeScalars.contains { $0.value == 0x2019 })
    }
}
