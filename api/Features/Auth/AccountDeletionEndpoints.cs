using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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

    static async Task<IResult> DeleteAccount(
        [FromBody] DeleteAccountRequest req,
        ClaimsPrincipal principal,
        AppDbContext db,
        UserManager<AppUser> users,
        HttpContext httpContext)
    {
        var callerId = GetUserId(principal);
        var appUser = await users.FindByIdAsync(callerId.ToString());
        if (appUser is null) return Results.Unauthorized();

        if (!await users.CheckPasswordAsync(appUser, req.Password))
            return Results.BadRequest(new { error = "Password incorrect" });

        // Pre-step for RESTRICT FKs on dm_threads: flip other_party_deleted_at before cascades
        await db.DmThreads
            .Where(dt => dt.UserAId == callerId || dt.UserBId == callerId)
            .ExecuteUpdateAsync(dt =>
                dt.SetProperty(p => p.OtherPartyDeletedAt, DateTime.UtcNow));

        // Null out dm_message author refs before cascade (RESTRICT means we must do this manually)
        await db.DmMessages
            .Where(m => m.AuthorId == callerId)
            .ExecuteUpdateAsync(m =>
                m.SetProperty(p => p.AuthorId, (Guid?)null));

        db.Users.Remove(appUser);
        await db.SaveChangesAsync();

        await httpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        return Results.Ok(new { });
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(ClaimTypes.NameIdentifier)!.Value);
}

public record DeleteAccountRequest(string Password);
