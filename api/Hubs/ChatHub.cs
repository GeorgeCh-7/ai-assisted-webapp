using System.Security.Claims;
using System.Text;
using Api.Data;
using Api.Domain;
using Api.Features.Presence;
using Api.Features.XmppBridge;
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
    private readonly XmppBridgeService _xmpp;

    public ChatHub(AppDbContext db, PresenceService presence, XmppBridgeService xmpp)
    {
        _db = db;
        _presence = presence;
        _xmpp = xmpp;
    }

    public override async Task OnConnectedAsync()
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            // Auto-join personal notification group for invitations, friend requests, bans, etc.
            await Groups.AddToGroupAsync(Context.ConnectionId, $"user-{userId}");

            // Auto-join public catalog group for real-time room creation/deletion
            await Groups.AddToGroupAsync(Context.ConnectionId, "public-rooms-catalog");

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

            // Validate replyToMessageId if provided
            if (args.ReplyToMessageId.HasValue)
            {
                var replyExists = await _db.Messages.AnyAsync(m =>
                    m.Id == args.ReplyToMessageId.Value && m.RoomId == args.RoomId);
                if (!replyExists)
                {
                    await Clients.Caller.SendAsync("Error",
                        new { code = "INVALID_REPLY", message = "Reply target not found in this room" });
                    return null;
                }
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
                ReplyToMessageId = args.ReplyToMessageId,
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

            var attachedFiles = new List<FileAttachment>();
            if (args.AttachmentFileIds is { Length: > 0 })
            {
                attachedFiles = await _db.FileAttachments
                    .Where(f => args.AttachmentFileIds.Contains(f.Id) && f.UploaderId == userId)
                    .ToListAsync();
                foreach (var f in attachedFiles)
                    f.MessageId = msg.Id;
                if (attachedFiles.Count > 0)
                    await _db.SaveChangesAsync();
            }

            var author = await _db.Users.FindAsync(userId);
            var payload = MessagePayload(msg, author?.UserName ?? "[deleted user]", attachedFiles);

            await Clients.Group(GroupName(args.RoomId)).SendAsync("MessageReceived", payload);
            await IncrementUnreadsAsync(args.RoomId, userId, msg.Id);

            // Forward to XMPP MUC if this is the bridge room and not a bridge-sourced message
            var senderName = author?.UserName ?? "";
            if (_xmpp.BridgeRoomId == args.RoomId && !senderName.StartsWith("xmpp:"))
                _xmpp.TryEnqueueOutbound(senderName, args.Content);

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
    private static string DmGroupName(Guid threadId) => $"dm-{threadId}";

    private Guid GetUserId() =>
        Guid.Parse(Context.User!.FindFirst(ClaimTypes.NameIdentifier)!.Value);

    private async Task BroadcastPresenceToRoomsAsync(Guid userId, string status)
    {
        var payload = new { userId = userId.ToString(), status };

        var roomIds = await _db.RoomMemberships
            .Where(m => m.UserId == userId)
            .Select(m => m.RoomId)
            .ToListAsync();

        foreach (var roomId in roomIds)
            await Clients.Group(GroupName(roomId)).SendAsync("PresenceChanged", payload);

        // Also notify friends directly via their personal group so presence updates
        // arrive regardless of which page the friend is currently viewing.
        var friendIds = await _db.Friendships
            .Where(f => (f.UserAId == userId || f.UserBId == userId) && f.Status == "accepted")
            .Select(f => f.UserAId == userId ? f.UserBId : f.UserAId)
            .ToListAsync();

        foreach (var friendId in friendIds)
            await Clients.Group($"user-{friendId}").SendAsync("PresenceChanged", payload);
    }

    private async Task<long> NextWatermarkAsync(Guid roomId)
    {
        // EF Core wraps SqlQueryRaw<T> in "SELECT … FROM (your_sql) s", which Postgres rejects
        // for DML statements. Drop to ADO.NET directly so UPDATE…RETURNING stays a single
        // atomic round-trip and avoids the SELECT-after-UPDATE race.
        await _db.Database.OpenConnectionAsync();
        try
        {
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "UPDATE rooms SET current_watermark = current_watermark + 1 WHERE id = $1 RETURNING current_watermark";
            cmd.Parameters.AddWithValue(roomId);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }
        finally
        {
            await _db.Database.CloseConnectionAsync();
        }
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

        // Notify each non-sender member so their catalog badge updates in real-time
        var roomIdStr = roomId.ToString();
        foreach (var memberId in memberIds)
            await Clients.Group($"user-{memberId}").SendAsync("RoomUnreadUpdated", new { roomId = roomIdStr });
    }

    // --- Phase 2 hub stubs ---

    public async Task<object?> EditMessage(EditMessageArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            if (Encoding.UTF8.GetByteCount(args.Content) > 3072)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "MESSAGE_TOO_LARGE", message = "Message exceeds 3 KB" });
                return null;
            }

            var msg = await _db.Messages.FindAsync(args.MessageId);
            if (msg is null)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "MESSAGE_NOT_FOUND", message = "Message not found" });
                return null;
            }

            if (msg.AuthorId != userId)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "NOT_AUTHOR", message = "Only the author can edit this message" });
                return null;
            }

            msg.Content = args.Content;
            msg.EditedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var author = await _db.Users.FindAsync(userId);
            var payload = MessagePayload(msg, author?.UserName ?? "[deleted user]");
            await Clients.Group(GroupName(msg.RoomId)).SendAsync("MessageEdited", payload);
            return payload;
        }
    }

    public async Task<object?> DeleteMessage(DeleteMessageArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            var msg = await _db.Messages.FindAsync(args.MessageId);
            if (msg is null)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "MESSAGE_NOT_FOUND", message = "Message not found" });
                return null;
            }

            var membership = await _db.RoomMemberships
                .FirstOrDefaultAsync(m => m.RoomId == msg.RoomId && m.UserId == userId);
            var isAuthor = msg.AuthorId == userId;
            var isAdminOrOwner = membership?.Role is "admin" or "owner";

            if (!isAuthor && !isAdminOrOwner)
            {
                await Clients.Caller.SendAsync("Error",
                    new { code = "NOT_ADMIN", message = "Insufficient permission to delete" });
                return null;
            }

            if (!msg.DeletedAt.HasValue)
            {
                msg.DeletedAt = DateTime.UtcNow;
                msg.Content = "";
                await _db.SaveChangesAsync();
            }

            var result = new { id = msg.Id.ToString(), deletedAt = msg.DeletedAt };
            await Clients.Group(GroupName(msg.RoomId)).SendAsync("MessageDeleted", new
            {
                id = msg.Id.ToString(),
                roomId = msg.RoomId.ToString(),
                deletedAt = msg.DeletedAt,
            });
            return result;
        }
    }

    public async Task<object?> JoinDm(JoinDmArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            var thread = await _db.DmThreads.FindAsync(args.ThreadId);
            if (thread is null)
            {
                await Clients.Caller.SendAsync("Error", new { code = "DM_THREAD_NOT_FOUND", message = "Thread not found" });
                return null;
            }

            if (thread.UserAId != userId && thread.UserBId != userId)
            {
                await Clients.Caller.SendAsync("Error", new { code = "NOT_MEMBER", message = "Not a participant" });
                return null;
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, DmGroupName(args.ThreadId));

            await _db.DmUnreads
                .Where(u => u.UserId == userId && u.DmThreadId == args.ThreadId)
                .ExecuteUpdateAsync(u => u.SetProperty(p => p.Count, 0));

            return new { currentWatermark = thread.CurrentWatermark };
        }
    }

    public async Task LeaveDm(LeaveDmArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, DmGroupName(args.ThreadId));
        }
    }

    public async Task<object?> SendDirectMessage(SendDirectMessageArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            if (Encoding.UTF8.GetByteCount(args.Content) > 3072)
            {
                await Clients.Caller.SendAsync("Error", new { code = "MESSAGE_TOO_LARGE", message = "Message exceeds 3 KB" });
                return null;
            }

            var userId = GetUserId();

            var thread = await _db.DmThreads.FindAsync(args.ThreadId);
            if (thread is null)
            {
                await Clients.Caller.SendAsync("Error", new { code = "DM_THREAD_NOT_FOUND", message = "Thread not found" });
                return null;
            }

            if (thread.UserAId != userId && thread.UserBId != userId)
            {
                await Clients.Caller.SendAsync("Error", new { code = "NOT_MEMBER", message = "Not a participant" });
                return null;
            }

            if (thread.FrozenAt.HasValue || thread.OtherPartyDeletedAt.HasValue)
            {
                await Clients.Caller.SendAsync("Error", new { code = "THREAD_FROZEN", message = "This conversation is frozen" });
                return null;
            }

            var otherUserId = (thread.UserAId == userId ? thread.UserBId : thread.UserAId).GetValueOrDefault();
            var (aId, bId) = Api.Features.Friends.FriendshipKey.Canonicalize(userId, otherUserId);

            var isFriend = await _db.Friendships
                .AnyAsync(f => f.UserAId == aId && f.UserBId == bId && f.Status == "accepted");
            if (!isFriend)
            {
                await Clients.Caller.SendAsync("Error", new { code = "NOT_FRIENDS", message = "You are not friends with this user" });
                return null;
            }

            var isBanned = await _db.UserBans
                .AnyAsync(ub => (ub.BannerUserId == userId && ub.BannedUserId == otherUserId) ||
                                (ub.BannerUserId == otherUserId && ub.BannedUserId == userId));
            if (isBanned)
            {
                await Clients.Caller.SendAsync("Error", new { code = "USER_BANNED", message = "A user ban exists" });
                return null;
            }

            if (args.ReplyToMessageId.HasValue)
            {
                var replyExists = await _db.DmMessages.AnyAsync(m =>
                    m.Id == args.ReplyToMessageId.Value && m.DmThreadId == args.ThreadId);
                if (!replyExists)
                {
                    await Clients.Caller.SendAsync("Error", new { code = "INVALID_REPLY", message = "Reply target not found in this thread" });
                    return null;
                }
            }

            var watermark = await NextDmWatermarkAsync(args.ThreadId);

            var msg = new DmMessage
            {
                Id = args.IdempotencyKey,
                DmThreadId = args.ThreadId,
                AuthorId = userId,
                Content = args.Content,
                SentAt = DateTime.UtcNow,
                Watermark = watermark,
                ReplyToMessageId = args.ReplyToMessageId,
            };
            _db.DmMessages.Add(msg);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg
                      && pg.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                msg = await _db.DmMessages
                    .AsNoTracking()
                    .FirstAsync(m => m.Id == args.IdempotencyKey);
            }

            var attachedFiles = new List<FileAttachment>();
            if (args.AttachmentFileIds is { Length: > 0 })
            {
                attachedFiles = await _db.FileAttachments
                    .Where(f => args.AttachmentFileIds.Contains(f.Id) && f.UploaderId == userId)
                    .ToListAsync();
                foreach (var f in attachedFiles)
                    f.DmMessageId = msg.Id;
                if (attachedFiles.Count > 0)
                    await _db.SaveChangesAsync();
            }

            var author = await _db.Users.FindAsync(userId);
            var payload = DmMessagePayload(msg, author?.UserName ?? "[deleted user]", attachedFiles);

            await Clients.Group(DmGroupName(args.ThreadId)).SendAsync("DirectMessageReceived", payload);
            await IncrementDmUnreadsAsync(args.ThreadId, userId, msg.Id);

            return payload;
        }
    }

    public async Task<object?> EditDirectMessage(EditDirectMessageArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            if (Encoding.UTF8.GetByteCount(args.Content) > 3072)
            {
                await Clients.Caller.SendAsync("Error", new { code = "MESSAGE_TOO_LARGE", message = "Message exceeds 3 KB" });
                return null;
            }

            var msg = await _db.DmMessages.FindAsync(args.MessageId);
            if (msg is null)
            {
                await Clients.Caller.SendAsync("Error", new { code = "MESSAGE_NOT_FOUND", message = "Message not found" });
                return null;
            }

            if (msg.AuthorId != userId)
            {
                await Clients.Caller.SendAsync("Error", new { code = "NOT_AUTHOR", message = "Only the author can edit this message" });
                return null;
            }

            msg.Content = args.Content;
            msg.EditedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var author = await _db.Users.FindAsync(userId);
            var payload = DmMessagePayload(msg, author?.UserName ?? "[deleted user]");
            await Clients.Group(DmGroupName(msg.DmThreadId)).SendAsync("DirectMessageEdited", payload);
            return payload;
        }
    }

    public async Task<object?> DeleteDirectMessage(DeleteDirectMessageArgs args)
    {
        using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
        using (LogContext.PushProperty("UserId", Context.UserIdentifier))
        {
            var userId = GetUserId();

            var msg = await _db.DmMessages.FindAsync(args.MessageId);
            if (msg is null)
            {
                await Clients.Caller.SendAsync("Error", new { code = "MESSAGE_NOT_FOUND", message = "Message not found" });
                return null;
            }

            if (msg.AuthorId != userId)
            {
                await Clients.Caller.SendAsync("Error", new { code = "NOT_ADMIN", message = "Only the author can delete DM messages" });
                return null;
            }

            if (!msg.DeletedAt.HasValue)
            {
                msg.DeletedAt = DateTime.UtcNow;
                msg.Content = "";
                await _db.SaveChangesAsync();
            }

            var result = new { id = msg.Id.ToString(), deletedAt = msg.DeletedAt };
            await Clients.Group(DmGroupName(msg.DmThreadId)).SendAsync("DirectMessageDeleted", new
            {
                id = msg.Id.ToString(),
                dmThreadId = msg.DmThreadId.ToString(),
                deletedAt = msg.DeletedAt,
            });
            return result;
        }
    }

    private static object MessagePayload(Message msg, string authorUsername, IEnumerable<FileAttachment>? attachments = null) => new
    {
        id = msg.Id.ToString(),
        roomId = msg.RoomId.ToString(),
        authorId = msg.AuthorId?.ToString() ?? "",
        authorUsername,
        content = msg.DeletedAt.HasValue ? "" : msg.Content,
        sentAt = msg.SentAt,
        idempotencyKey = msg.Id.ToString(),
        watermark = msg.Watermark,
        editedAt = msg.EditedAt,
        deletedAt = msg.DeletedAt,
        replyToMessageId = msg.ReplyToMessageId?.ToString(),
        attachments = (attachments ?? []).Select(a => new
        {
            id = a.Id.ToString(),
            originalFilename = a.OriginalFilename,
            contentType = a.ContentType,
            sizeBytes = a.SizeBytes,
        }).ToArray(),
    };

    private static object DmMessagePayload(DmMessage msg, string authorUsername, IEnumerable<FileAttachment>? attachments = null) => new
    {
        id = msg.Id.ToString(),
        dmThreadId = msg.DmThreadId.ToString(),
        authorId = msg.AuthorId?.ToString() ?? "",
        authorUsername,
        content = msg.DeletedAt.HasValue ? "" : msg.Content,
        sentAt = msg.SentAt,
        idempotencyKey = msg.Id.ToString(),
        watermark = msg.Watermark,
        editedAt = msg.EditedAt,
        deletedAt = msg.DeletedAt,
        replyToMessageId = msg.ReplyToMessageId?.ToString(),
        attachments = (attachments ?? []).Select(a => new
        {
            id = a.Id.ToString(),
            originalFilename = a.OriginalFilename,
            contentType = a.ContentType,
            sizeBytes = a.SizeBytes,
        }).ToArray(),
    };

    private async Task<long> NextDmWatermarkAsync(Guid threadId)
    {
        await _db.Database.OpenConnectionAsync();
        try
        {
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "UPDATE dm_threads SET current_watermark = current_watermark + 1 WHERE id = $1 RETURNING current_watermark";
            cmd.Parameters.AddWithValue(threadId);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }
        finally
        {
            await _db.Database.CloseConnectionAsync();
        }
    }

    private async Task IncrementDmUnreadsAsync(Guid threadId, Guid senderUserId, Guid messageId)
    {
        var thread = await _db.DmThreads.FindAsync(threadId);
        if (thread is null) return;

        var recipientId = (thread.UserAId == senderUserId ? thread.UserBId : thread.UserAId).GetValueOrDefault();

        var rows = await _db.DmUnreads
            .Where(u => u.UserId == recipientId && u.DmThreadId == threadId)
            .ExecuteUpdateAsync(u => u
                .SetProperty(p => p.Count, p => p.Count + 1)
                .SetProperty(p => p.LastReadMessageId, messageId));

        if (rows == 0)
        {
            _db.DmUnreads.Add(new DmUnread
            {
                UserId = recipientId,
                DmThreadId = threadId,
                Count = 1,
                LastReadMessageId = messageId,
            });
        }

        try { await _db.SaveChangesAsync(); }
        catch { /* best-effort */ }

        // Notify recipient so their DM sidebar badge updates in real-time
        await Clients.Group($"user-{recipientId}").SendAsync("DmUnreadUpdated", new { threadId = threadId.ToString() });
    }
}

// Hub method argument records — Phase 1
public record JoinRoomArgs(Guid RoomId);
public record LeaveRoomArgs(Guid RoomId);

// Phase 2 optional fields added; existing callers sending only the first 3 fields still work
public record SendMessageArgs(
    Guid RoomId,
    string Content,
    Guid IdempotencyKey,
    Guid? ReplyToMessageId = null,
    Guid[]? AttachmentFileIds = null);

// Phase 2 hub argument records
public record EditMessageArgs(Guid MessageId, string Content);
public record DeleteMessageArgs(Guid MessageId);
public record JoinDmArgs(Guid ThreadId);
public record LeaveDmArgs(Guid ThreadId);
public record SendDirectMessageArgs(
    Guid ThreadId,
    string Content,
    Guid IdempotencyKey,
    Guid? ReplyToMessageId = null,
    Guid[]? AttachmentFileIds = null);
public record EditDirectMessageArgs(Guid MessageId, string Content);
public record DeleteDirectMessageArgs(Guid MessageId);
