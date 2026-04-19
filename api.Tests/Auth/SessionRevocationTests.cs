using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Auth;

public class SessionRevocationTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public SessionRevocationTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    private async Task<(HttpClient client, string email, string password)> RegisterAsync()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var password = "password123";
        var username = UniqueUsername();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password });
        await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        return (client, email, password);
    }

    [Fact]
    public async Task GetSessions_ReturnsList()
    {
        var (client, _, _) = await RegisterAsync();
        var resp = await client.GetAsync("/api/auth/sessions");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("items").EnumerateArray().First().GetProperty("isCurrent").GetBoolean());
    }

    [Fact]
    public async Task RevokeOtherSession_SubsequentRequestWithThatSession_Returns401()
    {
        // Register a user
        var email = UniqueEmail();
        var password = "password123";
        var username = UniqueUsername();

        // Client A — first session
        var clientA = _factory.CreateClient();
        await clientA.PostAsJsonAsync("/api/auth/register", new { username, email, password });
        await clientA.PostAsJsonAsync("/api/auth/login", new { email, password });

        // Client B — second session (same user, fresh login)
        var clientB = _factory.CreateClient();
        await clientB.PostAsJsonAsync("/api/auth/login", new { email, password });

        // B lists sessions — finds A's session ID (the one that is NOT current for B)
        var sessionsResp = await clientB.GetAsync("/api/auth/sessions");
        var sessionsBody = await sessionsResp.Content.ReadFromJsonAsync<JsonElement>();
        var sessions = sessionsBody.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(2, sessions.Count);

        // Find session that is NOT current for B (that's A's session)
        var aSession = sessions.First(s => !s.GetProperty("isCurrent").GetBoolean());
        var aSessionId = aSession.GetProperty("id").GetString();

        // B revokes A's session
        var revokeResp = await clientB.PostAsJsonAsync(
            $"/api/auth/sessions/{aSessionId}/revoke", new { });
        Assert.Equal(HttpStatusCode.OK, revokeResp.StatusCode);

        // A's next request should fail (no validated_on cache yet — A hasn't made any auth'd requests)
        var meResp = await clientA.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, meResp.StatusCode);
    }

    [Fact]
    public async Task RevokeCurrentSession_ClearsCookie_Returns401OnNextRequest()
    {
        var (client, _, _) = await RegisterAsync();

        // Get own session ID
        var sessionsResp = await client.GetAsync("/api/auth/sessions");
        var sessionsBody = await sessionsResp.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = sessionsBody.GetProperty("items").EnumerateArray().First()
            .GetProperty("id").GetString();

        // Revoke the current session — should clear the cookie
        var revokeResp = await client.PostAsJsonAsync(
            $"/api/auth/sessions/{sessionId}/revoke", new { });
        Assert.Equal(HttpStatusCode.OK, revokeResp.StatusCode);

        // Next request should be 401 (cookie was cleared by sign-out)
        var meResp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, meResp.StatusCode);
    }

    [Fact]
    public async Task RevokeNonExistentSession_Returns404()
    {
        var (client, _, _) = await RegisterAsync();
        var resp = await client.PostAsJsonAsync(
            $"/api/auth/sessions/{Guid.NewGuid()}/revoke", new { });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
