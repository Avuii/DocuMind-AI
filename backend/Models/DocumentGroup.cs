using System.ComponentModel.DataAnnotations;

namespace DocuMind.Models;

public class DocumentGroup
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    [MaxLength(60)]
    public string Name { get; set; } = "";
    [MaxLength(60)]
    public string NormalizedName { get; set; } = "";
    [MaxLength(12)]
    public string Color { get; set; } = "";
}
