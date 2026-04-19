namespace Api.Features.Files;

public class FileStorageService
{
    private readonly string _basePath;

    public FileStorageService(IConfiguration config)
    {
        _basePath = config["FileStorage:BasePath"]
            ?? Path.Combine(Path.GetTempPath(), "chat-files");
    }

    public async Task<string> SaveAsync(Guid fileId, Stream content, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var dir = Path.Combine(_basePath, now.Year.ToString(), now.Month.ToString("D2"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, fileId.ToString());
        await using var fs = File.Create(path);
        await content.CopyToAsync(fs, ct);
        return path;
    }

    public Stream Open(string storagePath) => File.OpenRead(storagePath);

    public bool Exists(string storagePath) => File.Exists(storagePath);

    public void Delete(string storagePath)
    {
        if (File.Exists(storagePath))
            File.Delete(storagePath);
    }
}
