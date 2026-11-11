using System.ComponentModel.DataAnnotations;
using DocuMind.Services.Registries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DocuMind.Controllers;

[ApiController]
[Authorize]
[Route("api/registries")]
public class RegistriesController(RegistryClient registries) : ControllerBase
{
    [HttpPost("lookup")]
    public async Task<IActionResult> Lookup(RegistryLookup request, CancellationToken ct)
    {
        var identifier = RegistryIdentifier.Parse(request.Kind, request.Number);
        if (identifier == null)
            return BadRequest(new { error = "Enter a valid identifier for the selected type." });

        return Ok(await registries.Lookup(identifier, ct));
    }
}

public record RegistryLookup([Required, StringLength(8)] string Kind, [Required, StringLength(40)] string Number);
