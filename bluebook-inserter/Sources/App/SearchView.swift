#if canImport(AppKit)
import SwiftUI
import BluebookFormat
import CourtListener

/// The Spotlight-style search UI. Fully keyboard-operable:
///  • search field is focused on open; typing drives a debounced query
///  • ↑/↓ move the result selection
///  • ⌃S opens the signal picker
///  • ⇥ moves focus to the pincite field (or type `@<page>` inline — see VM)
///  • ⏎ formats the selected result and triggers insertion (`onInsert`)
///  • Esc dismisses (handled by the panel)
struct SearchView: View {
    @ObservedObject var model: SearchViewModel
    /// Called with the formatted citation when the user commits (⏎).
    var onInsert: (RichText) -> Void

    @FocusState private var searchFocused: Bool
    @FocusState private var pinciteFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            searchField
            Divider()
            resultsList
            Divider()
            footer
        }
        .frame(width: 640, height: 360)
        .overlay(alignment: .bottomLeading) {
            if model.showingSignalPicker {
                SignalPicker(signals: AppSettings.shared.signals) { chosen in
                    model.signal = chosen
                    model.showingSignalPicker = false
                    searchFocused = true
                }
                .padding(8)
            }
        }
        .onAppear { searchFocused = true }
    }

    private var searchField: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search a case…", text: Binding(
                get: { model.query },
                set: { model.queryChanged($0) }
            ))
            .textFieldStyle(.plain)
            .font(.title2)
            .focused($searchFocused)
            .onKeyPress(.upArrow) { model.moveSelection(by: -1); return .handled }
            .onKeyPress(.downArrow) { model.moveSelection(by: 1); return .handled }
            .onKeyPress(.return) { commit(); return .handled }
            .onKeyPress(.tab) { pinciteFocused = true; return .handled }
            .onKeyPress(keys: ["s"]) { press in
                guard press.modifiers.contains(.control) else { return .ignored }
                model.showingSignalPicker = true
                return .handled
            }
        }
        .padding(12)
    }

    private var resultsList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(model.results.enumerated()), id: \.offset) { index, result in
                        ResultRow(result: result, selected: index == model.selection)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(index == model.selection
                                        ? Color.accentColor.opacity(0.25) : .clear)
                            .id(index)
                            .contentShape(Rectangle())
                            .onTapGesture { model.selection = index } // mouse optional
                    }
                }
            }
            .onChange(of: model.selection) { _, new in
                withAnimation { proxy.scrollTo(new, anchor: .center) }
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if let signal = model.signal {
                Text(signal.text).italic().foregroundStyle(.secondary)
            }
            Text("pincite").foregroundStyle(.secondary)
            TextField("page", text: $model.pincite)
                .textFieldStyle(.roundedBorder)
                .frame(width: 80)
                .focused($pinciteFocused)
                .onKeyPress(.return) { commit(); return .handled }
            Spacer()
            if let msg = model.statusMessage {
                Text(msg).foregroundStyle(.orange)
            }
            Text("⌃S signal · ⏎ insert · esc").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(12)
    }

    private func commit() {
        if let rich = model.formatSelected() {
            onInsert(rich)
        }
    }
}

private struct ResultRow: View {
    let result: SearchResult
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(result.caseName ?? "—").fontWeight(selected ? .semibold : .regular)
            HStack(spacing: 8) {
                if let cite = result.citation?.first { Text(cite) }
                if let court = result.court { Text(court) }
                if let y = result.year { Text(String(y)) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}
#endif
