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
    private readonly ConcurrentDictionary<Guid, int> _connections = new();

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
        // Guard: if userId was never tracked (e.g. server restart cleared the map mid-session),
        // AddOrUpdate with addValue:0 would insert 0 and spuriously trigger an offline broadcast.
        if (!_connections.TryGetValue(userId, out _)) return false;

        var newCount = _connections.AddOrUpdate(userId, addValue: 0, updateValueFactory: (_, n) => Math.Max(0, n - 1));
        if (newCount != 0) return false;

        await UpsertStatusAsync(userId, "offline", db);
        return true;
    }

    // Returns true if the user transitioned afk→online (caller should broadcast PresenceChanged).
    public async Task<bool> UpdateHeartbeatAsync(Guid userId, AppDbContext db)
    {
        var presence = await db.UserPresences.FindAsync(userId);
        if (presence is null) return false;
        var wasAfk = presence.Status == "afk";
        if (wasAfk) presence.Status = "online";
        presence.LastHeartbeatAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return wasAfk;
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
