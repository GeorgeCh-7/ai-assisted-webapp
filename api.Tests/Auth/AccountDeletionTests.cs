using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace Api.Tests.Auth;

public class AccountDeletionTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public AccountDeletionTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    private async Task<(HttpClient client, Guid userId, string email)> RegisterAndLoginAsync()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();
        var regResp = await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        var body = await regResp.Content.ReadFromJsonAsync<JsonElement>();
        var userId = Guid.Parse(body.GetProperty("id").GetString()!);
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });
        return (client, userId, email);
    }

    private async Task MakeFriendsAsync(HttpClient aClient, Guid aId, string bUsername, HttpClient bClient)
    {
        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });
        await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/accept", new { });
    }

    [Fact]
    public async Task DeleteAccount_WrongPassword_Returns400()
    {
        var (client, _, _) = await RegisterAndLoginAsync();
        var resp = await client.DeleteWithJsonAsync("/api/auth/me", new { password = "wrongpassword" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Password incorrect", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task DeleteAccount_CorrectPassword_Returns200()
    {
        var (client, _, _) = await RegisterAndLoginAsync();
        var resp = await client.DeleteWithJsonAsync("/api/auth/me", new { password = "password123" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_SessionInvalidated_Returns401OnNextRequest()
    {
        var (client, _, _) = await RegisterAndLoginAsync();
        await client.DeleteWithJsonAsync("/api/auth/me", new { password = "password123" });

        var meResp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, meResp.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_LoginAfterDeletion_Returns401()
    {
        var (client, _, email) = await RegisterAndLoginAsync();
        await client.DeleteWithJsonAsync("/api/auth/me", new { password = "password123" });

        var freshClient = _factory.CreateClient();
        var loginResp = await freshClient.PostAsJsonAsync("/api/auth/login",
            new { email, password = "password123" });
        Assert.Equal(HttpStatusCode.Unauthorized, loginResp.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_DmThread_HasOtherPartyDeletedAt()
    {
        var (aClient, aId, _) = await RegisterAndLoginAsync();
        var (bClient, _, _) = await RegisterAndLoginAsync();

        // Get B's username for friend request
        var bMeResp = await bClient.GetAsync("/api/auth/me");
        var bBody = await bMeResp.Content.ReadFromJsonAsync<JsonElement>();
        var bUsername = bBody.GetProperty("username").GetString()!;
        var bId = Guid.Parse(bBody.GetProperty("id").GetString()!);

        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = Guid.Parse(openBody.GetProperty("id").GetString()!);

        await aClient.DeleteWithJsonAsync("/api/auth/me", new { password = "password123" });

        var db = _factory.CreateDbContext();
        var thread = await db.DmThreads.FindAsync(threadId);
        Assert.NotNull(thread);
        Assert.NotNull(thread.OtherPartyDeletedAt);
    }

    [Fact]
    public async Task DeleteAccount_DmMessages_AuthorNulled()
    {
        var (aClient, aId, _) = await RegisterAndLoginAsync();
        var (bClient, _, _) = await RegisterAndLoginAsync();

        var bMeResp = await bClient.GetAsync("/api/auth/me");
        var bBody = await bMeResp.Content.ReadFromJsonAsync<JsonElement>();
        var bUsername = bBody.GetProperty("username").GetString()!;
        var bId = Guid.Parse(bBody.GetProperty("id").GetString()!);

        await MakeFriendsAsync(aClient, aId, bUsername, bClient);
        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });

        // Get thread via hub would be needed for SendDirectMessage; instead insert directly
        var db = _factory.CreateDbContext();
        var (canonA, canonB) = aId.CompareTo(bId) < 0 ? (aId, bId) : (bId, aId);
        var thread = await db.DmThreads
            .FirstAsync(t => t.UserAId == canonA && t.UserBId == canonB);

        var msg = new Api.Domain.DmMessage
        {
            Id = Guid.NewGuid(),
            DmThreadId = thread.Id,
            AuthorId = aId,
            Content = "hello",
            Watermark = 1,
        };
        db.DmMessages.Add(msg);
        await db.SaveChangesAsync();

        await aClient.DeleteWithJsonAsync("/api/auth/me", new { password = "password123" });

        var db2 = _factory.CreateDbContext();
        var stored = await db2.DmMessages.FindAsync(msg.Id);
        Assert.NotNull(stored);
        Assert.Null(stored.AuthorId);
    }
}
