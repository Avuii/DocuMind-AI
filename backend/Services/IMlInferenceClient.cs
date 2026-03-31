using DocuMind.Contracts.DTOs;

namespace DocuMind.Services;

public interface IMlInferenceClient
{
    Task<(MlInferResponseDto Parsed, string RawJson)> InferAsync(
        string fileName,
        string contentType,
        Stream fileStream,
        CancellationToken ct);
}