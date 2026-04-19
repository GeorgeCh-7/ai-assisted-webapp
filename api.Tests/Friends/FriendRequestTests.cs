using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Domain;
using Api.Tests.Helpers;

namespace Api.Tests.Friends;

public class FriendRequestTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public FriendRequestTests(TestWebApp factory) => _factory = factory;

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

    [Fact]
    public async Task SendFriendRequest_Returns201()
    {
        var (senderClient, _, _) = await RegisterAndLoginAsync();
        var (_, recipientUsername, _) = await RegisterAndLoginAsync();

        var resp = await senderClient.PostAsJsonAsync("/api/friends/requests",
            new { username = recipientUsername, message = (string?)null });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(recipientUsername, body.GetProperty("username").GetString());
        Assert.Equal("pending", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task SendFriendRequest_ToSelf_Returns400()
    {
        var (client, username, _) = await RegisterAndLoginAsync();
        var resp = await client.PostAsJsonAsync("/api/friends/requests",
            new { username, message = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task SendFriendRequest_Duplicate_Returns400()
    {
        var (senderClient, _, _) = await RegisterAndLoginAsync();
        var (_, recipientUsername, _) = await RegisterAndLoginAsync();

        await senderClient.PostAsJsonAsync("/api/friends/requests",
            new { username = recipientUsername, message = (string?)null });
        var resp = await senderClient.PostAsJsonAsync("/api/friends/requests",
            new { username = recipientUsername, message = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Friend request already pending", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SendFriendRequest_AlreadyFriends_Returns400()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();

        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });
        await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/accept", new { });

        var resp = await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Already friends", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetFriendRequests_ShowsIncomingAndOutgoing()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, _) = await RegisterAndLoginAsync();

        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = "hello" });

        // B sees incoming
        var bResp = await bClient.GetAsync("/api/friends/requests");
        var bBody = await bResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, bBody.GetProperty("incoming").GetArrayLength());
        Assert.Equal(0, bBody.GetProperty("outgoing").GetArrayLength());

        // A sees outgoing
        var aResp = await aClient.GetAsync("/api/friends/requests");
        var aBody = await aResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, aBody.GetProperty("incoming").GetArrayLength());
        Assert.Equal(1, aBody.GetProperty("outgoing").GetArrayLength());
    }

    [Fact]
    public async Task AcceptFriendRequest_Returns200_AndShowsInFriendList()
    {
        var (aClient, aUsername, aId) = await RegisterAndLoginAsync();
        var (bClient, _, bId) = await RegisterAndLoginAsync();

        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = (await (await bClient.GetAsync("/api/auth/me"))
                .Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("username").GetString(), message = (string?)null });

        var acceptResp = await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/accept", new { });
        Assert.Equal(HttpStatusCode.OK, acceptResp.StatusCode);

        var friendsResp = await bClient.GetAsync("/api/friends");
        var friendsBody = await friendsResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, friendsBody.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task AcceptFriendRequest_SimplifiedFlow()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();

        // A sends to B
        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });

        // B accepts
        var acceptResp = await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/accept", new { });
        Assert.Equal(HttpStatusCode.OK, acceptResp.StatusCode);

        // Both see each other in friends list
        var aFriendsResp = await aClient.GetAsync("/api/friends");
        var aFriends = await aFriendsResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, aFriendsResp.StatusCode == HttpStatusCode.OK
            ? aFriends.GetProperty("items").GetArrayLength() : -1);
    }

    [Fact]
    public async Task DeclineFriendRequest_RemovesRow()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, _) = await RegisterAndLoginAsync();

        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });

        var declineResp = await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/decline", new { });
        Assert.Equal(HttpStatusCode.OK, declineResp.StatusCode);

        // No pending requests for either
        var bResp = await bClient.GetAsync("/api/friends/requests");
        var bBody = await bResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, bBody.GetProperty("incoming").GetArrayLength());
    }

    [Fact]
    public async Task RemoveFriend_RemovesFriendship()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();

        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });
        await bClient.PostAsJsonAsync($"/api/friends/requests/{aId}/accept", new { });

        var removeResp = await aClient.DeleteAsync($"/api/friends/{bId}");
        Assert.Equal(HttpStatusCode.OK, removeResp.StatusCode);

        var friendsResp = await aClient.GetAsync("/api/friends");
        var friendsBody = await friendsResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, friendsBody.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task FriendshipRowOrdering_HoldsRegardlessOfRequestDirection()
    {
        // Two users: ensure canonical order enforced regardless of who sends the request
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();

        // A (potentially lower or higher UUID) sends to B
        await aClient.PostAsJsonAsync("/api/friends/requests",
            new { username = bUsername, message = (string?)null });

        // Verify the row exists in the DB with canonical ordering
        var db = _factory.CreateDbContext();
        var (expectedA, expectedB) = aId.CompareTo(bId) < 0 ? (aId, bId) : (bId, aId);
        var row = await db.Friendships
            .FindAsync(expectedA, expectedB);  // composite key lookup
        Assert.NotNull(row);
        Assert.True(row!.UserAId.CompareTo(row.UserBId) < 0);
    }
}
