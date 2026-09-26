using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace FactorioSaveRelay.Client;

internal sealed class RelayApi : IDisposable
{
    private readonly HttpClient _client;
    private readonly string _token;
    private readonly string? _registrationKey;

    public RelayApi(string address, string token, string? registrationKey = null)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && !(uri.IsLoopback && uri.Scheme == Uri.UriSchemeHttp))
            || !string.IsNullOrEmpty(uri.UserInfo) || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException("Use an HTTPS service address, or HTTP on localhost for development.");
        _client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
            { BaseAddress = uri, Timeout = TimeSpan.FromMinutes(30) };
        _token = token;
        _registrationKey = registrationKey;
    }

    public async Task<JsonElement> JsonAsync(HttpMethod method, string path, object? body = null)
    {
        using var request = NewRequest(method, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccess(response);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync());
        return document.RootElement.Clone();
    }

    public async Task PutZipAsync(string path, string lockToken, string filePath)
    {
        using var request = NewRequest(HttpMethod.Put, path);
        request.Headers.Add("X-Relay-Lock", lockToken);
        var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        request.Content = new StreamContent(stream);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        request.Content.Headers.ContentLength = stream.Length;
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccess(response);
    }

    public async Task<HttpResponseMessage> OpenDownloadAsync(string path)
    {
        using var request = NewRequest(HttpMethod.Get, path);
        var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        try { await EnsureSuccess(response); return response; }
        catch { response.Dispose(); throw; }
    }

    private HttpRequestMessage NewRequest(HttpMethod method, string path)
    {
        if (!path.StartsWith("/v1/", StringComparison.Ordinal) || path.Contains("..", StringComparison.Ordinal))
            throw new InvalidOperationException("Invalid API path.");
        var request = new HttpRequestMessage(method, path);
        if (_token.Length > 0) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        if (path == "/v1/devices/register" && !string.IsNullOrWhiteSpace(_registrationKey))
            request.Headers.Add("X-Relay-Registration-Key", _registrationKey);
        return request;
    }

    private static async Task EnsureSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        var detail = await response.Content.ReadAsStringAsync();
        try
        {
            using var json = JsonDocument.Parse(detail);
            detail = json.RootElement.GetProperty("error").GetProperty("message").GetString() ?? detail;
        }
        catch (JsonException) { }
        throw new InvalidOperationException($"Service returned {(int)response.StatusCode}: {detail}");
    }

    public void Dispose() => _client.Dispose();
}
