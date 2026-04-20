using Api.Data;
using Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Presence;

public sealed class AfkSweeper : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly IHubContext<ChatHub> _hub;

    public AfkSweeper(IServiceProvider services, IHubContext<ChatHub> hub)
    {
        _services = services;
        _hub = hub;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
            await SweepAsync(stoppingToken);
        }
    }

    public async Task SweepAsync(CancellationToken ct = default)
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var threshold = DateTime.UtcNow.AddSeconds(-60);
        var toAfk = await db.UserPresences
            .Where(p => p.Status == "online" && p.LastHeartbeatAt < threshold)
            .ToListAsync(ct);

        foreach (var presence in toAfk)
        {
            presence.Status = "afk";

            var payload = new { userId = presence.UserId.ToString(), status = "afk" };

            // Broadcast to all rooms the user belongs to
            var roomIds = await db.RoomMemberships
                .Where(m => m.UserId == presence.UserId)
                .Select(m => m.RoomId)
                .ToListAsync(ct);

            foreach (var roomId in roomIds)
                await _hub.Clients.Group($"room-{roomId}")
                    .SendAsync("PresenceChanged", payload, ct);

            // Also notify friends via their personal group (covers DM pages and /friends)
            var friendIds = await db.Friendships
                .Where(f => (f.UserAId == presence.UserId || f.UserBId == presence.UserId)
                            && f.Status == "accepted")
                .Select(f => f.UserAId == presence.UserId ? f.UserBId : f.UserAId)
                .ToListAsync(ct);

            foreach (var friendId in friendIds)
                await _hub.Clients.Group($"user-{friendId}")
                    .SendAsync("PresenceChanged", payload, ct);
        }

        if (toAfk.Count > 0)
            await db.SaveChangesAsync(ct);
    }
}
