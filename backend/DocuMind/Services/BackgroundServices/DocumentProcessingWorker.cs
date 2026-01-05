using DocuMind.Data;
using DocuMind.Models;
using DocuMind.Services;
using Microsoft.EntityFrameworkCore;

namespace DocuMind.Services.BackgroundServices;

public class DocumentProcessingWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DocumentProcessingWorker> _logger;

    public DocumentProcessingWorker(IServiceScopeFactory scopeFactory, ILogger<DocumentProcessingWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DocumentProcessingWorker started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessBatch(stoppingToken);
            }
            catch (Exception ex)
            {
                // Żeby worker nie umarł przez jeden błąd
                _logger.LogError(ex, "Worker loop crashed");
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }

    private async Task ProcessBatch(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var processor = scope.ServiceProvider.GetRequiredService<IDocumentProcessingService>();

        // Bierzemy kilka "Queued"
        var docs = await db.Documents
            .Where(d => d.Status == DocumentStatus.Queued)
            .OrderBy(d => d.CreatedAt)
            .Take(3)
            .ToListAsync(ct);

        foreach (var doc in docs)
        {
            try
            {
                // Rezerwujemy + ustawiamy timestamp
                doc.Status = DocumentStatus.Processing;
                doc.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);

                await processor.ProcessAsync(doc, ct);

                // Jeśli serwis nie ustawił statusu, to ustawiamy domyślnie
                if (doc.Status == DocumentStatus.Processing)
                    doc.Status = DocumentStatus.Done;

                doc.ProcessedAt ??= DateTimeOffset.UtcNow;
                doc.UpdatedAt = DateTimeOffset.UtcNow;

                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Processing failed for {Id}", doc.Id);

                doc.Status = DocumentStatus.Failed;
                doc.ErrorMessage = ex.Message;
                doc.UpdatedAt = DateTimeOffset.UtcNow;

                await db.SaveChangesAsync(ct);
            }
        }
    }
}
