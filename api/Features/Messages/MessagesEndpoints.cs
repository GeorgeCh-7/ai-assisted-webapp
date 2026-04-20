using System.Security.Claims;
using Api.Data;
using Api.Features.Rooms;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Messages;

public static class MessagesEndpoints
{
    public static IEndpointRouteBuilder MapMessagesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/rooms/{roomId:guid}/messages")
            .WithTags("Messages")
            .RequireAuthorization();

        group.MapGet("/", GetMessages);

        return app;
    }

    static async Task<IResult> GetMessages(
        Guid roomId,
        ClaimsPrincipal user,
        AppDbContext db,
        [FromQuery] long? before,
        [FromQuery] long? since,
        [FromQuery] int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 50);
        var callerId = Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        var roomExists = await db.Rooms.AnyAsync(r => r.Id == roomId);
        if (!roomExists)
            return Results.NotFound(new { error = "Room not found" });

        var isMember = await db.RoomMemberships
            .AnyAsync(m => m.RoomId == roomId && m.UserId == callerId);
        if (!isMember)
            return Results.Json(new { error = "Not a member" }, statusCode: 403);

        IQueryable<Api.Domain.Message> query = db.Messages
            .Where(m => m.RoomId == roomId);

        bool descending;
        if (since.HasValue)
        {
            // Gap recovery: ascending from known watermark
            query = query.Where(m => m.Watermark > since.Value);
            descending = false;
        }
        else
        {
            // Normal scroll: newest-first, optionally bounded by before watermark
            if (before.HasValue)
                query = query.Where(m => m.Watermark < before.Value);
            descending = true;
        }

        query = descending
            ? query.OrderByDescending(m => m.Watermark)
            : query.OrderBy(m => m.Watermark);

        var messages = await query
            .Take(limit + 1)
            .Select(m => new
            {
                m.Id,
                m.RoomId,
                m.AuthorId,
                AuthorUsername = m.Author != null ? m.Author.UserName : "[deleted user]",
                m.Content,
                m.SentAt,
                m.Watermark,
                m.EditedAt,
                m.DeletedAt,
                m.ReplyToMessageId,
            })
            .ToListAsync();

        var hasMore = messages.Count > limit;
        var page = messages.Take(limit).ToList();

        string? nextCursor = hasMore ? page.Last().Watermark.ToString() : null;

        var messageIds = page.Select(m => m.Id).ToList();
        var attachmentsByMessage = await db.FileAttachments
            .Where(a => a.MessageId != null && messageIds.Contains(a.MessageId.Value))
            .ToListAsync();
        var attachmentLookup = attachmentsByMessage
            .GroupBy(a => a.MessageId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        var items = page.Select(m => new MessageResponse(
            m.Id,
            m.RoomId,
            m.AuthorId,
            m.AuthorUsername ?? "[deleted user]",
            m.DeletedAt.HasValue ? "" : m.Content,   // suppress content for soft-deleted messages
            m.SentAt,
            m.Id,        // idempotencyKey == id
            m.Watermark,
            m.EditedAt,
            m.DeletedAt,
            m.ReplyToMessageId,
            attachmentLookup.TryGetValue(m.Id, out var atts)
                ? atts.Select(a => new FileAttachmentResponse(a.Id, a.OriginalFilename, a.ContentType, a.SizeBytes)).ToList()
                : []));

        return Results.Ok(new PagedResponse<MessageResponse>(items, nextCursor));
    }
}
