using System.Security.Claims;
using System.Text;
using Api.Data;
using Api.Domain;
using Api.Hubs;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Rooms;

public static class RoomsEndpoints
{
    public static IEndpointRouteBuilder MapRoomsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/rooms")
            .WithTags("Rooms")
            .RequireAuthorization();

        group.MapGet("/", GetRooms);
        group.MapPost("/", CreateRoom).AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapGet("/{id:guid}", GetRoom);
        group.MapPost("/{id:guid}/join", JoinRoom).AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/{id:guid}/leave", LeaveRoom).AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static async Task<IResult> GetRooms(
        ClaimsPrincipal user,
        AppDbContext db,
        [FromQuery] string? q,
        [FromQuery] string? cursor,
        [FromQuery] bool? @private,
        [FromQuery] bool? mine,
        [FromQuery] int limit = 20)
    {
        limit = Math.Clamp(limit, 1, 50);
        var callerId = GetUserId(user);

        IQueryable<Room> query;
        if (mine == true)
        {
            // Sidebar: all rooms where caller is a member (public + private)
            query = db.Rooms.Where(r => r.Memberships.Any(m => m.UserId == callerId));
        }
        else if (@private == true)
        {
            // Private catalog: only rooms the caller belongs to or is invited to
            query = db.Rooms.Where(r =>
                r.IsPrivate &&
                (r.Memberships.Any(m => m.UserId == callerId) ||
                 db.RoomInvitations.Any(i => i.RoomId == r.Id && i.InviteeUserId == callerId && i.Status == "pending")));
        }
        else
        {
            // Public catalog: only rooms that are not private
            query = db.Rooms.Where(r => !r.IsPrivate);
        }
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(r => r.Name.Contains(q));

        // Keyset pagination over (name ASC, id ASC)
        if (!string.IsNullOrEmpty(cursor))
        {
            var (cursorName, cursorId) = DecodeCursor(cursor);
            query = query.Where(r =>
                r.Name.CompareTo(cursorName) > 0 ||
                (r.Name == cursorName && r.Id.CompareTo(cursorId) > 0));
        }

        var rooms = await query
            .OrderBy(r => r.Name).ThenBy(r => r.Id)
            .Take(limit + 1)
            .Select(r => new
            {
                r.Id,
                r.Name,
                r.Description,
                r.IsPrivate,
                MemberCount = r.Memberships.Count(),
                MyMembership = r.Memberships.FirstOrDefault(m => m.UserId == callerId),
            })
            .ToListAsync();

        var hasMore = rooms.Count > limit;
        var page = rooms.Take(limit).ToList();

        var nextCursor = hasMore
            ? EncodeCursor(page.Last().Name, page.Last().Id)
            : null;

        var items = page.Select(r => new RoomResponse(
            r.Id,
            r.Name,
            r.Description,
            r.MemberCount,
            r.MyMembership is not null,
            r.IsPrivate,
            r.MyMembership?.Role));

        return Results.Ok(new PagedResponse<RoomResponse>(items, nextCursor));
    }

    static async Task<IResult> CreateRoom(
        CreateRoomRequest req,
        ClaimsPrincipal user,
        AppDbContext db,
        IHubContext<ChatHub> hub)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return Results.BadRequest(new { error = "Name is required" });

        var callerId = GetUserId(user);
        var exists = await db.Rooms.AnyAsync(r => r.Name == req.Name);
        if (exists)
            return Results.Json(new { error = "Room name already taken" }, statusCode: 409);

        var room = new Room
        {
            Id = Guid.NewGuid(),
            Name = req.Name,
            Description = req.Description ?? "",
            CreatedById = callerId,
            IsPrivate = req.IsPrivate,
        };
        db.Rooms.Add(room);
        db.RoomMemberships.Add(new RoomMembership
        {
            RoomId = room.Id,
            UserId = callerId,
            Role = "owner",
        });
        await db.SaveChangesAsync();

        if (!room.IsPrivate)
        {
            await hub.Clients.Group("public-rooms-catalog").SendAsync("RoomCreated", new
            {
                id = room.Id.ToString(),
                name = room.Name,
                description = room.Description,
                memberCount = 1,
                isMember = false,
                isPrivate = false,
                myRole = (string?)null,
            });
        }

        return Results.Created($"/api/rooms/{room.Id}",
            new RoomResponse(room.Id, room.Name, room.Description, 1, true, room.IsPrivate, "owner"));
    }

    static async Task<IResult> GetRoom(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);
        var room = await db.Rooms
            .Where(r => r.Id == id)
            .Select(r => new
            {
                r.Id, r.Name, r.Description, r.IsPrivate,
                MemberCount = r.Memberships.Count(),
                MyMembership = r.Memberships.FirstOrDefault(m => m.UserId == callerId),
            })
            .FirstOrDefaultAsync();

        if (room is null)
            return Results.NotFound(new { error = "Room not found" });

        return Results.Ok(new RoomResponse(
            room.Id, room.Name, room.Description,
            room.MemberCount, room.MyMembership is not null,
            room.IsPrivate, room.MyMembership?.Role));
    }

    static async Task<IResult> JoinRoom(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);
        var room = await db.Rooms.FindAsync(id);
        if (room is null)
            return Results.NotFound(new { error = "Room not found" });

        if (room.IsPrivate)
            return Results.Json(new { error = "Room is private — use an invitation to join" }, statusCode: 403);

        var isBanned = await db.RoomBans.AnyAsync(b => b.RoomId == id && b.BannedUserId == callerId);
        if (isBanned)
            return Results.Json(new { error = "You are banned from this room" }, statusCode: 403);

        var already = await db.RoomMemberships
            .AnyAsync(m => m.RoomId == id && m.UserId == callerId);
        if (already)
            return Results.Json(new { error = "Already a member" }, statusCode: 409);

        db.RoomMemberships.Add(new RoomMembership
        {
            RoomId = id,
            UserId = callerId,
            Role = "member",
        });
        await db.SaveChangesAsync();

        var memberCount = await db.RoomMemberships.CountAsync(m => m.RoomId == id);
        return Results.Ok(new RoomResponse(id, room.Name, room.Description, memberCount, true, room.IsPrivate, "member"));
    }

    static async Task<IResult> LeaveRoom(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);
        var room = await db.Rooms.FindAsync(id);
        if (room is null)
            return Results.NotFound(new { error = "Room not found" });

        var membership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (membership is null)
            return Results.BadRequest(new { error = "Not a member" });

        if (membership.Role == "owner")
            return Results.Json(new { error = "Owner cannot leave their own room" }, statusCode: 403);

        db.RoomMemberships.Remove(membership);
        await db.SaveChangesAsync();

        return Results.Ok(new { });
    }

    // --- Cursor helpers ---

    private static string EncodeCursor(string name, Guid id)
    {
        var raw = $"{name}\x00{id}";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(raw));
    }

    private static (string name, Guid id) DecodeCursor(string cursor)
    {
        try
        {
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            var sep = raw.IndexOf('\x00');
            if (sep < 0) return ("", Guid.Empty);
            var name = raw[..sep];
            var id = Guid.TryParse(raw[(sep + 1)..], out var g) ? g : Guid.Empty;
            return (name, id);
        }
        catch { return ("", Guid.Empty); }
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}
