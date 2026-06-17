#if canImport(AppKit)
import Foundation
import BluebookFormat
import CourtListener

/// Drives the search panel: debounced CourtListener queries, result selection,
/// signal + pincite state, and final formatting. Kept separate from the view so
/// the selection/format logic is unit-testable without SwiftUI.
@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query: String = ""
    @Published var results: [SearchResult] = []
    @Published var selection: Int = 0
    @Published var pincite: String = ""
    @Published var signal: Signal? = nil
    @Published var statusMessage: String? = nil
    @Published var showingSignalPicker = false

    private let client: SearchClient
    private var searchTask: Task<Void, Never>?
    private let debounce: Duration = .milliseconds(250)

    init(client: SearchClient) {
        self.client = client
    }

    var selectedRecord: CaseRecord? {
        guard results.indices.contains(selection) else { return nil }
        return results[selection].toCaseRecord()
    }

    // MARK: keyboard-driven navigation

    func moveSelection(by delta: Int) {
        guard !results.isEmpty else { return }
        selection = min(max(0, selection + delta), results.count - 1)
    }

    // MARK: debounced search

    func queryChanged(_ newValue: String) {
        query = newValue
        searchTask?.cancel()
        let trimmed = newValue.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            return
        }
        searchTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: self.debounce)
            if Task.isCancelled { return }
            await self.runSearch(trimmed)
        }
    }

    private func runSearch(_ q: String) async {
        do {
            let hits = try await client.searchOpinions(q)
            if Task.isCancelled { return }
            self.results = hits
            self.selection = 0
            self.statusMessage = hits.isEmpty ? "No results" : nil
        } catch let SearchClient.ClientError.http(code) {
            self.statusMessage = code == 429 ? "Rate limited — try again shortly" : "Server error (\(code))"
        } catch SearchClient.ClientError.transport {
            self.statusMessage = "Offline — check your connection"
        } catch {
            self.statusMessage = "Search failed"
        }
    }

    // MARK: formatting

    /// Format the selected result, or nil if it can't yield a valid full cite
    /// (sets `statusMessage` so the panel can grey/explain).
    func formatSelected() -> RichText? {
        guard let record = selectedRecord else { return nil }
        let opts = CaseCitation.Options(
            style: AppSettings.shared.style,
            signal: signal,
            pincite: pincite.isEmpty ? nil : pincite
        )
        do {
            return try CaseCitation.format(record, options: opts)
        } catch CaseCitation.FormatError.noReporter {
            statusMessage = "No reporter citation (unpublished?) — can't format"
            return nil
        } catch {
            statusMessage = "Missing date — can't format"
            return nil
        }
    }
}
#endif
