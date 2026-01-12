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

    public DocumentsController(AppDbContext db) => _db = db;

    // Task #2: Upload document (PDF/JPG/PNG)
    [HttpPost]
    [RequestSizeLimit(30_000_000)] // 30 MB (MVP)
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

        var doc = new Document
        {
            Id = Guid.NewGuid(),
            OriginalFilename = Path.GetFileName(file.FileName),
            ContentType = file.ContentType,
            Status = DocumentStatus.Queued,
            StoragePath = "" // uzupełnimy po zapisie pliku
        };

        // storage/{docId}/filename
        var storageRoot = Path.Combine(AppContext.BaseDirectory, "storage");
        var docDir = Path.Combine(storageRoot, doc.Id.ToString());
        Directory.CreateDirectory(docDir);

        var savedPath = Path.Combine(docDir, doc.OriginalFilename);

        await using (var stream = System.IO.File.Create(savedPath))
        {
            await file.CopyToAsync(stream, ct);
        }

        doc.StoragePath = savedPath;
        doc.UpdatedAt = DateTimeOffset.UtcNow;

        _db.Documents.Add(doc);
        await _db.SaveChangesAsync(ct);

        return Ok(new { id = doc.Id, status = doc.Status.ToString() });
    }

    // Task #3: List documents (simple version, pagination later)
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] DocumentStatus? status, CancellationToken ct)
    {
        var q = _db.Documents.AsNoTracking().OrderByDescending(x => x.CreatedAt);

        if (status.HasValue)
            q = q.Where(x => x.Status == status.Value).OrderByDescending(x => x.CreatedAt);

        var items = await q
            .Select(x => new
            {
                x.Id,
                x.OriginalFilename,
                x.ContentType,
                status = x.Status.ToString(),
                x.CreatedAt,
                x.UpdatedAt
            })
            .Take(100) // MVP limit
            .ToListAsync(ct);

        return Ok(new { items });
    }

    // Task #3: Document details
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var doc = await _db.Documents.AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new
            {
                x.Id,
                x.OriginalFilename,
                x.ContentType,
                status = x.Status.ToString(),
                x.StoragePath,
                x.CreatedAt,
                x.UpdatedAt
            })
            .FirstOrDefaultAsync(ct);

        if (doc == null) return NotFound();

        return Ok(doc);
    }
}
