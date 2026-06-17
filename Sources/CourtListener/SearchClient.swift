import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Async client for the CourtListener opinions search endpoint.
///
/// Auth is a free API token (`Authorization: Token <key>`) from a CL account.
/// Anonymous requests work but are rate-limited harder; an absent token is a
/// recoverable condition, not a crash.
public final class SearchClient {

    public enum ClientError: Error, Equatable {
        case missingAPIKey
        case http(Int)
        case transport(String)
    }

    private let apiKey: String?
    private let session: URLSession
    private let base = URL(string: "https://www.courtlistener.com/api/rest/v4/search/")!

    public init(apiKey: String?, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
    }

    /// Search opinions for `query`, returning decoded results. Throws on transport
    /// or non-2xx responses so the panel can surface "offline" / "rate limited".
    public func searchOpinions(_ query: String) async throws -> [SearchResult] {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "type", value: "o"),
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 10
        if let apiKey, !apiKey.isEmpty {
            request.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ClientError.transport(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw ClientError.http(http.statusCode)
        }

        return try JSONDecoder().decode(SearchResponse.self, from: data).results
    }
}
