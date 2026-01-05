using DocuMind.Models;

namespace DocuMind.Contracts.Dtos;

public sealed record DocumentDto(
    Guid Id,
    DocumentStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ProcessedAt,
    string? ErrorMessage
);
