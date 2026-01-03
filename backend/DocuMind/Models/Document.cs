using System.ComponentModel.DataAnnotations;

namespace DocuMind.Models;

public class Document
{
    public Guid Id { get; set; }

    [Required, MaxLength(260)]
    public string OriginalFilename { get; set; } = default!;

    [Required, MaxLength(100)]
    public string ContentType { get; set; } = default!;

    [Required, MaxLength(500)]
    public string StoragePath { get; set; } = default!;

    public DocumentStatus Status { get; set; } = DocumentStatus.Queued;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
