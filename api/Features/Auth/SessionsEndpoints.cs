using System.Security.Claims;
using Api.Data;
using Api.Features.Rooms;
using Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Auth;

public static class SessionsEndpoints
{
    public static IEndpointRouteBuilder MapSessionsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth")
            .WithTags("Sessions")
            .RequireAuthorization();

        group.MapGet("/sessions", GetSessions);
        group.MapPost("/sessions/{id:guid}/revoke", RevokeSession)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static async Task<IResult> GetSessions(ClaimsPrincipal user, AppDbContext db)
    {
        var callerId = GetUserId(user);
        var currentSid = user.FindFirst("sid")?.Value;

        var sessions = await db.Sessions
            .Where(s => s.UserId == callerId && !s.IsRevoked)
            .OrderByDescending(s => s.LastSeenAt)
            .ToListAsync();

        var items = sessions.Select(s => new SessionListItem(
            s.Id,
            s.UserAgent,
            s.IpAddress,
            s.CreatedAt,
            s.LastSeenAt,
            s.Id.ToString() == currentSid));

        return Results.Ok(new PagedResponse<SessionListItem>(items, null));
    }

    static async Task<IResult> RevokeSession(
        Guid id, ClaimsPrincipal user, AppDbContext db, HttpContext httpContext)
    {
        var callerId = GetUserId(user);
        var currentSid = user.FindFirst("sid")?.Value;

        var session = await db.Sessions
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == callerId);

        if (session is null)
            return Results.NotFound(new { error = "Session not found" });

        session.IsRevoked = true;
        await db.SaveChangesAsync();

        // Revoking current session — clear the auth cookie
        if (id.ToString() == currentSid)
            await httpContext.SignOutAsync(IdentityConstants.ApplicationScheme);

        return Results.Ok(new { });
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}

public record SessionListItem(
    Guid Id,
    string? UserAgent,
    string? IpAddress,
    DateTime CreatedAt,
    DateTime LastSeenAt,
    bool IsCurrent);
