using System.Net.Http.Headers;
using System.Text.Json;
using DocuMind.Contracts.DTOs;

namespace DocuMind.Services;

public class MlInferenceClient : IMlInferenceClient
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<MlInferenceClient> _logger;

    public MlInferenceClient(HttpClient httpClient, ILogger<MlInferenceClient> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<(MlInferResponseDto Parsed, string RawJson)> InferAsync(
        string fileName,
        string contentType,
        Stream fileStream,
        CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        using var streamContent = new StreamContent(fileStream);

        streamContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(streamContent, "file", fileName);

        _logger.LogDebug("Sending document to the extraction service");

        using var response = await _httpClient.PostAsync("infer", form, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Extraction service returned HTTP {(int)response.StatusCode}.");
        }
        var rawJson = await response.Content.ReadAsStringAsync(ct);

        var parsed = JsonSerializer.Deserialize<MlInferResponseDto>(rawJson, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        if (parsed == null)
        {
            throw new InvalidOperationException("ML service returned empty or invalid JSON.");
        }

        return (parsed, rawJson);
    }
}
