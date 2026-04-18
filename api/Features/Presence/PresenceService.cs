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

    // Returns true when the user transitions 0 → 1 (just came online).
    public async Task<bool> ConnectAsync(Guid userId, AppDbContext db)
    {
        var wentOnline = false;
        _connections.AddOrUpdate(userId, addValue: 1, updateValueFactory: (_, count) =>
        {
            if (count == 0) wentOnline = true;
            return count + 1;
        });
        // Re-read after update to catch the add path
        if (_connections.TryGetValue(userId, out var current) && current == 1)
            wentOnline = true;

        if (wentOnline)
            await UpsertStatusAsync(userId, "online", db);

        return wentOnline;
    }

    // Returns true when the user transitions 1 → 0 (just went offline).
    public async Task<bool> DisconnectAsync(Guid userId, AppDbContext db)
    {
        var wentOffline = false;
        _connections.AddOrUpdate(userId, addValue: 0, updateValueFactory: (_, count) =>
        {
            var next = Math.Max(0, count - 1);
            if (next == 0) wentOffline = true;
            return next;
        });

        if (wentOffline)
            await UpsertStatusAsync(userId, "offline", db);

        return wentOffline;
    }

    public async Task UpdateHeartbeatAsync(Guid userId, AppDbContext db)
    {
        await db.UserPresences
            .Where(p => p.UserId == userId)
            .ExecuteUpdateAsync(p => p.SetProperty(x => x.LastHeartbeatAt, DateTime.UtcNow));
    }

    private static async Task UpsertStatusAsync(Guid userId, string status, AppDbContext db)
    {
        var rows = await db.UserPresences
            .Where(p => p.UserId == userId)
            .ExecuteUpdateAsync(p => p
                .SetProperty(x => x.Status, status)
                .SetProperty(x => x.LastHeartbeatAt, DateTime.UtcNow));

        if (rows == 0)
        {
            // First time this user has connected — row doesn't exist yet
            db.UserPresences.Add(new UserPresence { UserId = userId, Status = status });
            try { await db.SaveChangesAsync(); }
            catch { /* concurrent insert from another connection — harmless */ }
        }
    }
}
