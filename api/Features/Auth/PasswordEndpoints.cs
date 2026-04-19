using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

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

    static async Task<IResult> ChangePassword(
        ChangePasswordRequest req,
        ClaimsPrincipal user,
        UserManager<AppUser> users)
    {
        if (req.NewPassword.Length < 6)
            return Results.BadRequest(new { error = "Password must be at least 6 characters" });

        var callerId = GetUserId(user);
        var appUser = await users.FindByIdAsync(callerId.ToString());
        if (appUser is null) return Results.Unauthorized();

        var result = await users.ChangePasswordAsync(appUser, req.CurrentPassword, req.NewPassword);
        if (!result.Succeeded)
            return Results.BadRequest(new { error = "Current password incorrect" });

        return Results.Ok(new { });
    }

    static async Task<IResult> ForgotPassword(
        ForgotPasswordRequest req, AppDbContext db, UserManager<AppUser> users)
    {
        // Always return a token-shaped response to avoid user enumeration
        var fakeToken = new ForgotPasswordResponse(Guid.NewGuid(), DateTime.UtcNow.AddHours(1));

        var appUser = await users.FindByEmailAsync(req.Email);
        if (appUser is null) return Results.Ok(fakeToken);

        var token = new PasswordResetToken
        {
            Token = Guid.NewGuid(),
            UserId = appUser.Id,
            ExpiresAt = DateTime.UtcNow.AddHours(1),
        };
        db.PasswordResetTokens.Add(token);
        await db.SaveChangesAsync();

        return Results.Ok(new ForgotPasswordResponse(token.Token, token.ExpiresAt));
    }

    static async Task<IResult> ResetPassword(
        ResetPasswordRequest req, AppDbContext db, UserManager<AppUser> users)
    {
        if (req.NewPassword.Length < 6)
            return Results.BadRequest(new { error = "Password must be at least 6 characters" });

        var token = await db.PasswordResetTokens
            .FirstOrDefaultAsync(t =>
                t.Token == req.Token &&
                t.ConsumedAt == null &&
                t.ExpiresAt > DateTime.UtcNow);

        if (token is null)
            return Results.BadRequest(new { error = "Token invalid or expired" });

        token.ConsumedAt = DateTime.UtcNow;

        var appUser = await users.FindByIdAsync(token.UserId.ToString());
        if (appUser is null)
            return Results.BadRequest(new { error = "Token invalid or expired" });

        // Set new password hash directly
        appUser.PasswordHash = users.PasswordHasher.HashPassword(appUser, req.NewPassword);
        await users.UpdateAsync(appUser);

        // Revoke all active sessions for this user
        var sessions = await db.Sessions
            .Where(s => s.UserId == token.UserId && !s.IsRevoked)
            .ToListAsync();
        foreach (var s in sessions) s.IsRevoked = true;

        await db.SaveChangesAsync();

        return Results.Ok(new { });
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public record ForgotPasswordRequest(string Email);
public record ForgotPasswordResponse(Guid ResetToken, DateTime ExpiresAt);
public record ResetPasswordRequest(Guid Token, string NewPassword);
