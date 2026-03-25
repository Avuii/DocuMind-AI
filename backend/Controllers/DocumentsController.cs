using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DocuMind.Contracts.DTOs;
using DocuMind.Data;
using DocuMind.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DocuMind.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DocumentsController : ControllerBase
{
    private readonly AppDbContext _db;

    public DocumentsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpPost]
    [RequestSizeLimit(30_000_000)]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Upload([FromForm] UploadDocumentRequest request, CancellationToken ct)
    {
        var file = request.File;
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "File is required." });

        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "application/pdf",
            "image/jpeg",
            "image/png"
        };

        if (!allowed.Contains(file.ContentType))
            return BadRequest(new { error = $"Unsupported content type: {file.ContentType}" });

        var docId = Guid.NewGuid();
        var safeName = Path.GetFileName(file.FileName);

        var storageRoot = Path.Combine(AppContext.BaseDirectory, "storage");
        var docDir = Path.Combine(storageRoot, docId.ToString());
        Directory.CreateDirectory(docDir);

        var savedPath = Path.Combine(docDir, safeName);
        await using (var stream = System.IO.File.Create(savedPath))
            await file.CopyToAsync(stream, ct);

        var relativeStoragePath = Path.Combine("storage", docId.ToString(), safeName).Replace("\\", "/");

        var doc = new Document
        {
            Id = docId,
            OriginalFileName = safeName,
            ContentType = file.ContentType,
            StoragePath = relativeStoragePath,
            SizeBytes = file.Length,
            Status = DocumentStatus.Queued,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        _db.Documents.Add(doc);
        await _db.SaveChangesAsync(ct);

        return Ok(new { id = doc.Id, status = doc.Status.ToString() });
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] DocumentStatus? status, CancellationToken ct)
    {
        var query = _db.Documents
            .AsNoTracking()
            .OrderByDescending(x => x.CreatedAt)
            .AsQueryable();

        if (status.HasValue)
            query = query.Where(x => x.Status == status.Value);

        var items = await query
            .Take(100)
            .Select(x => new
            {
                x.Id,
                originalFileName = x.OriginalFileName,
                x.ContentType,
                status = x.Status.ToString(),
                x.CreatedAt,
                x.UpdatedAt,
                x.ProcessedAt
            })
            .ToListAsync(ct);

        return Ok(new { items });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var doc = await _db.Documents
            .AsNoTracking()
            .Include(x => x.Result)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

        if (doc == null)
            return NotFound();

        return Ok(new
        {
            doc.Id,
            originalFileName = doc.OriginalFileName,
            doc.ContentType,
            status = doc.Status.ToString(),
            doc.StoragePath,
            doc.SizeBytes,
            doc.CreatedAt,
            doc.UpdatedAt,
            doc.ProcessedAt,
            doc.ErrorMessage,
            result = doc.Result == null
                ? null
                : new
                {
                    rawResult = ParseJson(doc.Result.RawResultJson),
                    correctedResult = ParseJsonOrNull(doc.Result.CorrectedResultJson),
                    finalResult = ParseJson(GetFinalResultJson(doc.Result)),
                    doc.Result.ModelVersion,
                    confidenceSummary = ParseJsonOrNull(doc.Result.ConfidenceSummaryJson),
                    doc.Result.ProcessedAt
                }
        });
    }

    [HttpPut("{id:guid}/corrections")]
    public async Task<IActionResult> SaveCorrections(Guid id, [FromBody] SaveCorrectionsRequest request, CancellationToken ct)
    {
        if (request.Fields == null || request.Fields.Count == 0)
            return BadRequest(new { error = "At least one corrected field is required." });

        var doc = await _db.Documents
            .Include(x => x.Result)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

        if (doc == null)
            return NotFound();

        if (doc.Result == null)
            return BadRequest(new { error = "Document does not have extracted results yet." });

        var baseJson = GetFinalResultJson(doc.Result);
        var root = JsonNode.Parse(baseJson)?.AsObject();

        if (root == null)
            return BadRequest(new { error = "Stored result JSON is invalid." });

        if (root["fields"] is not JsonObject fieldsObject)
        {
            fieldsObject = new JsonObject();
            root["fields"] = fieldsObject;
        }

        foreach (var kv in request.Fields)
        {
            if (fieldsObject[kv.Key] is not JsonObject fieldObj)
            {
                fieldObj = new JsonObject();
                fieldsObject[kv.Key] = fieldObj;
            }

            fieldObj["value"] = JsonNode.Parse(kv.Value.GetRawText());
            fieldObj["edited"] = true;
        }

        doc.Result.CorrectedResultJson = root.ToJsonString(new JsonSerializerOptions
        {
            WriteIndented = false
        });

        doc.Result.UpdatedAt = DateTimeOffset.UtcNow;
        doc.UpdatedAt = DateTimeOffset.UtcNow;

        await _db.SaveChangesAsync(ct);

        return Ok(new
        {
            message = "Corrections saved.",
            finalResult = ParseJson(doc.Result.CorrectedResultJson)
        });
    }

    [HttpGet("{id:guid}/export/json")]
    public async Task<IActionResult> ExportJson(Guid id, CancellationToken ct)
    {
        var doc = await _db.Documents
            .AsNoTracking()
            .Include(x => x.Result)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

        if (doc == null)
            return NotFound();

        if (doc.Result == null)
            return BadRequest(new { error = "Document does not have extracted results yet." });

        var finalJson = GetFinalResultJson(doc.Result);
        var bytes = Encoding.UTF8.GetBytes(finalJson);

        return File(bytes, "application/json", $"document-{id}.json");
    }

    [HttpGet("{id:guid}/export/csv")]
    public async Task<IActionResult> ExportCsv(Guid id, CancellationToken ct)
    {
        var doc = await _db.Documents
            .AsNoTracking()
            .Include(x => x.Result)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

        if (doc == null)
            return NotFound();

        if (doc.Result == null)
            return BadRequest(new { error = "Document does not have extracted results yet." });

        var root = JsonNode.Parse(GetFinalResultJson(doc.Result))?.AsObject();
        if (root == null)
            return BadRequest(new { error = "Stored result JSON is invalid." });

        var headers = new[]
        {
            "document_id",
            "model_version",
            "vendor_name",
            "invoice_date",
            "total_amount",
            "currency",
            "tax_amount"
        };

        var values = new[]
        {
            doc.Id.ToString(),
            root["model_version"]?.ToJsonString().Trim('"') ?? doc.Result.ModelVersion,
            GetFieldValueAsPlainString(root, "vendor_name"),
            GetFieldValueAsPlainString(root, "invoice_date"),
            GetFieldValueAsPlainString(root, "total_amount"),
            GetFieldValueAsPlainString(root, "currency"),
            GetFieldValueAsPlainString(root, "tax_amount")
        };

        var csv = new StringBuilder();
        csv.AppendLine(string.Join(",", headers.Select(EscapeCsv)));
        csv.AppendLine(string.Join(",", values.Select(EscapeCsv)));

        var bytes = Encoding.UTF8.GetBytes(csv.ToString());
        return File(bytes, "text/csv", $"document-{id}.csv");
    }

    private static string GetFinalResultJson(DocumentResult result)
    {
        return string.IsNullOrWhiteSpace(result.CorrectedResultJson)
            ? result.RawResultJson
            : result.CorrectedResultJson;
    }

    private static string GetFieldValueAsPlainString(JsonObject root, string fieldName)
    {
        var node = root["fields"]?[fieldName]?["value"];
        if (node == null)
            return string.Empty;

        var json = node.ToJsonString();

        if (json.StartsWith("\"") && json.EndsWith("\""))
            return JsonSerializer.Deserialize<string>(json) ?? string.Empty;

        return json;
    }

    private static string EscapeCsv(string value)
    {
        if (value.Contains('"'))
            value = value.Replace("\"", "\"\"");

        if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
            return $"\"{value}\"";

        return value;
    }

    private static object ParseJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static object? ParseJsonOrNull(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}