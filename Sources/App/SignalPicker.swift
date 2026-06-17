#if canImport(AppKit)
import SwiftUI
import BluebookFormat

/// Keyboard-navigable signal overlay (⌃S). Shows each signal in italic preview,
/// capitalized variant first (for sentence-initial use) then lowercase — matching
/// the bluebook-signals plugin's ordering. ↑/↓ to move, ⏎ to choose, Esc to close.
struct SignalPicker: View {
    let signals: [Signal]
    var onChoose: (Signal) -> Void

    @State private var selection = 0
    @FocusState private var focused: Bool

    /// Capitalized variants first, then lowercase — same as the plugin.
    private var ordered: [Signal] {
        signals.map(\.capitalized) + signals
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(ordered.enumerated()), id: \.offset) { index, signal in
                Text(signal.text)
                    .italic()
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(index == selection ? Color.accentColor.opacity(0.25) : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
        .padding(6)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .frame(width: 220)
        .focusable()
        .focused($focused)
        .onAppear { focused = true }
        .onKeyPress(.upArrow) { selection = max(0, selection - 1); return .handled }
        .onKeyPress(.downArrow) { selection = min(ordered.count - 1, selection + 1); return .handled }
        .onKeyPress(.return) { onChoose(ordered[selection]); return .handled }
    }
}
#endif
