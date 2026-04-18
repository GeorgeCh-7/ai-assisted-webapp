using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Data;
using Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace Api.Tests.Auth;

public class SessionValidationTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public SessionValidationTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    [Fact]
    public async Task RevokedSession_Returns401()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();

        // Register and get the user id
        var registerResp = await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        var user = await registerResp.Content.ReadFromJsonAsync<JsonElement>();
        var userId = Guid.Parse(user.GetProperty("id").GetString()!);

        // Login — creates AppSession row
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });

        // Revoke the session directly in DB before making any authenticated request
        using var db = _factory.CreateDbContext();
        var session = await db.Sessions.FirstAsync(s => s.UserId == userId);
        session.IsRevoked = true;
        await db.SaveChangesAsync();

        // First authenticated request — OnValidatePrincipal fires, no cache yet, hits DB, rejects
        var resp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task ValidSession_Returns200()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username = UniqueUsername(), email, password = "password123" });
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });

        var resp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }
}
