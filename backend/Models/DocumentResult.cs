using System.ComponentModel.DataAnnotations;

namespace DocuMind.Models;

public class DocumentResult
{
    [Key]
    public Guid DocumentId { get; set; }

    public Document Document { get; set; } = default!;

    [Required]
    public string RawResultJson { get; set; } = "{}";

    public string? CorrectedResultJson { get; set; }

    [Required, MaxLength(100)]
    public string ModelVersion { get; set; } = "stub-v0";

    public string? ConfidenceSummaryJson { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ProcessedAt { get; set; } = DateTimeOffset.UtcNow;
}