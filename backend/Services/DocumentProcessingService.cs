using System.Text.Json;
using DocuMind.Data;
using DocuMind.Models;
using Microsoft.EntityFrameworkCore;

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
        _logger.LogInformation("Processing doc {Id} (stub inference)", document.Id);

        await Task.Delay(1500, ct);

        var now = DateTimeOffset.UtcNow;

        var rawResult = new
        {
            fields = new
            {
                vendor_name = new { value = "Sklep Testowy Sp. z o.o.", confidence = 0.82m },
                invoice_date = new { value = "2026-03-23", confidence = 0.77m },
                total_amount = new { value = 123.45m, confidence = 0.91m },
                currency = new { value = "PLN", confidence = 0.88m },
                tax_amount = new { value = 23.45m, confidence = 0.69m }
            },
            model_version = "stub-v0"
        };

        var confidenceSummary = new
        {
            average = 0.81m,
            min = 0.69m,
            max = 0.91m
        };

        var rawResultJson = JsonSerializer.Serialize(rawResult);
        var confidenceSummaryJson = JsonSerializer.Serialize(confidenceSummary);

        var existingResult = await _db.DocumentResults
            .FirstOrDefaultAsync(x => x.DocumentId == document.Id, ct);

        if (existingResult is null)
        {
            var result = new DocumentResult
            {
                DocumentId = document.Id,
                RawResultJson = rawResultJson,
                CorrectedResultJson = null,
                ModelVersion = "stub-v0",
                ConfidenceSummaryJson = confidenceSummaryJson,
                CreatedAt = now,
                UpdatedAt = now,
                ProcessedAt = now
            };

            _db.DocumentResults.Add(result);
        }
        else
        {
            existingResult.RawResultJson = rawResultJson;
            existingResult.CorrectedResultJson = null;
            existingResult.ModelVersion = "stub-v0";
            existingResult.ConfidenceSummaryJson = confidenceSummaryJson;
            existingResult.UpdatedAt = now;
            existingResult.ProcessedAt = now;
        }

        document.Status = DocumentStatus.Done;
        document.ProcessedAt = now;
        document.UpdatedAt = now;
        document.ErrorMessage = null;

        await _db.SaveChangesAsync(ct);
    }
}