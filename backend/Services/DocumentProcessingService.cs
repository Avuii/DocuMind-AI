using System.Text.Json;
using DocuMind.Data;
using System.Diagnostics;
using System.Text.Json.Nodes;
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
        using var activity = new Activity("documents.extract").Start();
        activity.SetTag("document.id", document.Id);
        _logger.LogInformation("Processing document {DocumentId} with trace {TraceId}", document.Id, activity.TraceId);

        var absolutePath = Path.Combine(
            AppContext.BaseDirectory,
            document.StoragePath.Replace("/", Path.DirectorySeparatorChar.ToString()));

        if (!File.Exists(absolutePath))
            throw new FileNotFoundException($"Stored document not found: {absolutePath}");

        await using var fileStream = new FileStream(absolutePath, FileMode.Open, FileAccess.Read,
            FileShare.Read | FileShare.Delete);

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

        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        // Only the worker that still holds this claim may publish a result.
        var published = await _db.Documents
            .Where(d => d.Id == document.Id && d.Status == DocumentStatus.Processing &&
                d.UpdatedAt == document.UpdatedAt)
            .ExecuteUpdateAsync(update => update
                .SetProperty(d => d.Status, DocumentStatus.Done)
                .SetProperty(d => d.ProcessedAt, now)
                .SetProperty(d => d.UpdatedAt, now)
                .SetProperty(d => d.ErrorMessage, (string?)null), ct);
        if (published == 0)
            return;

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
            existingResult.CorrectedResultJson = ApplyCorrections(rawJson, existingResult.CorrectedResultJson);
            existingResult.RawResultJson = rawJson;
            existingResult.ModelVersion = parsed.ModelVersion;
            existingResult.ConfidenceSummaryJson = confidenceSummaryJson;
            existingResult.UpdatedAt = now;
            existingResult.ProcessedAt = now;
        }

        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    private static string? ApplyCorrections(string rawJson, string? previousCorrections)
    {
        if (previousCorrections == null ||
            JsonNode.Parse(previousCorrections)?["fields"] is not JsonObject previousFields ||
            JsonNode.Parse(rawJson) is not JsonObject root || root["fields"] is not JsonObject fields)
            return null;

        foreach (var (key, oldValue) in previousFields)
        {
            if (oldValue is not JsonObject oldField || oldField["edited"]?.GetValue<bool>() != true)
                continue;

            var field = fields[key] as JsonObject ?? new JsonObject();
            field["value"] = oldField["value"]?.DeepClone();
            field["edited"] = true;
            if (fields[key] == null)
                fields[key] = field;
        }
        return root.ToJsonString();
    }
}
