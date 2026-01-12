using Microsoft.AspNetCore.Mvc;

namespace DocuMind.Models;

public class UploadDocumentRequest
{
    [FromForm(Name = "file")]
    public IFormFile File { get; set; } = default!;
}
