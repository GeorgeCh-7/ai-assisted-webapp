using System.Security.Claims;
using Api.Data;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Auth;

public static class SessionValidation
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    public static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var sidClaim = context.Principal?.FindFirst("sid");
        if (sidClaim is null || !Guid.TryParse(sidClaim.Value, out var sessionId))
        {
            context.RejectPrincipal();
            return;
        }

        // Skip DB hit if we validated within the last 30 s (sliding window via ShouldRenew)
        var validatedOnClaim = context.Principal!.FindFirst("validated_on");
        if (validatedOnClaim is not null
            && long.TryParse(validatedOnClaim.Value, out var ticks)
            && DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc) < CacheDuration)
        {
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var session = await db.Sessions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId);

        if (session is null || session.IsRevoked)
        {
            context.RejectPrincipal();
            return;
        }

        await db.Sessions
            .Where(s => s.Id == sessionId)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.LastSeenAt, DateTime.UtcNow));

        // Slide the cache window forward
        var identity = (ClaimsIdentity)context.Principal!.Identity!;
        var old = identity.FindFirst("validated_on");
        if (old is not null) identity.RemoveClaim(old);
        identity.AddClaim(new Claim("validated_on", DateTime.UtcNow.Ticks.ToString()));
        context.ReplacePrincipal(new ClaimsPrincipal(identity));
        context.ShouldRenew = true;
    }
}
