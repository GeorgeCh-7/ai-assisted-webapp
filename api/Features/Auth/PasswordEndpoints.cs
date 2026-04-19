using Api.Data;
using Api.Infrastructure;

namespace Api.Features.Auth;

public static class PasswordEndpoints
{
    public static IEndpointRouteBuilder MapPasswordEndpoints(this IEndpointRouteBuilder app)
    {
        var authGroup = app.MapGroup("/api/auth")
            .WithTags("Password");

        authGroup.MapPost("/change-password", ChangePassword)
            .RequireAuthorization()
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        authGroup.MapPost("/forgot-password", ForgotPassword);
        authGroup.MapPost("/reset-password", ResetPassword);

        return app;
    }

    static Task<IResult> ChangePassword(ChangePasswordRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> ForgotPassword(ForgotPasswordRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));

    static Task<IResult> ResetPassword(ResetPasswordRequest req, AppDbContext db) =>
        Task.FromResult(Results.StatusCode(501));
}

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public record ForgotPasswordRequest(string Email);
public record ForgotPasswordResponse(Guid ResetToken, DateTime ExpiresAt);
public record ResetPasswordRequest(Guid Token, string NewPassword);
