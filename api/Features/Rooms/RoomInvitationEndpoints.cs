using Api.Data;
using Api.Infrastructure;

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

    static Task<IResult> SendInvitation(Guid id, SendInvitationRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> GetMyInvitations(AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> AcceptInvitation(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> DeclineInvitation(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
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
