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
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
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

        // The inference client times out after two minutes. Recover claims left by a stopped worker.
        var expired = DateTimeOffset.UtcNow.AddMinutes(-10);
        await db.Documents
            .Where(d => d.Status == DocumentStatus.Processing && d.UpdatedAt < expired)
            .ExecuteUpdateAsync(update => update.SetProperty(d => d.Status, DocumentStatus.Queued), ct);

        var ids = await db.Documents
            .Where(d => d.Status == DocumentStatus.Queued)
            .OrderBy(d => d.CreatedAt)
            .Select(d => d.Id)
            .Take(3)
            .ToListAsync(ct);

        foreach (var id in ids)
        {
            var claimedAt = DateTimeOffset.UtcNow;
            var claimed = await db.Documents
                .Where(d => d.Id == id && d.Status == DocumentStatus.Queued)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(d => d.Status, DocumentStatus.Processing)
                    .SetProperty(d => d.UpdatedAt, claimedAt), ct);
            if (claimed == 0)
                continue;

            var document = await db.Documents.AsNoTracking().SingleOrDefaultAsync(
                d => d.Id == id && d.Status == DocumentStatus.Processing, ct);
            if (document == null)
                continue;

            using var claim = CancellationTokenSource.CreateLinkedTokenSource(ct);
            using var monitor = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var watching = WatchClaim(id, document.UpdatedAt, claim, monitor.Token);
            try
            {
                await processor.ProcessAsync(document, claim.Token);
            }
            catch (OperationCanceledException) when (claim.IsCancellationRequested) { }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                var message = ex.Message[..Math.Min(ex.Message.Length, 2000)];
                var failed = await db.Documents.Where(d => d.Id == id && d.Status == DocumentStatus.Processing &&
                    d.UpdatedAt == document.UpdatedAt)
                    .ExecuteUpdateAsync(update => update
                        .SetProperty(d => d.Status, DocumentStatus.Failed)
                        .SetProperty(d => d.ErrorMessage, message)
                        .SetProperty(d => d.UpdatedAt, DateTimeOffset.UtcNow), ct);
                if (failed > 0)
                    _logger.LogError(ex, "Processing failed for {Id}", id);
            }
            finally
            {
                await monitor.CancelAsync();
                await watching;
                db.ChangeTracker.Clear();
            }
        }
    }

    private async Task WatchClaim(Guid id, DateTimeOffset claimedAt, CancellationTokenSource claim, CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
            while (await timer.WaitForNextTickAsync(ct))
            {
                if (await db.Documents.AnyAsync(d => d.Id == id && d.Status == DocumentStatus.Processing &&
                    d.UpdatedAt == claimedAt, ct))
                    continue;
                await claim.CancelAsync();
                break;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not monitor extraction claim for {Id}", id);
        }
    }
}
