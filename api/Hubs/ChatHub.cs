using System.Security.Claims;
using System.Text;
using Api.Data;
using Api.Domain;
using Api.Features.Presence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Serilog.Context;

namespace Api.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly AppDbContext _db;
    private readonly PresenceService _presence;

    public ChatHub(AppDbContext db, PresenceService presence)
    {
        _db = db;
        _presence = presence;
    }

    public override async Task OnConnectedAsync()
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();
            var wentOnline = await _presence.ConnectAsync(userId, _db);

            if (wentOnline)
                await BroadcastPresenceToRoomsAsync(userId, "online");

            await base.OnConnectedAsync();
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();
            var wentOffline = await _presence.DisconnectAsync(userId, _db);

            if (wentOffline)
                await BroadcastPresenceToRoomsAsync(userId, "offline");

            await base.OnDisconnectedAsync(exception);
        }
    }

    public async Task<object?> JoinRoom(JoinRoomArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            var room = await _db.Rooms.FindAsync(args.RoomId);
            if (room is null)
            {
                await Clients.Caller.SendAsync("Error", new { code = "ROOM_NOT_FOUND", message = "Room not found" });
                return null;
            }

            var isMember = await _db.RoomMemberships
                .AnyAsync(m => m.RoomId == args.RoomId && m.UserId == userId);
            if (!isMember)
            {
                await Clients.Caller.SendAsync("Error", new { code = "NOT_MEMBER", message = "You are not a member of this room" });
                return null;
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(args.RoomId));

            // Reset unread count on join
            await _db.RoomUnreads
                .Where(u => u.UserId == userId && u.RoomId == args.RoomId)
                .ExecuteUpdateAsync(u => u.SetProperty(p => p.Count, 0));

            var user = await _db.Users.FindAsync(userId);
            await Clients.Group(GroupName(args.RoomId))
                .SendAsync("UserJoinedRoom", new
                {
                    userId = userId.ToString(),
                    username = user?.UserName ?? "",
                    roomId = args.RoomId.ToString(),
                });

            return new { currentWatermark = room.CurrentWatermark };
        }
    }

    public async Task LeaveRoom(LeaveRoomArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(args.RoomId));
            await Clients.Group(GroupName(args.RoomId))
                .SendAsync("UserLeftRoom", new
                {
                    userId = userId.ToString(),
                    roomId = args.RoomId.ToString(),
                });
        }
    }

    public async Task<object?> SendMessage(SendMessageArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            // Validate content size: max 3072 UTF-8 bytes per brief 2.5.2
            if (Encoding.UTF8.GetByteCount(args.Content) > 3072)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "MESSAGE_TOO_LARGE", message = "Message exceeds 3 KB" });
                return null;
            }

            var userId = GetUserId();

            var isMember = await _db.RoomMemberships
                .AnyAsync(m => m.RoomId == args.RoomId && m.UserId == userId);
            if (!isMember)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "NOT_MEMBER", message = "You are not a member of this room" });
                return null;
            }

            var watermark = await NextWatermarkAsync(args.RoomId);

            var msg = new Message
            {
                Id = args.IdempotencyKey,
                RoomId = args.RoomId,
                AuthorId = userId,
                Content = args.Content,
                SentAt = DateTime.UtcNow,
                Watermark = watermark,
            };
            _db.Messages.Add(msg);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg
                      && pg.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                // Concurrent duplicate lost the race — fetch the winner and return it
                msg = await _db.Messages
                    .AsNoTracking()
                    .FirstAsync(m => m.Id == args.IdempotencyKey);
            }

            var author = await _db.Users.FindAsync(userId);
            var payload = MessagePayload(msg, author?.UserName ?? "[deleted user]");

            await Clients.Group(GroupName(args.RoomId)).SendAsync("MessageReceived", payload);
            await IncrementUnreadsAsync(args.RoomId, userId, msg.Id);

            return payload;
        }
    }

    public async Task Heartbeat()
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            await _presence.UpdateHeartbeatAsync(GetUserId(), _db);
        }
    }

    // --- Helpers ---

    private static string GroupName(Guid roomId) => $"room-{roomId}";

    private Guid GetUserId() =>
        Guid.Parse(Context.User!.FindFirst(ClaimTypes.NameIdentifier)!.Value);

    private async Task BroadcastPresenceToRoomsAsync(Guid userId, string status)
    {
        var roomIds = await _db.RoomMemberships
            .Where(m => m.UserId == userId)
            .Select(m => m.RoomId)
            .ToListAsync();

        var payload = new { userId = userId.ToString(), status };
        foreach (var roomId in roomIds)
            await Clients.Group(GroupName(roomId)).SendAsync("PresenceChanged", payload);
    }

    private async Task<long> NextWatermarkAsync(Guid roomId)
    {
        // Atomic increment — returns new watermark. Hole on concurrent dedup catch is acceptable.
        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE rooms SET current_watermark = current_watermark + 1 WHERE id = {0}", roomId);

        return await _db.Rooms
            .Where(r => r.Id == roomId)
            .Select(r => r.CurrentWatermark)
            .FirstAsync();
    }

    private async Task IncrementUnreadsAsync(Guid roomId, Guid senderUserId, Guid messageId)
    {
        // Increment for all members except the sender
        var memberIds = await _db.RoomMemberships
            .Where(m => m.RoomId == roomId && m.UserId != senderUserId)
            .Select(m => m.UserId)
            .ToListAsync();

        foreach (var memberId in memberIds)
        {
            var rows = await _db.RoomUnreads
                .Where(u => u.UserId == memberId && u.RoomId == roomId)
                .ExecuteUpdateAsync(u => u
                    .SetProperty(p => p.Count, p => p.Count + 1)
                    .SetProperty(p => p.LastReadMessageId, messageId));

            if (rows == 0)
            {
                _db.RoomUnreads.Add(new RoomUnread
                {
                    UserId = memberId,
                    RoomId = roomId,
                    Count = 1,
                    LastReadMessageId = messageId,
                });
            }
        }

        try { await _db.SaveChangesAsync(); }
        catch { /* unread increment is best-effort */ }
    }

    private static object MessagePayload(Message msg, string authorUsername) => new
    {
        id = msg.Id.ToString(),
        roomId = msg.RoomId.ToString(),
        authorId = msg.AuthorId?.ToString() ?? "",
        authorUsername,
        content = msg.Content,
        sentAt = msg.SentAt,
        idempotencyKey = msg.Id.ToString(),
        watermark = msg.Watermark,
        editedAt = (object?)null,
        deletedAt = (object?)null,
        replyToMessageId = (object?)null,
    };
}

// Hub method argument records
public record JoinRoomArgs(Guid RoomId);
public record LeaveRoomArgs(Guid RoomId);
public record SendMessageArgs(Guid RoomId, string Content, Guid IdempotencyKey);
