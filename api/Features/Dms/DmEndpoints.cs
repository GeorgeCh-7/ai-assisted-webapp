using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Features.Friends;
using Api.Features.Rooms;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Dms;

public static class DmEndpoints
{
    public static IEndpointRouteBuilder MapDmEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/dms")
            .WithTags("Direct Messages")
            .RequireAuthorization();

        group.MapPost("/open", OpenDmThread)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapGet("/", ListDmThreads);
        group.MapGet("/{threadId:guid}", GetDmThread);
        group.MapGet("/{threadId:guid}/messages", GetDmMessages);

        return app;
    }

    static async Task<IResult> OpenDmThread(OpenDmRequest req, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        if (req.UserId == callerId)
            return Results.BadRequest(new { error = "Cannot open DM with yourself" });

        var target = await db.Users.FindAsync(req.UserId);
        if (target is null)
            return Results.NotFound(new { error = "User not found" });

        var (aId, bId) = FriendshipKey.Canonicalize(callerId, req.UserId);

        var isFriend = await db.Friendships
            .AnyAsync(f => f.UserAId == aId && f.UserBId == bId && f.Status == "accepted");
        if (!isFriend)
            return Results.Json(new { error = "Not friends" }, statusCode: 403);

        var isBanned = await db.UserBans
            .AnyAsync(ub => (ub.BannerUserId == callerId && ub.BannedUserId == req.UserId) ||
                            (ub.BannerUserId == req.UserId && ub.BannedUserId == callerId));
        if (isBanned)
            return Results.Json(new { error = "User ban exists" }, statusCode: 403);

        var thread = await DmService.EnsureThreadAsync(callerId, req.UserId, db);

        var presence = await db.UserPresences
            .Where(p => p.UserId == req.UserId)
            .Select(p => p.Status)
            .FirstOrDefaultAsync() ?? "offline";

        return Results.Ok(new DmThreadResponse(
            thread.Id,
            new DmOtherUser(req.UserId, target.UserName ?? "", presence),
            thread.FrozenAt,
            thread.OtherPartyDeletedAt,
            thread.CurrentWatermark));
    }

    static async Task<IResult> ListDmThreads(ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var threads = await db.DmThreads
            .Where(dt => dt.UserAId == callerId || dt.UserBId == callerId)
            .Include(dt => dt.UserA)
            .Include(dt => dt.UserB)
            .ToListAsync();

        var threadIds = threads.Select(t => t.Id).ToList();

        var unreads = await db.DmUnreads
            .Where(u => u.UserId == callerId && threadIds.Contains(u.DmThreadId))
            .ToDictionaryAsync(u => u.DmThreadId, u => u.Count);

        // Load last message per thread (in-memory grouping — hackathon acceptable)
        var lastMsgMap = (await db.DmMessages
            .Where(m => threadIds.Contains(m.DmThreadId))
            .OrderByDescending(m => m.Watermark)
            .ToListAsync())
            .GroupBy(m => m.DmThreadId)
            .ToDictionary(g => g.Key, g => g.First());

        var otherIds = threads.Select(t => t.UserAId == callerId ? t.UserBId : t.UserAId).ToList();
        var presenceMap = await db.UserPresences
            .Where(p => otherIds.Contains(p.UserId))
            .ToDictionaryAsync(p => p.UserId, p => p.Status);

        var items = threads
            .OrderByDescending(t => lastMsgMap.TryGetValue(t.Id, out var m) ? m.SentAt : t.CreatedAt)
            .Select(t =>
            {
                var otherId = t.UserAId == callerId ? t.UserBId : t.UserAId;
                var otherUser = t.UserAId == callerId ? t.UserB : t.UserA;
                var lastMsg = lastMsgMap.TryGetValue(t.Id, out var msg) ? msg : null;
                return new DmThreadListItem(
                    t.Id,
                    new DmOtherUser(otherId, otherUser.UserName ?? "", presenceMap.GetValueOrDefault(otherId, "offline")),
                    lastMsg is null ? null : (lastMsg.DeletedAt.HasValue ? "" : lastMsg.Content),
                    lastMsg?.SentAt ?? t.CreatedAt,
                    unreads.GetValueOrDefault(t.Id, 0),
                    t.FrozenAt,
                    t.OtherPartyDeletedAt);
            });

        return Results.Ok(new PagedResponse<DmThreadListItem>(items, null));
    }

    static async Task<IResult> GetDmThread(Guid threadId, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var thread = await db.DmThreads
            .Include(dt => dt.UserA)
            .Include(dt => dt.UserB)
            .FirstOrDefaultAsync(dt => dt.Id == threadId);

        if (thread is null)
            return Results.NotFound(new { error = "Thread not found" });

        if (thread.UserAId != callerId && thread.UserBId != callerId)
            return Results.Json(new { error = "Not a participant" }, statusCode: 403);

        var otherId = thread.UserAId == callerId ? thread.UserBId : thread.UserAId;
        var otherUser = thread.UserAId == callerId ? thread.UserB : thread.UserA;

        var presence = await db.UserPresences
            .Where(p => p.UserId == otherId)
            .Select(p => p.Status)
            .FirstOrDefaultAsync() ?? "offline";

        return Results.Ok(new DmThreadResponse(
            thread.Id,
            new DmOtherUser(otherId, otherUser.UserName ?? "", presence),
            thread.FrozenAt,
            thread.OtherPartyDeletedAt,
            thread.CurrentWatermark));
    }

    static async Task<IResult> GetDmMessages(
        Guid threadId, ClaimsPrincipal user, AppDbContext db,
        [FromQuery] long? before, [FromQuery] long? since, [FromQuery] int limit = 50)
    {
        var callerId = GetUserId(user);

        var thread = await db.DmThreads.FindAsync(threadId);
        if (thread is null)
            return Results.NotFound(new { error = "Thread not found" });

        if (thread.UserAId != callerId && thread.UserBId != callerId)
            return Results.Json(new { error = "Not a participant" }, statusCode: 403);

        limit = Math.Clamp(limit, 1, 50);

        var query = db.DmMessages
            .Include(m => m.Author)
            .Where(m => m.DmThreadId == threadId);

        IQueryable<DmMessage> ordered;
        if (since.HasValue)
        {
            ordered = query.Where(m => m.Watermark > since.Value).OrderBy(m => m.Watermark);
        }
        else
        {
            if (before.HasValue)
                query = query.Where(m => m.Watermark < before.Value);
            ordered = query.OrderByDescending(m => m.Watermark);
        }

        var messages = await ordered.Take(limit + 1).ToListAsync();
        var hasMore = messages.Count > limit;
        var page = messages.Take(limit).ToList();

        string? nextCursor = hasMore ? page.Last().Watermark.ToString() : null;

        var items = page.Select(m => new DmMessageResponse(
            m.Id,
            threadId,
            m.AuthorId,
            m.Author?.UserName ?? "[deleted user]",
            m.DeletedAt.HasValue ? "" : m.Content,
            m.SentAt,
            m.Id,
            m.Watermark,
            m.EditedAt,
            m.DeletedAt,
            m.ReplyToMessageId));

        return Results.Ok(new PagedResponse<DmMessageResponse>(items, nextCursor));
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}
