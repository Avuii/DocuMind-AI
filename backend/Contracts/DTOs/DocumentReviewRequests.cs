using System.Text.Json;

namespace DocuMind.Contracts.DTOs;

public record UpdateReviewRequest(string[] Tags, bool? Reviewed = null, bool PreviewChecked = false,
    Dictionary<string, JsonElement>? Fields = null);

public record AskDocumentRequest(string Question);

public record SetDocumentGroupRequest(Guid? GroupId);
