using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Hubs;
using Api.Infrastructure;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Rooms;

public static class RoomInvitationEndpoints
{
    public static IEndpointRouteBuilder MapRoomInvitationEndpoints(this IEndpointRouteBuilder app)
    {
        var roomGroup = app.MapGroup("/api/rooms")
            .WithTags("Invitations")
            .RequireAuthorization();

        roomGroup.MapPost("/{id:guid}/invitations", SendInvitation)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        var invGroup = app.MapGroup("/api/invitations")
            .WithTags("Invitations")
            .RequireAuthorization();

        invGroup.MapGet("/", GetMyInvitations);
        invGroup.MapPost("/{id:guid}/accept", AcceptInvitation)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        invGroup.MapPost("/{id:guid}/decline", DeclineInvitation)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static async Task<IResult> SendInvitation(
        Guid id,
        SendInvitationRequest req,
        ClaimsPrincipal user,
        AppDbContext db,
        IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var room = await db.Rooms.FindAsync(id);
        if (room is null)
            return Results.NotFound(new { error = "Room not found" });

        if (!room.IsPrivate)
            return Results.BadRequest(new { error = "Public rooms do not use invitations" });

        var membership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == id && m.UserId == callerId);
        if (membership is null || membership.Role == "member")
            return Results.Json(new { error = "Only owner or admin can invite" }, statusCode: 403);

        var invitee = await db.Users.FirstOrDefaultAsync(u => u.UserName == req.Username);
        if (invitee is null)
            return Results.NotFound(new { error = "User not found" });

        var alreadyMember = await db.RoomMemberships
            .AnyAsync(m => m.RoomId == id && m.UserId == invitee.Id);
        if (alreadyMember)
            return Results.BadRequest(new { error = "User is already a member" });

        var pendingExists = await db.RoomInvitations
            .AnyAsync(i => i.RoomId == id && i.InviteeUserId == invitee.Id && i.Status == "pending");
        if (pendingExists)
            return Results.BadRequest(new { error = "Invitation already pending" });

        var invitation = new RoomInvitation
        {
            Id = Guid.NewGuid(),
            RoomId = id,
            InviteeUserId = invitee.Id,
            InvitedByUserId = callerId,
            Status = "pending",
        };
        db.RoomInvitations.Add(invitation);
        await db.SaveChangesAsync();

        var inviter = await db.Users.FindAsync(callerId);
        await hub.Clients.Group($"user-{invitee.Id}")
            .SendAsync("RoomInvitationReceived", new
            {
                invitationId = invitation.Id.ToString(),
                roomId = id.ToString(),
                roomName = room.Name,
                invitedByUsername = inviter?.UserName ?? "[deleted user]",
                createdAt = invitation.CreatedAt,
            });

        return Results.Created($"/api/invitations/{invitation.Id}",
            new InvitationSentResponse(
                invitation.Id,
                id,
                invitee.Id,
                invitee.UserName!,
                "pending",
                invitation.CreatedAt));
    }

    static async Task<IResult> GetMyInvitations(ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var items = await db.RoomInvitations
            .Where(i => i.InviteeUserId == callerId && i.Status == "pending")
            .Select(i => new InvitationInboxItem(
                i.Id,
                i.RoomId,
                i.Room.Name,
                i.InvitedByUser.UserName!,
                i.CreatedAt))
            .ToListAsync();

        return Results.Ok(new PagedResponse<InvitationInboxItem>(items, null));
    }

    static async Task<IResult> AcceptInvitation(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var invitation = await db.RoomInvitations
            .Include(i => i.Room)
            .FirstOrDefaultAsync(i => i.Id == id && i.InviteeUserId == callerId);
        if (invitation is null)
            return Results.NotFound(new { error = "Invitation not found" });

        if (invitation.Status != "pending")
            return Results.BadRequest(new { error = "Invitation is not pending" });

        invitation.Status = "accepted";
        invitation.RespondedAt = DateTime.UtcNow;

        db.RoomMemberships.Add(new RoomMembership
        {
            RoomId = invitation.RoomId,
            UserId = callerId,
            Role = "member",
        });
        await db.SaveChangesAsync();

        var room = invitation.Room;
        var memberCount = await db.RoomMemberships.CountAsync(m => m.RoomId == room.Id);
        return Results.Ok(new RoomResponse(
            room.Id, room.Name, room.Description,
            memberCount, true, room.IsPrivate, "member"));
    }

    static async Task<IResult> DeclineInvitation(Guid id, ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);

        var invitation = await db.RoomInvitations
            .FirstOrDefaultAsync(i => i.Id == id && i.InviteeUserId == callerId);
        if (invitation is null)
            return Results.NotFound(new { error = "Invitation not found" });

        if (invitation.Status != "pending")
            return Results.BadRequest(new { error = "Invitation is not pending" });

        invitation.Status = "declined";
        invitation.RespondedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Results.Ok(new { });
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}

public record SendInvitationRequest(string Username);

public record InvitationSentResponse(
    Guid Id,
    Guid RoomId,
    Guid InviteeUserId,
    string InviteeUsername,
    string Status,
    DateTime CreatedAt);

public record InvitationInboxItem(
    Guid Id,
    Guid RoomId,
    string RoomName,
    string InvitedByUsername,
    DateTime CreatedAt);
