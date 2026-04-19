using Api.Domain;
using Api.Infrastructure;
using Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Api.Tests.Files;

public class OrphanSweeperTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public OrphanSweeperTests(TestWebApp factory) => _factory = factory;

    private OrphanFileSweeper GetSweeper() =>
        _factory.Services.GetServices<IHostedService>().OfType<OrphanFileSweeper>().First();

    [Fact]
    public async Task Sweeper_DeletesOldOrphans()
    {
        // Orphan = message_id IS NULL AND dm_message_id IS NULL AND created_at > 1h ago
        var db = _factory.CreateDbContext();
        var roomId = Guid.NewGuid(); // in-memory: FK not enforced

        var orphan = new FileAttachment
        {
            Id = Guid.NewGuid(),
            OriginalFilename = "orphan.pdf",
            ContentType = "application/pdf",
            SizeBytes = 100,
            StoragePath = "/nonexistent/orphan.pdf", // FileStorageService.Delete is no-op for missing files
            RoomId = roomId,
            MessageId = null,
            DmMessageId = null,
            CreatedAt = DateTime.UtcNow.AddHours(-2), // 2h ago — past the 1h cutoff
        };
        db.FileAttachments.Add(orphan);
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var exists = await _factory.CreateDbContext().FileAttachments
            .AnyAsync(f => f.Id == orphan.Id);
        Assert.False(exists);
    }

    [Fact]
    public async Task Sweeper_LeavesAttachedFilesAlone()
    {
        var db = _factory.CreateDbContext();
        var roomId = Guid.NewGuid();
        var msgId = Guid.NewGuid(); // in-memory: FK not enforced

        var attached = new FileAttachment
        {
            Id = Guid.NewGuid(),
            OriginalFilename = "attached.pdf",
            ContentType = "application/pdf",
            SizeBytes = 100,
            StoragePath = "/nonexistent/attached.pdf",
            RoomId = roomId,
            MessageId = msgId, // attached to a message — NOT an orphan
            DmMessageId = null,
            CreatedAt = DateTime.UtcNow.AddHours(-2),
        };
        db.FileAttachments.Add(attached);
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var exists = await _factory.CreateDbContext().FileAttachments
            .AnyAsync(f => f.Id == attached.Id);
        Assert.True(exists);
    }

    [Fact]
    public async Task Sweeper_LeavesRecentOrphansAlone()
    {
        var db = _factory.CreateDbContext();
        var roomId = Guid.NewGuid();

        var recent = new FileAttachment
        {
            Id = Guid.NewGuid(),
            OriginalFilename = "recent.pdf",
            ContentType = "application/pdf",
            SizeBytes = 100,
            StoragePath = "/nonexistent/recent.pdf",
            RoomId = roomId,
            MessageId = null,
            DmMessageId = null,
            CreatedAt = DateTime.UtcNow.AddMinutes(-10), // 10 minutes — within the 1h window
        };
        db.FileAttachments.Add(recent);
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var exists = await _factory.CreateDbContext().FileAttachments
            .AnyAsync(f => f.Id == recent.Id);
        Assert.True(exists); // still alive — not yet past the 1h cutoff
    }
}
