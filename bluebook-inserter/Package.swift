// swift-tools-version: 5.9
import PackageDescription

// Standalone macOS utility: global hotkey -> floating search panel -> CourtListener
// lookup -> Bluebook case citation -> paste into the frontmost app.
//
// This package is self-contained. It shares no code with the Zotero plugins that
// live alongside it in this repo; only Bluebook *domain knowledge* carries over.
// The intent is for this to graduate into its own repository.
let package = Package(
    name: "bluebook-inserter",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "BluebookFormat", targets: ["BluebookFormat"]),
        .library(name: "CourtListener", targets: ["CourtListener"]),
        .executable(name: "bluebook-inserter", targets: ["App"]),
    ],
    dependencies: [
        // Global hotkey registration + recorder UI (wraps Carbon RegisterEventHotKey).
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", from: "2.0.0"),
    ],
    targets: [
        // Pure, dependency-free Bluebook formatter. No UI / network / OS calls, so it
        // builds and tests on any platform with a Swift toolchain.
        .target(name: "BluebookFormat"),
        // CourtListener REST client + Codable wire models. Maps CL JSON onto the
        // formatter's CaseRecord input. Foundation only.
        .target(name: "CourtListener", dependencies: ["BluebookFormat"]),
        // The agent app: menu-bar/LSUIElement, floating panel, paste-back. macOS only.
        .executableTarget(
            name: "App",
            dependencies: [
                "BluebookFormat",
                "CourtListener",
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ]
        ),
        .testTarget(name: "BluebookFormatTests", dependencies: ["BluebookFormat"]),
    ]
)
