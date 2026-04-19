using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Domain;
using Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace Api.Tests.Friends;

public class UserBanTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public UserBanTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    private async Task<(HttpClient client, string username, Guid userId)> RegisterAndLoginAsync()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();
        var regResp = await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        var body = await regResp.Content.ReadFromJsonAsync<JsonElement>();
        var userId = Guid.Parse(body.GetProperty("id").GetString()!);
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });
        return (client, username, userId);
    }

    private async Task MakeFriendsAsync(HttpClient aClient, Guid aId, string bUsername, HttpClient bClient)
    {
        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });
        await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/accept", new { });
    }

    [Fact]
    public async Task BanUser_Returns200()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (_, _, bId) = await RegisterAndLoginAsync();

        var resp = await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task BanUser_FreezesExistingDmThread()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        // Open DM thread first
        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });

        // Ban B
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        // Thread should be frozen
        var threadResp = await aClient.GetAsync("/api/dms");
        var body = await threadResp.Content.ReadFromJsonAsync<JsonElement>();
        var thread = body.GetProperty("items").EnumerateArray().First();
        Assert.False(thread.GetProperty("frozenAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task UnbanUser_ClearsFrozenAt_WhenNoReverseBan()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        var unbanResp = await aClient.DeleteAsync($"/api/friends/{bId}/ban");
        Assert.Equal(HttpStatusCode.OK, unbanResp.StatusCode);

        // Thread frozen_at should be cleared
        var threadResp = await aClient.GetAsync("/api/dms");
        var body = await threadResp.Content.ReadFromJsonAsync<JsonElement>();
        var thread = body.GetProperty("items").EnumerateArray().First();
        Assert.True(thread.GetProperty("frozenAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task UnbanUser_DoesNotClearFrozenAt_WhenReverseBanExists()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });

        // Both ban each other
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });
        await bClient.PostAsJsonAsync($"/api/friends/{aId}/ban", new { });

        // A unbans B — but B has also banned A, so frozen_at must stay
        await aClient.DeleteAsync($"/api/friends/{bId}/ban");

        var threadResp = await aClient.GetAsync("/api/dms");
        var body = await threadResp.Content.ReadFromJsonAsync<JsonElement>();
        var thread = body.GetProperty("items").EnumerateArray().First();
        Assert.False(thread.GetProperty("frozenAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task BannedUser_CannotSendFriendRequest_To_Banning_User()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();

        // A bans B
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        // B tries to send friend request to A
        var aUsername = (await (await bClient.GetAsync($"/api/auth/me"))
            .Content.ReadFromJsonAsync<JsonElement>());
        // Get A's username via RegisterAndLoginAsync stored value
        // We need A's username — re-check via a separate lookup
        // Actually, let's use the DB directly
        var db = _factory.CreateDbContext();
        var aUser = await db.Users.FindAsync(aId);
        var req = await bClient.PostAsJsonAsync("/api/friends/requests",
            new { username = aUser!.UserName, message = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, req.StatusCode);
        var body = await req.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("User has banned you", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task DuplicateBan_Returns409()
    {
        var (aClient, _, _) = await RegisterAndLoginAsync();
        var (_, _, bId) = await RegisterAndLoginAsync();

        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });
        var resp = await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }
}
