using System.Security.Claims;
using System.Text;
using Api.Data;
using Api.Hubs;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Messages;

public static class MessageMutationEndpoints
{
    public static IEndpointRouteBuilder MapMessageMutationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/messages")
            .WithTags("Messages")
            .RequireAuthorization();

        group.MapMethods("/{id:guid}", ["PATCH"], EditMessage)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapDelete("/{id:guid}", DeleteMessage)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static async Task<IResult> EditMessage(
        Guid id,
        [FromBody] EditMessageRequest req,
        ClaimsPrincipal user,
        AppDbContext db,
        IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var msg = await db.Messages.FindAsync(id);
        if (msg is null)
            return Results.NotFound(new { error = "Message not found" });

        if (msg.AuthorId != callerId)
            return Results.Json(new { error = "Only the author can edit" }, statusCode: 403);

        if (msg.DeletedAt.HasValue)
            return Results.BadRequest(new { error = "Message is deleted" });

        if (Encoding.UTF8.GetByteCount(req.Content) > 3072)
            return Results.BadRequest(new { error = "Message exceeds 3 KB" });

        msg.Content = req.Content;
        msg.EditedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var author = await db.Users.FindAsync(callerId);
        var payload = BuildMessagePayload(msg, author?.UserName ?? "[deleted user]");

        await hub.Clients.Group($"room-{msg.RoomId}").SendAsync("MessageEdited", payload);

        return Results.Ok(payload);
    }

    static async Task<IResult> DeleteMessage(
        Guid id,
        ClaimsPrincipal user,
        AppDbContext db,
        IHubContext<ChatHub> hub)
    {
        var callerId = GetUserId(user);

        var msg = await db.Messages.FindAsync(id);
        if (msg is null)
            return Results.NotFound(new { error = "Message not found" });

        // Already deleted — idempotent
        if (msg.DeletedAt.HasValue)
            return Results.Ok(new { });

        var membership = await db.RoomMemberships
            .FirstOrDefaultAsync(m => m.RoomId == msg.RoomId && m.UserId == callerId);

        var isAuthor = msg.AuthorId == callerId;
        var isAdminOrOwner = membership?.Role is "admin" or "owner";

        if (!isAuthor && !isAdminOrOwner)
            return Results.Json(new { error = "Insufficient permission to delete" }, statusCode: 403);

        msg.DeletedAt = DateTime.UtcNow;
        msg.Content = "";
        await db.SaveChangesAsync();

        await hub.Clients.Group($"room-{msg.RoomId}").SendAsync("MessageDeleted", new
        {
            id = msg.Id.ToString(),
            roomId = msg.RoomId.ToString(),
            deletedAt = msg.DeletedAt,
        });

        return Results.Ok(new { });
    }

    internal static object BuildMessagePayload(Api.Domain.Message msg, string authorUsername) => new
    {
        id = msg.Id.ToString(),
        roomId = msg.RoomId.ToString(),
        authorId = msg.AuthorId?.ToString() ?? "",
        authorUsername,
        content = msg.Content,
        sentAt = msg.SentAt,
        idempotencyKey = msg.Id.ToString(),
        watermark = msg.Watermark,
        editedAt = msg.EditedAt,
        deletedAt = msg.DeletedAt,
        replyToMessageId = msg.ReplyToMessageId?.ToString(),
    };

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}

public record EditMessageRequest(string Content);
