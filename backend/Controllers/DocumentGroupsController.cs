using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.RegularExpressions;
using DocuMind.Data;
using DocuMind.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace DocuMind.Controllers;

[ApiController]
[Authorize]
[Route("api/document-groups")]
public class DocumentGroupsController(AppDbContext db) : ControllerBase
{
    private static readonly HashSet<string> Colors = ["slate", "blue", "green", "amber", "rose", "violet"];
    private string OwnerId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    private IQueryable<DocumentGroup> Groups => db.DocumentGroups.Where(group => group.OwnerId == OwnerId);

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await Groups.OrderBy(group => group.Name)
            .Select(group => new { group.Id, group.Name, group.Color }).ToListAsync(ct));

    [HttpPost]
    public Task<IActionResult> Create(GroupRequest request, CancellationToken ct) => Save(null, request, ct);

    [HttpPut("{id:guid}")]
    public Task<IActionResult> Update(Guid id, GroupRequest request, CancellationToken ct) => Save(id, request, ct);

    private async Task<IActionResult> Save(Guid? id, GroupRequest request, CancellationToken ct)
    {
        var name = request.Name.Trim();
        var color = request.Color.ToLowerInvariant();
        if (name.Length == 0 || (!Colors.Contains(color) && !Regex.IsMatch(color, @"\A#[0-9a-f]{6}\z")))
            return BadRequest(new { error = "Enter a group name and choose a color." });

        var group = id.HasValue
            ? await Groups.FirstOrDefaultAsync(group => group.Id == id, ct)
            : new DocumentGroup { Id = Guid.NewGuid(), OwnerId = OwnerId };
        if (group == null)
            return NotFound();
        if (!id.HasValue && request.DocumentId.HasValue)
        {
            var document = await db.Documents.FirstOrDefaultAsync(
                doc => doc.Id == request.DocumentId && doc.OwnerId == OwnerId, ct);
            if (document == null)
                return NotFound();
            document.GroupId = group.Id;
        }
        group.Name = name;
        group.NormalizedName = name.ToUpperInvariant();
        group.Color = color;
        if (!id.HasValue)
            db.DocumentGroups.Add(group);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict(new { error = "A group with this name already exists." });
        }
        return Ok(new { group.Id, group.Name, group.Color });
    }
}

public record GroupRequest([Required, StringLength(60)] string Name, [Required, StringLength(12)] string Color,
    Guid? DocumentId = null);
