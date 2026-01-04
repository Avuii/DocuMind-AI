using DocuMind.Models;

namespace DocuMind.Services;

public interface IDocumentProcessingService
{
    Task ProcessAsync(Document document, CancellationToken ct);
}
