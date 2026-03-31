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

        _logger.LogInformation("Sending file {FileName} to ML service at {BaseUrl}", fileName, _httpClient.BaseAddress);

        using var response = await _httpClient.PostAsync("infer", form, ct);
        var rawJson = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"ML service returned {(int)response.StatusCode}: {rawJson}");
        }

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