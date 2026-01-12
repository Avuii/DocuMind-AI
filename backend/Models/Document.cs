using System.ComponentModel.DataAnnotations;

namespace DocuMind.Models;

public class Document
{
    public Guid Id { get; set; }

    [Required, MaxLength(260)]
    public string OriginalFileName { get; set; } = default!;

    [Required, MaxLength(100)]
    public string ContentType { get; set; } = default!;

    [Required, MaxLength(500)]
    public string StoragePath { get; set; } = default!;   // np. "storage/{id}/plik.pdf"

    public long SizeBytes { get; set; }

    public DocumentStatus Status { get; set; } = DocumentStatus.Queued;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ProcessedAt { get; set; }

    public string? ErrorMessage { get; set; }
}

