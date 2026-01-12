using DocuMind.Models;

namespace DocuMind.Contracts.Dtos;

public static class DocumentMappings
{
    public static DocumentDto ToDto(this Document doc) =>
        new(
            doc.Id,
            doc.Status,
            doc.CreatedAt,
            doc.ProcessedAt,
            doc.ErrorMessage
        );
}
