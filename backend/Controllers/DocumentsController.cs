using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DocuMind.Contracts.DTOs;
using DocuMind.Data;
using DocuMind.Models;
using DocuMind.Services.Search;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using System.IO.Compression;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DocuMind.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class DocumentsController : ControllerBase
{
    private readonly AppDbContext _db;
    private string OwnerId => User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new InvalidOperationException("The authenticated account has no ID.");
    private IQueryable<Document> OwnedDocuments => _db.Documents.Where(doc => doc.OwnerId == OwnerId);

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

        var safeName = Path.GetFileName(file.FileName.Replace('\\', '/'));
        if (string.IsNullOrWhiteSpace(safeName) || safeName.Length > 260)
            return BadRequest(new { error = "Invalid file name." });

        await using var source = file.OpenReadStream();
        var doc = await StoreUpload(source, safeName, file.ContentType, file.Length, request.BatchId, ct);
        _db.Documents.Add(doc);
        await _db.SaveChangesAsync(ct);
        return Ok(new { id = doc.Id, status = doc.Status.ToString() });
    }

    [HttpPost("archive")]
    [RequestSizeLimit(30_000_000)]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> UploadArchive([FromForm] UploadDocumentRequest request, CancellationToken ct)
    {
        var file = request.File;
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "A ZIP file is required." });

        var documents = new List<Document>();
        var skipped = new List<string>();
        try
        {
            await using var source = file.OpenReadStream();
            using var archive = new ZipArchive(source, ZipArchiveMode.Read);
            if (archive.Entries.Count > 100)
                return BadRequest(new { error = "A ZIP archive can contain up to 100 entries." });

            var entries = archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)).ToList();
            var accepted = new List<(ZipArchiveEntry Entry, string Name, string ContentType)>();
            long total = 0;
            foreach (var entry in entries)
            {
                var name = Path.GetFileName(entry.FullName.Replace('\\', '/'));
                var type = Path.GetExtension(name).ToLowerInvariant() switch
                {
                    ".pdf" => "application/pdf",
                    ".jpg" or ".jpeg" => "image/jpeg",
                    ".png" => "image/png",
                    _ => null
                };
                if (type == null || name.Length > 260 || entry.Length == 0)
                {
                    skipped.Add(name);
                    continue;
                }
                if (entry.Length > 29_000_000 || total + entry.Length > 100_000_000)
                    return BadRequest(new { error = "ZIP documents must fit within 29 MB per file and 100 MB total after unpacking." });

                total += entry.Length;
                accepted.Add((entry, name, type));
            }
            if (accepted.Count == 0)
                return BadRequest(new { error = "The ZIP contains no supported documents." });

            foreach (var (entry, name, type) in accepted)
            {
                await using var documentStream = entry.Open();
                documents.Add(await StoreUpload(documentStream, name, type, entry.Length, request.BatchId, ct));
            }
        }
        catch (InvalidDataException)
        {
            RemoveStagedFiles(documents);
            return BadRequest(new { error = "The ZIP archive is invalid or damaged." });
        }
        catch
        {
            RemoveStagedFiles(documents);
            throw;
        }

        _db.Documents.AddRange(documents);
        await _db.SaveChangesAsync(ct);
        return Ok(new { ids = documents.Select(doc => doc.Id), skipped });
    }

    private async Task<Document> StoreUpload(Stream source, string safeName, string contentType, long length,
        Guid? batchId, CancellationToken ct)
    {
        var docId = Guid.NewGuid();
        var storageRoot = Path.Combine(AppContext.BaseDirectory, "storage");
        var docDir = Path.Combine(storageRoot, docId.ToString());
        Directory.CreateDirectory(docDir);

        var savedPath = Path.Combine(docDir, "original");
        try
        {
            await using var stream = System.IO.File.Create(savedPath);
            var buffer = new byte[64 * 1024];
            long written = 0;
            int read;
            while ((read = await source.ReadAsync(buffer, ct)) != 0)
            {
                written += read;
                if (written > length)
                    throw new InvalidDataException("File exceeds its declared size.");
                await stream.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            if (written != length)
                throw new InvalidDataException("File is incomplete.");
        }
        catch
        {
            Directory.Delete(docDir, recursive: true);
            throw;
        }

        var relativeStoragePath = $"storage/{docId}/original";

        return new Document
        {
            Id = docId,
            UploadBatchId = batchId,
            OwnerId = OwnerId,
            OriginalFileName = safeName,
            ContentType = contentType,
            StoragePath = relativeStoragePath,
            SizeBytes = length,
            Status = DocumentStatus.Queued,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

    }

    private static void RemoveStagedFiles(IEnumerable<Document> documents)
    {
        foreach (var document in documents)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "storage", document.Id.ToString());
            Directory.Delete(path, recursive: true);
        }
    }

    [HttpGet("status-counts")]
    public async Task<IActionResult> StatusCounts([FromQuery] Guid? batchId, CancellationToken ct)
    {
        var query = batchId.HasValue ? OwnedDocuments.Where(doc => doc.UploadBatchId == batchId) : OwnedDocuments;
        var counts = await query
            .GroupBy(doc => doc.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToDictionaryAsync(group => group.Status, group => group.Count, ct);

        return Ok(new
        {
            queued = counts.GetValueOrDefault(DocumentStatus.Queued),
            processing = counts.GetValueOrDefault(DocumentStatus.Processing),
            done = counts.GetValueOrDefault(DocumentStatus.Done),
            failed = counts.GetValueOrDefault(DocumentStatus.Failed),
            cancelled = counts.GetValueOrDefault(DocumentStatus.Cancelled)
        });
    }

    [HttpPost("batches/{batchId:guid}/cancel")]
    public async Task<IActionResult> CancelBatch(Guid batchId, CancellationToken ct)
    {
        var cancelled = await OwnedDocuments.Where(doc => doc.UploadBatchId == batchId &&
                (doc.Status == DocumentStatus.Queued || doc.Status == DocumentStatus.Processing))
            .ExecuteUpdateAsync(update => update
                .SetProperty(doc => doc.Status, DocumentStatus.Cancelled)
                .SetProperty(doc => doc.UpdatedAt, DateTimeOffset.UtcNow), ct);
        return Ok(new { cancelled });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteDocument(Guid id, CancellationToken ct)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        if (await OwnedDocuments.Where(doc => doc.Id == id).ExecuteDeleteAsync(ct) == 0)
            return NotFound();

        var directory = Path.Combine(AppContext.BaseDirectory, "storage", id.ToString());
        var original = Path.Combine(directory, "original");
        if (Directory.Exists(directory))
        {
            // Only the app's original is removed. Roll back the row if removing it fails.
            System.IO.File.Delete(original);
            await transaction.CommitAsync(CancellationToken.None);
            try { Directory.Delete(directory); }
            catch (IOException) { /* An empty directory does not contain document data. */ }
            catch (UnauthorizedAccessException) { }
        }
        else
            await transaction.CommitAsync(CancellationToken.None);

        return Ok(new { id });
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] DocumentStatus? status,
        [FromQuery] bool? reviewed,
        [FromQuery] bool? reviewQueue,
        [FromQuery] string? search,
        [FromQuery] Guid? groupId,
        [FromQuery] Guid? batchId,
        [FromQuery] int? page,
        CancellationToken ct)
    {
        var query = OwnedDocuments
            .AsNoTracking()
            .OrderByDescending(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .AsQueryable();

        if (status.HasValue)
            query = query.Where(x => x.Status == status.Value);
        if (reviewed.HasValue)
            query = query.Where(x => x.Status == DocumentStatus.Done && x.Reviewed == reviewed.Value);
        if (reviewQueue == true)
            query = query.Where(x => !x.Reviewed &&
                (x.Status == DocumentStatus.Done || x.Status == DocumentStatus.Failed));
        if (groupId.HasValue)
            query = query.Where(x => x.GroupId == groupId.Value);
        if (batchId.HasValue)
            query = query.Where(x => x.UploadBatchId == batchId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(x => x.OriginalFileName.ToLower().Contains(term) ||
                x.Tags.Any(tag => tag.ToLower().Contains(term)));
        }

        const int pageSize = 100;
        var pageNumber = Math.Clamp(page ?? 1, 1, int.MaxValue / pageSize);

        var items = await query
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize + 1)
            .Select(x => new
            {
                x.Id,
                originalFileName = x.OriginalFileName,
                x.ContentType,
                status = x.Status.ToString(),
                x.CreatedAt,
                x.UpdatedAt,
                x.ProcessedAt,
                x.Tags,
                x.GroupId,
                x.Reviewed
            })
            .ToListAsync(ct);

        return Ok(new { items = items.Take(pageSize), hasMore = items.Count > pageSize });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var doc = await OwnedDocuments
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
            doc.Tags,
            doc.GroupId,
            doc.Reviewed,
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

    [HttpGet("{id:guid}/content")]
    public async Task<IActionResult> GetContent(Guid id, CancellationToken ct)
    {
        var doc = await OwnedDocuments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (doc == null)
            return NotFound();

        var path = Path.Combine(AppContext.BaseDirectory, doc.StoragePath);
        if (!System.IO.File.Exists(path))
            return NotFound();

        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        return PhysicalFile(path, doc.ContentType, enableRangeProcessing: true);
    }

    [HttpPut("{id:guid}/review")]
    public async Task<IActionResult> SaveReview(Guid id, UpdateReviewRequest request, CancellationToken ct)
    {
        if (request.Tags == null || request.Tags.Length > 12 ||
            request.Tags.Any(tag => string.IsNullOrWhiteSpace(tag) || tag.Trim().Length > 40))
            return BadRequest(new { error = "Provide up to 12 non-empty tags of at most 40 characters." });

        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        var doc = await LockOwnedDocument(id, ct);
        if (doc == null)
            return NotFound();
        var editing = request.Fields is { Count: > 0 };
        var approving = request.Reviewed == true && (!doc.Reviewed || editing);
        if ((editing || approving) && doc.Status is not (DocumentStatus.Done or DocumentStatus.Failed))
            return Conflict(new { error = "Review is available when processing has finished." });

        const string manualResult = """{"model_version":"manual-v1","fields":{}}""";
        var now = DateTimeOffset.UtcNow;
        if (editing || approving)
        {
            var root = JsonNode.Parse(doc.Result == null ? manualResult : GetFinalResultJson(doc.Result))!.AsObject();
            if (request.Fields is { } changes)
            {
                if (changes.Count > 40 || changes.Any(change => change.Key.Length > 80 ||
                    change.Value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.Null)))
                    return BadRequest(new { error = "Review fields must contain text, numbers or empty values." });
                ApplyFieldCorrections(root, changes);
            }
            if (approving)
            {
                var invalidFields = GetReviewIssues(root);
                if (!request.PreviewChecked || invalidFields.Count > 0)
                    return UnprocessableEntity(new
                    {
                        error = "Check the original and complete the required fields before approving.",
                        invalidFields
                    });
            }
            if (editing)
            {
                doc.Result ??= new DocumentResult
                {
                    DocumentId = doc.Id,
                    RawResultJson = manualResult,
                    ModelVersion = "manual-v1"
                };
                doc.Result.CorrectedResultJson = root.ToJsonString();
                doc.Result.UpdatedAt = now;
            }
            if (approving && doc.Status == DocumentStatus.Failed)
            {
                doc.Status = DocumentStatus.Done;
                doc.ProcessedAt = now;
                doc.ErrorMessage = null;
            }
        }

        doc.Tags = request.Tags.Select(tag => tag.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        doc.Reviewed = request.Reviewed ?? (!editing && doc.Reviewed);
        // While the worker owns the document, UpdatedAt identifies its active claim.
        if (doc.Status != DocumentStatus.Processing)
            doc.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Ok(new { doc.Tags, doc.Reviewed });
    }

    private Task<Document?> LockOwnedDocument(Guid id, CancellationToken ct) =>
        _db.Documents.FromSqlInterpolated(
            $"""SELECT * FROM "Documents" WHERE "Id" = {id} AND "OwnerId" = {OwnerId} FOR UPDATE""")
            .Include(doc => doc.Result).FirstOrDefaultAsync(ct);

    private static List<string> GetReviewIssues(JsonObject result)
    {
        var fields = result["fields"] as JsonObject;
        JsonValue? Value(string name) => (fields?[name] as JsonObject)?["value"] as JsonValue;
        string Text(string name) => Value(name) is { } value && value.TryGetValue<string>(out var text)
            ? text.Trim()
            : "";
        var issues = new List<string>();
        var kind = Text("document_type");
        if (kind is not ("invoice" or "receipt"))
            issues.Add("document_type");
        if (kind == "invoice" && Text("invoice_number").Length == 0)
            issues.Add("invoice_number");
        if (Text("vendor_name").Length == 0)
            issues.Add("vendor_name");
        if (!DateOnly.TryParseExact(Text("invoice_date"), "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out _))
            issues.Add("invoice_date");
        if (!decimal.TryParse(Value("total_amount")?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out _))
            issues.Add("total_amount");
        var currency = Text("currency");
        if (currency.Length != 3 || currency.Any(letter => letter is < 'A' or > 'Z'))
            issues.Add("currency");
        return issues;
    }

    [HttpPut("{id:guid}/group")]
    public async Task<IActionResult> SetGroup(Guid id, SetDocumentGroupRequest request, CancellationToken ct)
    {
        var doc = await OwnedDocuments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (doc == null)
            return NotFound();
        if (request.GroupId.HasValue && !await _db.DocumentGroups.AnyAsync(
            group => group.Id == request.GroupId && group.OwnerId == OwnerId, ct))
            return NotFound();

        doc.GroupId = request.GroupId;
        await _db.SaveChangesAsync(ct);
        return Ok(new { doc.GroupId });
    }

    [HttpPost("{id:guid}/analyze")]
    public async Task<IActionResult> AnalyzeAgain(Guid id, CancellationToken ct)
    {
        var updated = await OwnedDocuments.Where(doc => doc.Id == id &&
                (doc.Status == DocumentStatus.Done || doc.Status == DocumentStatus.Failed ||
                 doc.Status == DocumentStatus.Cancelled))
            .ExecuteUpdateAsync(update => update
                .SetProperty(doc => doc.Status, DocumentStatus.Queued)
                .SetProperty(doc => doc.Reviewed, false)
                .SetProperty(doc => doc.ErrorMessage, (string?)null)
                .SetProperty(doc => doc.UpdatedAt, DateTimeOffset.UtcNow), ct);
        if (updated == 1)
            return Accepted(new { id, status = DocumentStatus.Queued.ToString() });
        if (await OwnedDocuments.AnyAsync(doc => doc.Id == id, ct))
            return Conflict(new { error = "Document is already queued or processing." });
        return NotFound();
    }

    [HttpPost("{id:guid}/questions")]
    public async Task<IActionResult> Ask(Guid id, AskDocumentRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Question) || request.Question.Length > 500)
            return BadRequest(new { error = "Enter a question of at most 500 characters." });

        var doc = await OwnedDocuments.AsNoTracking().Include(x => x.Result)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (doc == null)
            return NotFound();
        if (doc.Result == null)
            return Conflict(new { error = "Document text is not available yet." });

        return Ok(DocumentSearch.Ask(doc.Result.RawResultJson, request.Question));
    }

    [HttpPut("{id:guid}/corrections")]
    public async Task<IActionResult> SaveCorrections(Guid id, [FromBody] SaveCorrectionsRequest request, CancellationToken ct)
    {
        if (request.Fields == null || request.Fields.Count == 0)
            return BadRequest(new { error = "At least one corrected field is required." });

        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        var doc = await LockOwnedDocument(id, ct);

        if (doc == null)
            return NotFound();

        if (doc.Status is DocumentStatus.Queued or DocumentStatus.Processing)
            return Conflict(new { error = "Review is available when processing has finished." });

        if (doc.Result == null)
            return BadRequest(new { error = "Document does not have extracted results yet." });

        var baseJson = GetFinalResultJson(doc.Result);
        var root = JsonNode.Parse(baseJson)?.AsObject();

        if (root == null)
            return BadRequest(new { error = "Stored result JSON is invalid." });

        ApplyFieldCorrections(root, request.Fields);
        doc.Result.CorrectedResultJson = root.ToJsonString();
        doc.Result.UpdatedAt = DateTimeOffset.UtcNow;
        doc.UpdatedAt = DateTimeOffset.UtcNow;
        doc.Reviewed = false;

        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return Ok(new
        {
            message = "Corrections saved.",
            doc.Reviewed,
            finalResult = ParseJson(doc.Result.CorrectedResultJson)
        });
    }

    private static void ApplyFieldCorrections(JsonObject root, Dictionary<string, JsonElement> fields)
    {
        if (root["fields"] is not JsonObject fieldsObject)
        {
            fieldsObject = new JsonObject();
            root["fields"] = fieldsObject;
        }

        foreach (var kv in fields)
        {
            if (fieldsObject[kv.Key] is not JsonObject fieldObj)
            {
                fieldObj = new JsonObject();
                fieldsObject[kv.Key] = fieldObj;
            }

            fieldObj["value"] = JsonNode.Parse(kv.Value.GetRawText());
            fieldObj["edited"] = true;
        }

    }

    [HttpGet("{id:guid}/export/json")]
    public async Task<IActionResult> ExportJson(Guid id, CancellationToken ct)
    {
        var doc = await OwnedDocuments
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

    [HttpGet("export/approved/{format}")]
    public async Task<IActionResult> ExportApproved(string format, CancellationToken ct)
    {
        if (format is not ("json" or "csv"))
            return NotFound();

        var documents = await OwnedDocuments.AsNoTracking()
            .Where(doc => doc.Reviewed && doc.Status == DocumentStatus.Done && doc.Result != null)
            .Include(doc => doc.Result)
            .OrderBy(doc => doc.CreatedAt).ThenBy(doc => doc.Id)
            .ToListAsync(ct);
        if (documents.Count == 0)
            return BadRequest(new { error = "No approved documents to export." });

        if (format == "json")
        {
            var payload = documents.Select(doc => new
            {
                documentId = doc.Id,
                originalFileName = doc.OriginalFileName,
                result = ParseJson(GetFinalResultJson(doc.Result!))
            });
            return File(JsonSerializer.SerializeToUtf8Bytes(payload), "application/json", "approved-documents.json");
        }

        string[] fields = [.. CsvFields, "document_type", "receipt_number", "buyer_name", "net_amount"];
        var csv = new StringBuilder();
        AppendCsvRow(csv, ["document_id", "original_file_name", "model_version", .. fields]);
        foreach (var doc in documents)
        {
            var root = JsonNode.Parse(GetFinalResultJson(doc.Result!))!.AsObject();
            AppendCsvRow(csv, [doc.Id.ToString(), doc.OriginalFileName, doc.Result!.ModelVersion,
                .. fields.Select(field => GetFieldValueAsPlainString(root, field))]);
        }
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "approved-documents.csv");
    }

    private static readonly string[] CsvFields =
        ["vendor_name", "invoice_date", "total_amount", "currency", "tax_amount", "invoice_number", "nip",
         "seller_nip", "buyer_nip", "seller_address", "buyer_address", "seller_regon", "buyer_regon",
         "seller_krs", "buyer_krs", "seller_vat_id", "buyer_vat_id", "tax_type", "seller_gst_id"];

    [HttpGet("{id:guid}/export/csv")]
    public async Task<IActionResult> ExportCsv(Guid id, CancellationToken ct)
    {
        var doc = await OwnedDocuments
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

        var csv = new StringBuilder();
        AppendCsvRow(csv, ["document_id", "model_version", .. CsvFields]);
        AppendCsvRow(csv, [doc.Id.ToString(), doc.Result.ModelVersion,
            .. CsvFields.Select(field => GetFieldValueAsPlainString(root, field))]);

        var bytes = Encoding.UTF8.GetBytes(csv.ToString());
        return File(bytes, "text/csv", $"document-{id}.csv");
    }

    private static void AppendCsvRow(StringBuilder csv, IEnumerable<string> values) =>
        csv.AppendLine(string.Join(",", values.Select(EscapeCsv)));

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
        var trimmed = value.TrimStart();
        if (trimmed.Length > 0 && trimmed[0] is '=' or '+' or '-' or '@' &&
            !decimal.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
            value = "'" + value;

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
