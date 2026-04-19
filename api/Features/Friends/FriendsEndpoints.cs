using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Features.Rooms;
using Api.Hubs;
using Api.Infrastructure;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Friends;

public static class FriendsEndpoints
{
    public static IEndpointRouteBuilder MapFriendsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/friends")
            .WithTags("Friends")
            .RequireAuthorization();

        group.MapGet("/", GetFriends);

        group.MapPost("/requests", SendFriendRequest)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapGet("/requests", GetFriendRequests);
        group.MapPost("/requests/{userId:guid}/accept", AcceptFriendRequest)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/requests/{userId:guid}/decline", DeclineFriendRequest)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapDelete("/{userId:guid}", RemoveFriend)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapPost("/{userId:guid}/ban", BanUser)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapDelete("/{userId:guid}/ban", UnbanUser)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static async Task<IResult> GetFriends(ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var friendships = await db.Friendships
            .Where(f => (f.UserAId == callerId || f.UserBId == callerId) && f.Status == "accepted")
            .Include(f => f.UserA)
            .Include(f => f.UserB)
            .ToListAsync();

        var otherIds = friendships
            .Select(f => f.UserAId == callerId ? f.UserBId : f.UserAId)
            .ToList();

        var presenceMap = await db.UserPresences
            .Where(p => otherIds.Contains(p.UserId))
            .ToDictionaryAsync(p => p.UserId, p => p.Status);

        var myBans = await db.UserBans
            .Where(ub => ub.BannerUserId == callerId && otherIds.Contains(ub.BannedUserId))
            .Select(ub => ub.BannedUserId)
            .ToHashSetAsync();

        var bannedByOther = await db.UserBans
            .Where(ub => ub.BannedUserId == callerId && otherIds.Contains(ub.BannerUserId))
            .Select(ub => ub.BannerUserId)
            .ToHashSetAsync();

        var dmThreadMap = (await db.DmThreads
            .Where(dt => (dt.UserAId == callerId && dt.UserBId.HasValue && otherIds.Contains(dt.UserBId.Value)) ||
                         (dt.UserBId == callerId && dt.UserAId.HasValue && otherIds.Contains(dt.UserAId.Value)))
            .Select(dt => new { dt.UserAId, dt.UserBId, dt.Id })
            .ToListAsync())
            .ToDictionary(
                x => (x.UserAId == callerId ? x.UserBId : x.UserAId).GetValueOrDefault(),
                x => x.Id);

        var items = friendships.Select(f =>
        {
            var otherId = f.UserAId == callerId ? f.UserBId : f.UserAId;
            var otherUser = f.UserAId == callerId ? f.UserB : f.UserA;
            return new FriendListItem(
                otherId,
                otherUser.UserName ?? "",
                f.AcceptedAt ?? DateTime.UtcNow,
                presenceMap.GetValueOrDefault(otherId, "offline"),
                myBans.Contains(otherId),
                bannedByOther.Contains(otherId),
                dmThreadMap.TryGetValue(otherId, out var tid) ? tid : (Guid?)null);
        });

        return Results.Ok(new PagedResponse<FriendListItem>(items, null));
    }

    static async Task<IResult> SendFriendRequest(
        SendFriendRequestRequest req, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        if (string.IsNullOrWhiteSpace(req.Username))
            return Results.BadRequest(new { error = "Username is required" });

        var target = await db.Users.FirstOrDefaultAsync(u => u.UserName == req.Username);
        if (target is null)
            return Results.NotFound(new { error = "User not found" });

        if (target.Id == callerId)
            return Results.BadRequest(new { error = "Cannot friend yourself" });

        if (req.Message?.Length > 500)
            return Results.BadRequest(new { error = "Message must be at most 500 characters" });

        var isBannedByTarget = await db.UserBans
            .AnyAsync(ub => ub.BannerUserId == target.Id && ub.BannedUserId == callerId);
        if (isBannedByTarget)
            return Results.BadRequest(new { error = "User has banned you" });

        var (aId, bId) = FriendshipKey.Canonicalize(callerId, target.Id);
        var existing = await db.Friendships
            .FirstOrDefaultAsync(f => f.UserAId == aId && f.UserBId == bId);

        if (existing is not null)
        {
            if (existing.Status == "accepted")
                return Results.BadRequest(new { error = "Already friends" });
            return Results.BadRequest(new { error = "Friend request already pending" });
        }

        var caller = await db.Users.FindAsync(callerId);
        var friendship = new Friendship
        {
            UserAId = aId,
            UserBId = bId,
            Status = "pending",
            RequestedByUserId = callerId,
            RequestMessage = req.Message,
        };
        db.Friendships.Add(friendship);
        await db.SaveChangesAsync();

        await hub.Clients.Group($"user-{target.Id}").SendAsync("FriendRequestReceived", new
        {
            fromUserId = callerId.ToString(),
            fromUsername = caller?.UserName ?? "",
            message = req.Message,
            requestedAt = friendship.RequestedAt,
        });

        return Results.Created($"/api/friends/requests/{target.Id}",
            new SendFriendRequestResponse(target.UserName ?? "", "pending"));
    }

    static async Task<IResult> GetFriendRequests(ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var pending = await db.Friendships
            .Where(f => (f.UserAId == callerId || f.UserBId == callerId) && f.Status == "pending")
            .Include(f => f.UserA)
            .Include(f => f.UserB)
            .ToListAsync();

        var incoming = pending
            .Where(f => f.RequestedByUserId != callerId)
            .Select(f =>
            {
                var otherId = f.UserAId == callerId ? f.UserBId : f.UserAId;
                var otherUser = f.UserAId == callerId ? f.UserB : f.UserA;
                return new IncomingFriendRequest(otherId, otherUser.UserName ?? "", f.RequestMessage, f.RequestedAt);
            });

        var outgoing = pending
            .Where(f => f.RequestedByUserId == callerId)
            .Select(f =>
            {
                var otherId = f.UserAId == callerId ? f.UserBId : f.UserAId;
                var otherUser = f.UserAId == callerId ? f.UserB : f.UserA;
                return new OutgoingFriendRequest(otherId, otherUser.UserName ?? "", f.RequestedAt);
            });

        return Results.Ok(new FriendRequestsResponse(incoming, outgoing));
    }

    static async Task<IResult> AcceptFriendRequest(
        Guid userId, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);
        var (aId, bId) = FriendshipKey.Canonicalize(callerId, userId);

        var friendship = await db.Friendships
            .Include(f => f.UserA)
            .Include(f => f.UserB)
            .FirstOrDefaultAsync(f => f.UserAId == aId && f.UserBId == bId);

        if (friendship is null || friendship.Status != "pending")
            return Results.NotFound(new { error = "Friend request not found" });

        if (friendship.RequestedByUserId == callerId)
            return Results.BadRequest(new { error = "Cannot accept your own request" });

        friendship.Status = "accepted";
        friendship.AcceptedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var callerUser = await db.Users.FindAsync(callerId);

        var (dtA, dtB) = FriendshipKey.Canonicalize(callerId, userId);
        var dmThread = await db.DmThreads
            .FirstOrDefaultAsync(dt => dt.UserAId == dtA && dt.UserBId == dtB);

        await hub.Clients.Group($"user-{userId}").SendAsync("FriendRequestAccepted", new
        {
            userId = callerId.ToString(),
            username = callerUser?.UserName ?? "",
            acceptedAt = friendship.AcceptedAt,
            dmThreadId = dmThread?.Id.ToString(),
        });

        var otherUser = friendship.UserAId == callerId ? friendship.UserB : friendship.UserA;
        return Results.Ok(new AcceptFriendResponse(userId, otherUser.UserName ?? ""));
    }

    static async Task<IResult> DeclineFriendRequest(
        Guid userId, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);
        var (aId, bId) = FriendshipKey.Canonicalize(callerId, userId);

        var friendship = await db.Friendships
            .FirstOrDefaultAsync(f => f.UserAId == aId && f.UserBId == bId && f.Status == "pending");

        if (friendship is null)
            return Results.NotFound(new { error = "Friend request not found" });

        if (friendship.RequestedByUserId == callerId)
            return Results.BadRequest(new { error = "Cannot decline your own request" });

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();

        await hub.Clients.Group($"user-{userId}").SendAsync("FriendRequestDeclined", new
        {
            userId = callerId.ToString(),
        });

        return Results.Ok(new { });
    }

    static async Task<IResult> RemoveFriend(
        Guid userId, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);
        var (aId, bId) = FriendshipKey.Canonicalize(callerId, userId);

        var friendship = await db.Friendships
            .FirstOrDefaultAsync(f => f.UserAId == aId && f.UserBId == bId);

        if (friendship is null)
            return Results.NotFound(new { error = "Not friends" });

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();

        await hub.Clients.Group($"user-{userId}").SendAsync("FriendRemoved", new
        {
            userId = callerId.ToString(),
        });

        return Results.Ok(new { });
    }

    static async Task<IResult> BanUser(
        Guid userId, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        if (userId == callerId)
            return Results.BadRequest(new { error = "Cannot ban yourself" });

        var target = await db.Users.FindAsync(userId);
        if (target is null)
            return Results.NotFound(new { error = "User not found" });

        var alreadyBanned = await db.UserBans
            .AnyAsync(ub => ub.BannerUserId == callerId && ub.BannedUserId == userId);
        if (alreadyBanned)
            return Results.Json(new { error = "User is already banned" }, statusCode: 409);

        db.UserBans.Add(new UserBan { BannerUserId = callerId, BannedUserId = userId });

        // Freeze DM thread if one exists
        var (aId, bId) = FriendshipKey.Canonicalize(callerId, userId);
        var thread = await db.DmThreads
            .FirstOrDefaultAsync(dt => dt.UserAId == aId && dt.UserBId == bId);
        if (thread is not null && !thread.FrozenAt.HasValue)
            thread.FrozenAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        var callerUser = await db.Users.FindAsync(callerId);
        await hub.Clients.Group($"user-{userId}").SendAsync("UserBanned", new
        {
            byUserId = callerId.ToString(),
            byUsername = callerUser?.UserName ?? "",
            bannedAt = DateTime.UtcNow,
        });

        return Results.Ok(new { });
    }

    static async Task<IResult> UnbanUser(
        Guid userId, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var ban = await db.UserBans
            .FirstOrDefaultAsync(ub => ub.BannerUserId == callerId && ub.BannedUserId == userId);

        if (ban is null)
            return Results.NotFound(new { error = "Ban not found" });

        db.UserBans.Remove(ban);

        // Clear frozen_at only if no reverse ban exists
        var reverseBanExists = await db.UserBans
            .AnyAsync(ub => ub.BannerUserId == userId && ub.BannedUserId == callerId);
        if (!reverseBanExists)
        {
            var (aId, bId) = FriendshipKey.Canonicalize(callerId, userId);
            var thread = await db.DmThreads
                .FirstOrDefaultAsync(dt => dt.UserAId == aId && dt.UserBId == bId);
            if (thread is not null)
                thread.FrozenAt = null;
        }

        await db.SaveChangesAsync();
        return Results.Ok(new { });
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}
