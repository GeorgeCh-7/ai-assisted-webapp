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

            var roomIds = await db.RoomMemberships
                .Where(m => m.UserId == presence.UserId)
                .Select(m => m.RoomId)
                .ToListAsync(ct);

            var payload = new { userId = presence.UserId.ToString(), status = "afk" };
            foreach (var roomId in roomIds)
                await _hub.Clients.Group($"room-{roomId}")
                    .SendAsync("PresenceChanged", payload, ct);
        }

        if (toAfk.Count > 0)
            await db.SaveChangesAsync(ct);
    }
}
