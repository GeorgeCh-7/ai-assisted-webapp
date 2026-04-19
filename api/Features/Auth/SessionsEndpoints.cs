using Api.Data;
using Api.Infrastructure;

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

    static Task<IResult> GetSessions(AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> RevokeSession(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}

public record SessionListItem(
    Guid Id,
    string? UserAgent,
    string? IpAddress,
    DateTime CreatedAt,
    DateTime LastSeenAt,
    bool IsCurrent);
