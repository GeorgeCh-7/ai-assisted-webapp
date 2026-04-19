using Api.Data;
using Api.Infrastructure;

namespace Api.Features.Friends;

public static class FriendsEndpoints
{
    public static IEndpointRouteBuilder MapFriendsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/friends")
            .WithTags("Friends")
            .RequireAuthorization();

        group.MapGet("/", GetFriends);

        group.MapPost("/requests", SendFriendRequest)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapGet("/requests", GetFriendRequests);
        group.MapPost("/requests/{userId:guid}/accept", AcceptFriendRequest)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/requests/{userId:guid}/decline", DeclineFriendRequest)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapDelete("/{userId:guid}", RemoveFriend)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapPost("/{userId:guid}/ban", BanUser)
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapDelete("/{userId:guid}/ban", UnbanUser)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static Task<IResult> GetFriends(AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> SendFriendRequest(SendFriendRequestRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> GetFriendRequests(AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> AcceptFriendRequest(Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> DeclineFriendRequest(Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> RemoveFriend(Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> BanUser(Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> UnbanUser(Guid userId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}
