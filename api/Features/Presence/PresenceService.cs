using System.Collections.Concurrent;
using Api.Data;
using Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Presence;

// Process-wide ref-counted connection map per user.
// No user_connections table — server restart correctly treats everyone as offline
// until SignalR reconnect repopulates this map.
public sealed class PresenceService
{
    private static readonly ConcurrentDictionary<Guid, int> _connections = new();

    // Returns true when the user transitions to 1 (just came online, 0→1).
    public async Task<bool> ConnectAsync(Guid userId, AppDbContext db)
    {
        var newCount = _connections.AddOrUpdate(userId, addValue: 1, updateValueFactory: (_, n) => n + 1);
        if (newCount != 1) return false;

        await UpsertStatusAsync(userId, "online", db);
        return true;
    }

    // Returns true when the user transitions to 0 (just went offline, 1→0).
    public async Task<bool> DisconnectAsync(Guid userId, AppDbContext db)
    {
        var newCount = _connections.AddOrUpdate(userId, addValue: 0, updateValueFactory: (_, n) => Math.Max(0, n - 1));
        if (newCount != 0) return false;

        await UpsertStatusAsync(userId, "offline", db);
        return true;
    }

    public async Task UpdateHeartbeatAsync(Guid userId, AppDbContext db)
    {
        var presence = await db.UserPresences.FindAsync(userId);
        if (presence is null) return;
        presence.LastHeartbeatAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    private static async Task UpsertStatusAsync(Guid userId, string status, AppDbContext db)
    {
        var presence = await db.UserPresences.FindAsync(userId);
        if (presence is not null)
        {
            presence.Status = status;
            presence.LastHeartbeatAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        else
        {
            db.UserPresences.Add(new UserPresence { UserId = userId, Status = status });
            try { await db.SaveChangesAsync(); }
            catch { /* concurrent insert from another connection — harmless */ }
        }
    }
}
