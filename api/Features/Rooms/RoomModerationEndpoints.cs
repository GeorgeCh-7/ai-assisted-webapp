using Api.Data;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;

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

    static Task<IResult> DeleteRoom(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> GetMembers(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> GetBans(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> PromoteMember(Guid id, Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> DemoteMember(Guid id, Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> BanMember(Guid id, Guid userId, [FromBody] BanMemberRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> UnbanMember(Guid id, Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
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
