using System.Text.Json;
using DocuMind.Data;
using DocuMind.Models;
using Microsoft.EntityFrameworkCore;

namespace DocuMind.Services;

public class DocumentProcessingService : IDocumentProcessingService
{
    private readonly AppDbContext _db;
    private readonly IMlInferenceClient _mlInferenceClient;
    private readonly ILogger<DocumentProcessingService> _logger;

    public DocumentProcessingService(
        AppDbContext db,
        IMlInferenceClient mlInferenceClient,
        ILogger<DocumentProcessingService> logger)
    {
        _db = db;
        _mlInferenceClient = mlInferenceClient;
        _logger = logger;
    }

    public async Task ProcessAsync(Document document, CancellationToken ct)
    {
        _logger.LogInformation("Processing doc {Id} with ML OCR", document.Id);

        var absolutePath = Path.Combine(
            AppContext.BaseDirectory,
            document.StoragePath.Replace("/", Path.DirectorySeparatorChar.ToString()));

        if (!File.Exists(absolutePath))
            throw new FileNotFoundException($"Stored document not found: {absolutePath}");

        await using var fileStream = File.OpenRead(absolutePath);

        var (parsed, rawJson) = await _mlInferenceClient.InferAsync(
            document.OriginalFileName,
            document.ContentType,
            fileStream,
            ct);

        var confidenceValues = parsed.Fields.Values
            .Select(x => (double)x.Confidence)
            .ToList();

        var confidenceSummary = new
        {
            average = confidenceValues.Count == 0 ? 0 : Math.Round(confidenceValues.Average(), 2),
            min = confidenceValues.Count == 0 ? 0 : Math.Round(confidenceValues.Min(), 2),
            max = confidenceValues.Count == 0 ? 0 : Math.Round(confidenceValues.Max(), 2)
        };

        var now = DateTimeOffset.UtcNow;
        var confidenceSummaryJson = JsonSerializer.Serialize(confidenceSummary);

        var existingResult = await _db.DocumentResults
            .FirstOrDefaultAsync(x => x.DocumentId == document.Id, ct);

        if (existingResult == null)
        {
            _db.DocumentResults.Add(new DocumentResult
            {
                DocumentId = document.Id,
                RawResultJson = rawJson,
                CorrectedResultJson = null,
                ModelVersion = parsed.ModelVersion,
                ConfidenceSummaryJson = confidenceSummaryJson,
                CreatedAt = now,
                UpdatedAt = now,
                ProcessedAt = now
            });
        }
        else
        {
            existingResult.RawResultJson = rawJson;
            existingResult.CorrectedResultJson = null;
            existingResult.ModelVersion = parsed.ModelVersion;
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