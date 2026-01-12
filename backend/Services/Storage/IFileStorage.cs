namespace DocuMind.Services.Storage;

public interface IFileStorage
{
    Task<string> SaveAsync(Stream fileStream, string originalFileName, CancellationToken ct);
    Task<(Stream Stream, string ContentType, string DownloadName)> OpenReadAsync(string storagePath, string originalFileName, CancellationToken ct);
    bool Exists(string storagePath);
}
