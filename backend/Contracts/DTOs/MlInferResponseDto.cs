using System.Text.Json;
using System.Text.Json.Serialization;

namespace DocuMind.Contracts.DTOs;

public class MlInferResponseDto
{
    [JsonPropertyName("fields")]
    public Dictionary<string, MlFieldDto> Fields { get; set; } = new();

    [JsonPropertyName("model_version")]
    public string ModelVersion { get; set; } = "unknown";
}

public class MlFieldDto
{
    [JsonPropertyName("value")]
    public JsonElement Value { get; set; }

    [JsonPropertyName("confidence")]
    public decimal Confidence { get; set; }
}