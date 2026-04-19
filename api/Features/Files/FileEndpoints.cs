using Api.Data;
using Api.Infrastructure;

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

    static Task<IResult> UploadFile(HttpContext ctx, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> DownloadFile(Guid id, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}
