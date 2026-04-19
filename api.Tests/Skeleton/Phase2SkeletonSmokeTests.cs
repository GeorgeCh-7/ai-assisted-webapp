using System.Net;
using System.Net.Http.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Skeleton;

/// <summary>
/// Smoke tests: every Phase 2 REST route resolves (returns 501 Not Implemented, not 404 Not Found).
/// Replaced by real tests in Merges 2–4 as each feature is implemented.
/// </summary>
public class Phase2SkeletonSmokeTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;

    public Phase2SkeletonSmokeTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    private async Task<HttpClient> AuthenticatedClientAsync()
    {
        var client = _factory.CreateClient(new() { AllowAutoRedirect = false });
        var email = UniqueEmail();
        var username = UniqueUsername();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "password123" });
        return client;
    }

    private static Guid FakeId => Guid.NewGuid();

    // --- Room moderation ---

    [Fact]
    public async Task DeleteRoom_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.DeleteAsync($"/api/rooms/{FakeId}");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task GetRoomMembers_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync($"/api/rooms/{FakeId}/members");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task GetRoomBans_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync($"/api/rooms/{FakeId}/bans");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task PromoteMember_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/rooms/{FakeId}/members/{FakeId}/promote", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task DemoteMember_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/rooms/{FakeId}/members/{FakeId}/demote", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task BanMember_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/rooms/{FakeId}/members/{FakeId}/ban",
            new { reason = (string?)null });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task UnbanMember_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/rooms/{FakeId}/members/{FakeId}/unban", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Room invitations ---

    [Fact]
    public async Task SendInvitation_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/rooms/{FakeId}/invitations",
            new { username = "someone" });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task GetMyInvitations_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync("/api/invitations");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task AcceptInvitation_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/invitations/{FakeId}/accept", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task DeclineInvitation_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/invitations/{FakeId}/decline", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Message mutations ---

    [Fact]
    public async Task EditMessage_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var req = new HttpRequestMessage(HttpMethod.Patch, $"/api/messages/{FakeId}")
        {
            Content = JsonContent.Create(new { content = "edited" }),
        };
        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteMessage_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.DeleteAsync($"/api/messages/{FakeId}");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Friends ---

    [Fact]
    public async Task GetFriends_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync("/api/friends");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task SendFriendRequest_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync("/api/friends/requests",
            new { username = "someone", message = (string?)null });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task GetFriendRequests_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync("/api/friends/requests");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task AcceptFriendRequest_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/friends/requests/{FakeId}/accept", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task DeclineFriendRequest_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/friends/requests/{FakeId}/decline", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task RemoveFriend_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.DeleteAsync($"/api/friends/{FakeId}");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task BanUser_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/friends/{FakeId}/ban", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task UnbanUser_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.DeleteAsync($"/api/friends/{FakeId}/ban");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Direct messages ---

    [Fact]
    public async Task OpenDmThread_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync("/api/dms/open", new { userId = FakeId });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task ListDmThreads_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync("/api/dms");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task GetDmThread_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync($"/api/dms/{FakeId}");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task GetDmMessages_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync($"/api/dms/{FakeId}/messages");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Files ---

    [Fact]
    public async Task DownloadFile_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync($"/api/files/{FakeId}");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Sessions ---

    [Fact]
    public async Task GetSessions_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.GetAsync("/api/auth/sessions");
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task RevokeSession_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync($"/api/auth/sessions/{FakeId}/revoke", new { });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Password ---

    [Fact]
    public async Task ChangePassword_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var resp = await client.PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "old", newPassword = "new123" });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task ForgotPassword_Returns501()
    {
        var client = _factory.CreateClient(new() { AllowAutoRedirect = false });
        var resp = await client.PostAsJsonAsync("/api/auth/forgot-password",
            new { email = UniqueEmail() });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_Returns501()
    {
        var client = _factory.CreateClient(new() { AllowAutoRedirect = false });
        var resp = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token = FakeId, newPassword = "newpass123" });
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }

    // --- Account deletion ---

    [Fact]
    public async Task DeleteAccount_Returns501()
    {
        var client = await AuthenticatedClientAsync();
        var req = new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
        {
            Content = JsonContent.Create(new { password = "password123" }),
        };
        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NotImplemented, resp.StatusCode);
    }
}
