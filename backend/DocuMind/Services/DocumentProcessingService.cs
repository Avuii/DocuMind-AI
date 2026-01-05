using DocuMind.Data;
using DocuMind.Models;

namespace DocuMind.Services;

public class DocumentProcessingService : IDocumentProcessingService
{
    private readonly AppDbContext _db;
    private readonly ILogger<DocumentProcessingService> _logger;

    public DocumentProcessingService(AppDbContext db, ILogger<DocumentProcessingService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task ProcessAsync(Document document, CancellationToken ct)
    {
        _logger.LogInformation("Processing doc {Id} (mock)", document.Id);

        await Task.Delay(1500, ct); 

        document.Status = DocumentStatus.Done;
        document.ProcessedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
    }
}
