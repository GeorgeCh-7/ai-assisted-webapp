using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Files;

public static class FileEndpoints
{
    public static IEndpointRouteBuilder MapFileEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/files")
            .WithTags("Files")
            .RequireAuthorization();

        group.MapPost("/", UploadFile)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapGet("/{id:guid}", DownloadFile);

        return app;
    }

    static async Task<IResult> UploadFile(
        HttpContext ctx, ClaimsPrincipal user, AppDbContext db, FileStorageService storage)
    {
        var callerId = GetUserId(user);

        if (!ctx.Request.HasFormContentType)
            return Results.BadRequest(new { error = "Expected multipart form" });

        var form = await ctx.Request.ReadFormAsync();

        var file = form.Files.GetFile("file");
        if (file is null)
            return Results.BadRequest(new { error = "No file provided" });

        var scope = form["scope"].FirstOrDefault();
        var scopeIdStr = form["scopeId"].FirstOrDefault();
        var originalFilename = form["originalFilename"].FirstOrDefault()
            ?? file.FileName
            ?? "upload";

        if (string.IsNullOrWhiteSpace(scope) || string.IsNullOrWhiteSpace(scopeIdStr))
            return Results.BadRequest(new { error = "Scope id required" });

        // Size validation first: 3 MB for images, 20 MB for everything else
        const long MaxImageBytes = 3L * 1024 * 1024;
        const long MaxFileBytes = 20L * 1024 * 1024;
        var contentType = file.ContentType ?? "application/octet-stream";
        var isImage = contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        var limit = isImage ? MaxImageBytes : MaxFileBytes;

        if (file.Length > limit)
        {
            return isImage
                ? Results.Json(new { error = "Image exceeds 3 MB" }, statusCode: 413)
                : Results.Json(new { error = "File exceeds 20 MB" }, statusCode: 413);
        }

        if (!Guid.TryParse(scopeIdStr, out var scopeId))
            return Results.BadRequest(new { error = "Invalid scope id" });

        // Verify caller is a member of the scope
        Guid? roomId = null;
        Guid? dmThreadId = null;

        if (scope == "room")
        {
            var isMember = await db.RoomMemberships
                .AnyAsync(m => m.RoomId == scopeId && m.UserId == callerId);
            if (!isMember)
                return Results.Json(new { error = "Not a member" }, statusCode: 403);
            roomId = scopeId;
        }
        else if (scope == "dm")
        {
            var thread = await db.DmThreads.FindAsync(scopeId);
            if (thread is null || (thread.UserAId != callerId && thread.UserBId != callerId))
                return Results.Json(new { error = "Not a DM participant" }, statusCode: 403);
            dmThreadId = scopeId;
        }
        else
        {
            return Results.BadRequest(new { error = "Scope must be 'room' or 'dm'" });
        }

        var fileId = Guid.NewGuid();
        string storagePath;

        await using (var stream = file.OpenReadStream())
            storagePath = await storage.SaveAsync(fileId, stream);

        var attachment = new FileAttachment
        {
            Id = fileId,
            UploaderId = callerId,
            OriginalFilename = originalFilename,
            ContentType = contentType,
            SizeBytes = file.Length,
            StoragePath = storagePath,
            RoomId = roomId,
            DmThreadId = dmThreadId,
        };
        db.FileAttachments.Add(attachment);
        await db.SaveChangesAsync();

        return Results.Created($"/api/files/{fileId}",
            new FileUploadResponse(fileId, originalFilename, contentType, file.Length, scope, scopeId));
    }

    static async Task<IResult> DownloadFile(
        Guid id, ClaimsPrincipal user, AppDbContext db,
        FileStorageService storage, IMemoryCache cache)
    {
        var callerId = GetUserId(user);
        var cacheKey = (callerId, id);

        if (!cache.TryGetValue(cacheKey, out bool allowed))
        {
            var attachment = await db.FileAttachments.FindAsync(id);
            if (attachment is null)
                return Results.NotFound(new { error = "File not found" });

            allowed = await CheckAccessAsync(callerId, attachment, db);
            cache.Set(cacheKey, allowed, TimeSpan.FromSeconds(30));
        }

        if (!allowed)
            return Results.Json(new { error = "Access denied" }, statusCode: 403);

        var fa = await db.FileAttachments.FindAsync(id);
        if (fa is null)
            return Results.NotFound(new { error = "File not found" });

        if (!storage.Exists(fa.StoragePath))
            return Results.Json(new { error = "File has been removed" }, statusCode: 410);

        var stream = storage.Open(fa.StoragePath);
        return Results.Stream(stream, fa.ContentType,
            $"{fa.OriginalFilename}", enableRangeProcessing: false);
    }

    private static async Task<bool> CheckAccessAsync(Guid callerId, FileAttachment fa, AppDbContext db)
    {
        // Uploader can always access their own pre-commit upload
        if (fa.UploaderId == callerId) return true;

        if (fa.RoomId.HasValue)
            return await db.RoomMemberships
                .AnyAsync(m => m.RoomId == fa.RoomId.Value && m.UserId == callerId);

        if (fa.DmThreadId.HasValue)
        {
            var thread = await db.DmThreads.FindAsync(fa.DmThreadId.Value);
            return thread is not null &&
                   (thread.UserAId == callerId || thread.UserBId == callerId);
        }

        return false;
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}
