using Api.Data;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;

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

    static Task<IResult> EditMessage(Guid id, [FromBody] EditMessageRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> DeleteMessage(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}

public record EditMessageRequest(string Content);
