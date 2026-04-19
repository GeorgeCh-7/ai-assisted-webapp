using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Hubs;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Rooms;

public static class RoomModerationEndpoints
{
    public static IEndpointRouteBuilder MapRoomModerationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/rooms")
            .WithTags("Room Moderation")
            .RequireAuthorization();

        group.MapDelete("/{id:guid}", DeleteRoom)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapGet("/{id:guid}/members", GetMembers);
        group.MapGet("/{id:guid}/bans", GetBans);

        group.MapPost("/{id:guid}/members/{userId:guid}/promote", PromoteMember)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/{id:guid}/members/{userId:guid}/demote", DemoteMember)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/{id:guid}/members/{userId:guid}/ban", BanMember)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/{id:guid}/members/{userId:guid}/unban", UnbanMember)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static async Task<IResult> DeleteRoom(Guid id, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var membership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (membership is null)
            return Results.NotFound(new { error = "Room not found" });

        if (membership.Role != "owner")
            return Results.Json(new { error = "Only the owner can delete a room" }, statusCode: 403);

        // Broadcast before delete so connected members receive the event
        await hub.Clients.Group($"room-{id}").SendAsync("RoomDeleted", new { roomId = id.ToString() });

        var room = await db.Rooms.FindAsync(id);
        if (room is not null)
        {
            db.Rooms.Remove(room);
            await db.SaveChangesAsync();
        }

        return Results.Ok(new { });
    }

    static async Task<IResult> GetMembers(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var isMember = await db.RoomMemberships.AnyAsync(m => m.RoomId == id && m.UserId == callerId);
        if (!isMember)
            return Results.NotFound(new { error = "Room not found" });

        var items = await db.RoomMemberships
            .Where(m => m.RoomId == id)
            .Select(m => new MemberResponse(
                m.UserId,
                m.User.UserName!,
                m.Role,
                m.JoinedAt,
                db.UserPresences
                    .Where(p => p.UserId == m.UserId)
                    .Select(p => p.Status)
                    .FirstOrDefault() ?? "offline"))
            .ToListAsync();

        return Results.Ok(new PagedResponse<MemberResponse>(items, null));
    }

    static async Task<IResult> GetBans(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var membership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (membership is null)
            return Results.NotFound(new { error = "Room not found" });

        if (membership.Role == "member")
            return Results.Json(new { error = "Insufficient role" }, statusCode: 403);

        var items = await db.RoomBans
            .Where(b => b.RoomId == id)
            .Select(b => new BanResponse(
                b.BannedUserId,
                b.BannedUser.UserName!,
                b.BannedByUserId,
                b.BannedByUser != null ? b.BannedByUser.UserName! : "[deleted user]",
                b.BannedAt,
                b.Reason))
            .ToListAsync();

        return Results.Ok(new PagedResponse<BanResponse>(items, null));
    }

    static async Task<IResult> PromoteMember(Guid id, Guid userId, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var callerMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (callerMembership?.Role != "owner")
            return Results.Json(new { error = "Only the owner can promote admins" }, statusCode: 403);

        var targetMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == userId);
        if (targetMembership is null)
            return Results.NotFound(new { error = "Member not found" });

        if (targetMembership.Role == "admin")
            return Results.BadRequest(new { error = "User is already an admin" });

        targetMembership.Role = "admin";
        await db.SaveChangesAsync();

        await hub.Clients.Group($"room-{id}").SendAsync("RoleChanged", new
        {
            userId = userId.ToString(),
            roomId = id.ToString(),
            role = "admin",
        });

        return Results.Ok(new RoleChangedResponse(userId, "admin"));
    }

    static async Task<IResult> DemoteMember(Guid id, Guid userId, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var callerMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (callerMembership?.Role != "owner")
            return Results.Json(new { error = "Only the owner can demote admins" }, statusCode: 403);

        var targetMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == userId);
        if (targetMembership is null)
            return Results.NotFound(new { error = "Member not found" });

        if (targetMembership.Role != "admin")
            return Results.BadRequest(new { error = "User is not an admin" });

        targetMembership.Role = "member";
        await db.SaveChangesAsync();

        await hub.Clients.Group($"room-{id}").SendAsync("RoleChanged", new
        {
            userId = userId.ToString(),
            roomId = id.ToString(),
            role = "member",
        });

        return Results.Ok(new RoleChangedResponse(userId, "member"));
    }

    static async Task<IResult> BanMember(Guid id, Guid userId, [FromBody] BanMemberRequest req, ClaimsPrincipal user, AppDbContext db, IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var callerMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (callerMembership is null)
            return Results.NotFound(new { error = "Room not found" });

        var targetMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == userId);
        if (targetMembership is null)
            return Results.BadRequest(new { error = "User is not a member" });

        // Permission matrix: owner can ban anyone; admin can only ban members
        if (callerMembership.Role == "member")
            return Results.Json(new { error = "Insufficient role" }, statusCode: 403);

        if (callerMembership.Role == "admin" && targetMembership.Role != "member")
            return Results.Json(new { error = "Insufficient role" }, statusCode: 403);

        var callerUser = await db.Users.FindAsync(callerId);

        db.RoomBans.Add(new RoomBan
        {
            RoomId = id,
            BannedUserId = userId,
            BannedByUserId = callerId,
            Reason = req.Reason,
        });
        db.RoomMemberships.Remove(targetMembership);
        await db.SaveChangesAsync();

        await hub.Clients.Group($"user-{userId}").SendAsync("RoomBanned", new
        {
            roomId = id.ToString(),
            bannedByUsername = callerUser?.UserName ?? "[deleted user]",
            reason = req.Reason,
        });
        await hub.Clients.Group($"room-{id}").SendAsync("UserLeftRoom", new
        {
            userId = userId.ToString(),
            roomId = id.ToString(),
        });

        return Results.Ok(new { });
    }

    static async Task<IResult> UnbanMember(Guid id, Guid userId, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var callerMembership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (callerMembership is null || callerMembership.Role == "member")
            return Results.Json(new { error = "Insufficient role" }, statusCode: 403);

        var ban = await db.RoomBans
            .FirstOrDefaultAsync(b => b.RoomId == id && b.BannedUserId == userId);
        if (ban is null)
            return Results.NotFound(new { error = "Ban not found" });

        db.RoomBans.Remove(ban);
        await db.SaveChangesAsync();

        return Results.Ok(new { });
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}

public record BanMemberRequest(string? Reason);

public record MemberResponse(
    Guid UserId,
    string Username,
    string Role,
    DateTime JoinedAt,
    string Presence);

public record BanResponse(
    Guid UserId,
    string Username,
    Guid? BannedByUserId,
    string BannedByUsername,
    DateTime BannedAt,
    string? Reason);

public record RoleChangedResponse(Guid UserId, string Role);
