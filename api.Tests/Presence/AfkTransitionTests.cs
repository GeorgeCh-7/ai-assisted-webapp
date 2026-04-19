using Api.Data;
using Api.Domain;
using Api.Features.Presence;
using Api.Tests.Helpers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Api.Tests.Presence;

public class AfkTransitionTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public AfkTransitionTests(TestWebApp factory) => _factory = factory;

    private AfkSweeper GetSweeper() =>
        _factory.Services.GetServices<IHostedService>().OfType<AfkSweeper>().First();

    private AppDbContext CreateDb() => _factory.CreateDbContext();

    [Fact]
    public async Task Sweeper_FlipsOnlineToAfk_WhenHeartbeatExpired()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        db.UserPresences.Add(new UserPresence
        {
            UserId = userId,
            Status = "online",
            LastHeartbeatAt = DateTime.UtcNow.AddSeconds(-90),
        });
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var result = await CreateDb().UserPresences.FindAsync(userId);
        Assert.Equal("afk", result!.Status);
    }

    [Fact]
    public async Task Sweeper_KeepsOnline_WhenHeartbeatRecent()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        db.UserPresences.Add(new UserPresence
        {
            UserId = userId,
            Status = "online",
            LastHeartbeatAt = DateTime.UtcNow.AddSeconds(-30), // 30s ago — within 60s window
        });
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var result = await CreateDb().UserPresences.FindAsync(userId);
        Assert.Equal("online", result!.Status);
    }

    [Fact]
    public async Task Sweeper_DoesNotFlipOfflineToAfk()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        db.UserPresences.Add(new UserPresence
        {
            UserId = userId,
            Status = "offline",
            LastHeartbeatAt = DateTime.UtcNow.AddSeconds(-120),
        });
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var result = await CreateDb().UserPresences.FindAsync(userId);
        Assert.Equal("offline", result!.Status); // sweeper only targets "online"
    }

    [Fact]
    public async Task MultiTab_OneTabHeartbeating_KeepsOnline()
    {
        // Multi-tab semantics: the last_heartbeat_at is per-user (not per-connection).
        // As long as ANY tab has sent a heartbeat within 60s, the sweeper leaves
        // the user as "online". This test verifies: one tab sending heartbeats
        // (recent LastHeartbeatAt) prevents the AFK flip regardless of how many
        // other tabs are idle.
        var userId = Guid.NewGuid();
        var db = CreateDb();
        db.UserPresences.Add(new UserPresence
        {
            UserId = userId,
            Status = "online",
            LastHeartbeatAt = DateTime.UtcNow.AddSeconds(-15), // recent — simulates active tab
        });
        await db.SaveChangesAsync();

        await GetSweeper().SweepAsync();

        var result = await CreateDb().UserPresences.FindAsync(userId);
        Assert.Equal("online", result!.Status);
    }
}
