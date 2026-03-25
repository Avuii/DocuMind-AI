using System.Text.Json;

namespace DocuMind.Contracts.DTOs;

public class SaveCorrectionsRequest
{
    public Dictionary<string, JsonElement> Fields { get; set; } = new();
}