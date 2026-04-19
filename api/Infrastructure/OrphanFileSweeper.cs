using Api.Data;
using Api.Features.Files;
using Microsoft.EntityFrameworkCore;

namespace Api.Infrastructure;

public sealed class OrphanFileSweeper : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly FileStorageService _storage;

    public OrphanFileSweeper(IServiceProvider services, FileStorageService storage)
    {
        _services = services;
        _storage = storage;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken);
            await SweepAsync(stoppingToken);
        }
    }

    public async Task SweepAsync(CancellationToken ct = default)
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var cutoff = DateTime.UtcNow.AddHours(-1);
        var orphans = await db.FileAttachments
            .Where(f => f.MessageId == null && f.DmMessageId == null && f.CreatedAt < cutoff)
            .ToListAsync(ct);

        foreach (var orphan in orphans)
        {
            _storage.Delete(orphan.StoragePath);
            db.FileAttachments.Remove(orphan);
        }

        if (orphans.Count > 0)
            await db.SaveChangesAsync(ct);
    }
}
