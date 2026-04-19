using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Domain;
using Api.Tests.Helpers;

namespace Api.Tests.Dms;

public class DmFrozenHistoryTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public DmFrozenHistoryTests(TestWebApp factory) => _factory = factory;

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
    public async Task FrozenThread_StillReturnsHistory()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = Guid.Parse(openBody.GetProperty("id").GetString()!);

        // Seed messages
        var db = _factory.CreateDbContext();
        for (int i = 1; i <= 3; i++)
        {
            db.DmMessages.Add(new DmMessage
            {
                Id = Guid.NewGuid(), DmThreadId = threadId, AuthorId = aId,
                Content = $"message {i}", Watermark = i, SentAt = DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync();

        // A bans B — freezes thread
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        // Both should still see the 3 messages
        var aResp = await aClient.GetAsync($"/api/dms/{threadId}/messages");
        var aBody = await aResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, aBody.GetProperty("items").GetArrayLength());

        var bResp = await bClient.GetAsync($"/api/dms/{threadId}/messages");
        var bBody = await bResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, bBody.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task FrozenThread_ShownInListWithFrozenAt()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        var listResp = await aClient.GetAsync("/api/dms");
        var body = await listResp.Content.ReadFromJsonAsync<JsonElement>();
        var thread = body.GetProperty("items").EnumerateArray().First();
        Assert.False(thread.GetProperty("frozenAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task GetDmThread_AfterOtherPartyDeleted_ShowsOtherPartyDeletedAt()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = Guid.Parse(openBody.GetProperty("id").GetString()!);

        // Simulate B's account deletion by setting other_party_deleted_at directly
        var db = _factory.CreateDbContext();
        var thread = await db.DmThreads.FindAsync(threadId);
        thread!.OtherPartyDeletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var freshResp = await aClient.GetAsync($"/api/dms/{threadId}");
        var freshBody = await freshResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(freshBody.GetProperty("otherPartyDeletedAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task UnbanUser_UnfreezesDmThread()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        await aClient.PostAsJsonAsync($"/api/friends/{bId}/ban", new { });

        // Verify frozen
        var frozenResp = await aClient.GetAsync("/api/dms");
        var frozenBody = await frozenResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(frozenBody.GetProperty("items").EnumerateArray().First()
            .GetProperty("frozenAt").ValueKind == JsonValueKind.Null);

        // Unban
        await aClient.DeleteAsync($"/api/friends/{bId}/ban");

        // Should be unfrozen
        var unfrozenResp = await aClient.GetAsync("/api/dms");
        var unfrozenBody = await unfrozenResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(unfrozenBody.GetProperty("items").EnumerateArray().First()
            .GetProperty("frozenAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task DmMessagePagination_BeforeWatermark_Works()
    {
        var (aClient, _, aId) = await RegisterAndLoginAsync();
        var (bClient, bUsername, bId) = await RegisterAndLoginAsync();
        await MakeFriendsAsync(aClient, aId, bUsername, bClient);

        var openResp = await aClient.PostAsJsonAsync("/api/dms/open", new { userId = bId });
        var openBody = await openResp.Content.ReadFromJsonAsync<JsonElement>();
        var threadId = Guid.Parse(openBody.GetProperty("id").GetString()!);

        // Seed 5 messages
        var db = _factory.CreateDbContext();
        for (int i = 1; i <= 5; i++)
        {
            db.DmMessages.Add(new DmMessage
            {
                Id = Guid.NewGuid(), DmThreadId = threadId, AuthorId = aId,
                Content = $"msg{i}", Watermark = i, SentAt = DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync();

        // Get messages before watermark 4 (should return 1,2,3 in DESC order)
        var resp = await aClient.GetAsync($"/api/dms/{threadId}/messages?before=4&limit=10");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(3, items.Count);
        Assert.Equal(3, items[0].GetProperty("watermark").GetInt64()); // DESC order
    }
}
