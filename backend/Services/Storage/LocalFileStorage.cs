using Microsoft.AspNetCore.StaticFiles;

namespace DocuMind.Services.Storage;

public class LocalFileStorage : IFileStorage
{
    private readonly string _basePath;
    private readonly FileExtensionContentTypeProvider _contentTypeProvider = new();

    public LocalFileStorage(IConfiguration config)
    {
        _basePath = config["Storage:BasePath"] ?? "storage";
        _basePath = Path.GetFullPath(_basePath);
        Directory.CreateDirectory(_basePath);
    }

    public async Task<string> SaveAsync(Stream fileStream, string originalFileName, CancellationToken ct)
    {
        var safeExt = Path.GetExtension(originalFileName);
        if (string.IsNullOrWhiteSpace(safeExt)) safeExt = ".bin";

        var fileName = $"{Guid.NewGuid():N}{safeExt}";
        var fullPath = Path.Combine(_basePath, fileName);

        await using var outStream = File.Create(fullPath);
        await fileStream.CopyToAsync(outStream, ct);

        return fileName;
    }

    public bool Exists(string storagePath)
        => File.Exists(Path.Combine(_basePath, storagePath));

    public Task<(Stream Stream, string ContentType, string DownloadName)> OpenReadAsync(
        string storagePath,
        string originalFileName,
        CancellationToken ct)
    {
        var fullPath = Path.Combine(_basePath, storagePath);
        Stream s = File.OpenRead(fullPath);

        var contentType = _contentTypeProvider.TryGetContentType(originalFileName, out var ct2)
            ? ct2
            : "application/octet-stream";

        return Task.FromResult((s, contentType, originalFileName));
    }
}
