using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Domain;
using Api.Tests.Helpers;

namespace Api.Tests.Dms;

public class DmSendReceiveTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public DmSendReceiveTests(TestWebApp factory) => _factory = factory;

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
    public async Task OpenDmThread_ForFriends_Returns200()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var resp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("id", out _));
        Assert.Equal(bId.ToString(), body.GetProperty("otherUser").GetProperty("userId").GetString());
    }

    [Fact]
    public async Task OpenDmThread_ForNonFriends_Returns403()
    {
        var (aClient, _, _) = await RegisterAndLoginAsync();
        var (_, _, bId) = await RegisterAndLoginAsync();

        var resp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task OpenDmThread_WhenBanned_Returns403()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        var resp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task OpenDmThread_IsIdempotent()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var resp1 = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var resp2 = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });

        var body1 = await resp1.Content.ReadFromJsonAsync<JsonElement>();
        var body2 = await resp2.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(body1.GetProperty("id").GetString(), body2.GetProperty("id").GetString());
    }

    [Fact]
    public async Task ListDmThreads_ShowsOpenedThread()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });

        var resp = await aClient.GetAsync("/api/dms");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task GetDmMessages_ReturnsSeededMessages()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = Guid.Parse(openBody.GetProperty("id").GetString()!);

        // Seed messages directly
        var db = _factory.CreateDbContext();
        db.DmMessages.AddRange(
            new DmMessage { Id = Guid.NewGuid(), DmThreadId = threadId, AuthorId = aId, Content = "hello", Watermark = 1, SentAt = DateTime.UtcNow },
            new DmMessage { Id = Guid.NewGuid(), DmThreadId = threadId, AuthorId = bId, Content = "hi", Watermark = 2, SentAt = DateTime.UtcNow }
        );
        await db.SaveChangesAsync();

        var resp = await aClient.GetAsync($"/api/dms/{threadId}/messages");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task GetDmThread_ByNonParticipant_Returns403()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        var (outsiderClient, _, _) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = openBody.GetProperty("id").GetString();

        var resp = await outsiderClient.GetAsync($"/api/dms/{threadId}");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task GetDmMessages_SoftDeleted_HasEmptyContent()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = Guid.Parse(openBody.GetProperty("id").GetString()!);

        // Seed a soft-deleted message
        var db = _factory.CreateDbContext();
        db.DmMessages.Add(new DmMessage
        {
            Id = Guid.NewGuid(), DmThreadId = threadId, AuthorId = aId,
            Content = "", DeletedAt = DateTime.UtcNow, Watermark = 1, SentAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var resp = await aClient.GetAsync($"/api/dms/{threadId}/messages");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items").EnumerateArray().First();
        Assert.Equal("", item.GetProperty("content").GetString());
        Assert.False(item.GetProperty("deletedAt").ValueKind == JsonValueKind.Null);
    }
}
