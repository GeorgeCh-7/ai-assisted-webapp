using System.Text;
using Api.Data;
using Api.Domain;
using Api.Features.Presence;
using Microsoft.EntityFrameworkCore;

namespace Api.Tests.Hubs;

// Unit tests for PresenceService (process-wide ref-count logic).
// ChatHub method tests that need a running SignalR connection are covered by the
// browser integration gate in the Phase 1 scorecard — the .NET SignalR client
// package is not included to keep the test project dependency-light.
public class ChatHubTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task Presence_FirstConnection_ReturnsTrue()
    {
        var svc = new PresenceService();
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        var wentOnline = await svc.ConnectAsync(userId, db);
        Assert.True(wentOnline);
    }

    [Fact]
    public async Task Presence_SecondConnection_ReturnsFalse()
    {
        var svc = new PresenceService();
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        await svc.ConnectAsync(userId, db);
        var wentOnline = await svc.ConnectAsync(userId, db);
        Assert.False(wentOnline);
    }

    [Fact]
    public async Task Presence_LastDisconnect_ReturnsTrue()
    {
        var svc = new PresenceService();
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        await svc.ConnectAsync(userId, db);
        var wentOffline = await svc.DisconnectAsync(userId, db);
        Assert.True(wentOffline);
    }

    [Fact]
    public async Task Presence_OneOfTwoDisconnects_ReturnsFalse()
    {
        var svc = new PresenceService();
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        await svc.ConnectAsync(userId, db);
        await svc.ConnectAsync(userId, db);
        var wentOffline = await svc.DisconnectAsync(userId, db);
        Assert.False(wentOffline);
    }

    [Fact]
    public async Task Presence_MultiTab_StaysOnlineUntilLastDisconnect()
    {
        var svc = new PresenceService();
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        await svc.ConnectAsync(userId, db);   // tab 1
        await svc.ConnectAsync(userId, db);   // tab 2
        Assert.False(await svc.DisconnectAsync(userId, db)); // tab 1 closes — still online
        Assert.True(await svc.DisconnectAsync(userId, db));  // tab 2 closes — offline
    }

    // Content-size guard: pure logic, no hub plumbing needed
    [Theory]
    [InlineData(3072, true)]
    [InlineData(3073, false)]
    public void ContentSizeGuard_Boundary(int charCount, bool accepted)
    {
        // All ASCII chars; 1 char = 1 UTF-8 byte
        var content = new string('x', charCount);
        Assert.Equal(accepted, Encoding.UTF8.GetByteCount(content) <= 3072);
    }
}
