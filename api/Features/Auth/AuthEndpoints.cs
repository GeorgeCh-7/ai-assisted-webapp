using System.Security.Claims;
using Api.Data;
using Api.Domain;
using Api.Features.Files;
using Api.Infrastructure;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", Register);
        group.MapPost("/login", Login);
        group.MapGet("/me", GetMe).RequireAuthorization();
        group.MapPost("/logout", Logout)
            .RequireAuthorization()
            .AddEndpointFilter<RequireAntiforgeryFilter>();
        group.MapPost("/me/avatar", UploadAvatar)
            .RequireAuthorization()
            .AddEndpointFilter<RequireAntiforgeryFilter>();

        // Public — <img> tags don't send auth headers, only cookies (SameSite=Lax is enough)
        app.MapGet("/api/users/{id:guid}/avatar", GetUserAvatar).AllowAnonymous();

        return app;
    }

    static async Task<IResult> Register(RegisterRequest req, UserManager<AppUser> users)
    {
        if (await users.FindByNameAsync(req.Username) is not null)
            return Results.BadRequest(new { error = "Username already taken" });

        if (await users.FindByEmailAsync(req.Email) is not null)
            return Results.BadRequest(new { error = "Email already registered" });

        var user = new AppUser { UserName = req.Username, Email = req.Email };
        var result = await users.CreateAsync(user, req.Password);

        if (!result.Succeeded)
        {
            var error = result.Errors.Any(e => e.Code == "PasswordTooShort")
                ? "Password must be at least 6 characters"
                : result.Errors.First().Description;
            return Results.BadRequest(new { error });
        }

        return Results.Ok(new UserResponse(user.Id, user.UserName!, user.Email!, null));
    }

    static async Task<IResult> Login(LoginRequest req, UserManager<AppUser> users, AppDbContext db, HttpContext httpContext)
    {
        var user = await users.FindByEmailAsync(req.Email);
        if (user is null || !await users.CheckPasswordAsync(user, req.Password))
            return Results.Json(new { error = "Invalid credentials" }, statusCode: 401);

        var session = new AppSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            UserAgent = httpContext.Request.Headers["User-Agent"].FirstOrDefault(),
            IpAddress = httpContext.Connection.RemoteIpAddress?.ToString(),
        };
        db.Sessions.Add(session);
        await db.SaveChangesAsync();

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.UserName!),
            new("sid", session.Id.ToString()),
        };
        var principal = new ClaimsPrincipal(
            new ClaimsIdentity(claims, IdentityConstants.ApplicationScheme));
        var authProps = new AuthenticationProperties
        {
            IsPersistent = req.KeepMeSignedIn,
            ExpiresUtc = req.KeepMeSignedIn ? DateTimeOffset.UtcNow.AddDays(30) : null,
        };
        await httpContext.SignInAsync(IdentityConstants.ApplicationScheme, principal, authProps);

        var loginAvatarUrl = user.AvatarStoragePath != null ? $"/api/users/{user.Id}/avatar" : null;
        return Results.Ok(new UserResponse(user.Id, user.UserName!, user.Email!, loginAvatarUrl));
    }

    static async Task<IResult> GetMe(
        ClaimsPrincipal user,
        UserManager<AppUser> users,
        HttpContext httpContext,
        IAntiforgery antiforgery)
    {
		var tokens = antiforgery.GetAndStoreTokens(httpContext);
		httpContext.Response.Cookies.Append("XSRF-TOKEN", tokens.RequestToken!, new CookieOptions
		{
			HttpOnly = false,                       // frontend JS must read this
			SameSite = SameSiteMode.Lax,
			Secure = false,                         // dev only; flip per environment in prod
			Path = "/",
			IsEssential = true
		});

        var userId = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userId is null) return Results.Json(new { error = "Unauthenticated" }, statusCode: 401);

        var appUser = await users.FindByIdAsync(userId);
        if (appUser is null) return Results.Json(new { error = "Unauthenticated" }, statusCode: 401);

        var meAvatarUrl = appUser.AvatarStoragePath != null ? $"/api/users/{appUser.Id}/avatar" : null;
        return Results.Ok(new UserResponse(appUser.Id, appUser.UserName!, appUser.Email!, meAvatarUrl));
    }

    static async Task<IResult> UploadAvatar(
        HttpContext ctx, ClaimsPrincipal user,
        UserManager<AppUser> users, FileStorageService storage)
    {
        var userId = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userId is null) return Results.Json(new { error = "Unauthenticated" }, statusCode: 401);

        var appUser = await users.FindByIdAsync(userId);
        if (appUser is null) return Results.Json(new { error = "Unauthenticated" }, statusCode: 401);

        if (!ctx.Request.HasFormContentType)
            return Results.BadRequest(new { error = "Expected multipart form" });

        var form = await ctx.Request.ReadFormAsync();
        var file = form.Files.GetFile("avatar");
        if (file is null)
            return Results.BadRequest(new { error = "No file provided" });

        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new { error = "Only image files are allowed" });

        const long MaxAvatarBytes = 5L * 1024 * 1024;
        if (file.Length > MaxAvatarBytes)
            return Results.Json(new { error = "Avatar exceeds 5 MB" }, statusCode: 413);

        var parsedId = Guid.Parse(userId);
        string storagePath;
        await using (var stream = file.OpenReadStream())
            storagePath = await storage.SaveAvatarAsync(parsedId, stream);

        appUser.AvatarStoragePath = storagePath;
        appUser.AvatarContentType = file.ContentType;
        await users.UpdateAsync(appUser);

        return Results.Ok(new { avatarUrl = $"/api/users/{parsedId}/avatar" });
    }

    static async Task<IResult> GetUserAvatar(Guid id, UserManager<AppUser> users, FileStorageService storage)
    {
        var appUser = await users.FindByIdAsync(id.ToString());
        if (appUser?.AvatarStoragePath is null) return Results.NotFound();
        if (!storage.Exists(appUser.AvatarStoragePath)) return Results.NotFound();

        var stream = storage.Open(appUser.AvatarStoragePath);
        return Results.Stream(stream, appUser.AvatarContentType ?? "image/jpeg");
    }

    static async Task<IResult> Logout(ClaimsPrincipal user, AppDbContext db, HttpContext httpContext)
    {
        var sidClaim = user.FindFirst("sid");
        if (sidClaim is not null && Guid.TryParse(sidClaim.Value, out var sessionId))
        {
            var session = await db.Sessions.FindAsync(sessionId);
            if (session is not null)
            {
                session.IsRevoked = true;
                await db.SaveChangesAsync();
            }
        }
        await httpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        return Results.Ok(new { });
    }
}
