using Api.Data;
using Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;

namespace Api.Features.Auth;

public static class AccountDeletionEndpoints
{
    public static IEndpointRouteBuilder MapAccountDeletionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapDelete("/api/auth/me", DeleteAccount)
            .WithTags("Account")
            .RequireAuthorization()
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        return app;
    }

    static Task<IResult> DeleteAccount([FromBody] DeleteAccountRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}

public record DeleteAccountRequest(string Password);
