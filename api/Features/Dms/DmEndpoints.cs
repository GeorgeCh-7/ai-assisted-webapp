using Api.Data;
using Api.Infrastructure;

namespace Api.Features.Dms;

public static class DmEndpoints
{
    public static IEndpointRouteBuilder MapDmEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/dms")
            .WithTags("Direct Messages")
            .RequireAuthorization();

        group.MapPost("/open", OpenDmThread)
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        group.MapGet("/", ListDmThreads);
        group.MapGet("/{threadId:guid}", GetDmThread);
        group.MapGet("/{threadId:guid}/messages", GetDmMessages);

        return app;
    }

    static Task<IResult> OpenDmThread(OpenDmRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> ListDmThreads(AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> GetDmThread(Guid threadId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> GetDmMessages(Guid threadId, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}
