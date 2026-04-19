using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace Api.Tests.Messages;

public class MessageEditDeleteTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public MessageEditDeleteTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    private async Task<(HttpClient client, Guid userId)> RegisterAndLoginAsync()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();
        var regResp = await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        var body = await regResp.Content.ReadFromJsonAsync<JsonElement>();
        var userId = Guid.Parse(body.GetProperty("id").GetString()!);
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });
        return (client, userId);
    }

    [Fact]
    public async Task EditMessage_ByAuthor_Returns200WithUpdatedContent()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = ownerId,
            Content = "original", Watermark = 1,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        var req = new HttpRequestMessage(HttpMethod.Patch, $"/api/messages/{msg.Id}")
        {
            Content = JsonContent.Create(new { content = "edited" }),
        };
        var resp = await ownerClient.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("edited", body.GetProperty("content").GetString());
        Assert.False(body.GetProperty("editedAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task EditMessage_ByNonAuthor_Returns403()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var (otherClient, _) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        await otherClient.PostAsJsonAsync($"/api/rooms/{roomId}/join", new { });

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = ownerId,
            Content = "original", Watermark = 1,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        var req = new HttpRequestMessage(HttpMethod.Patch, $"/api/messages/{msg.Id}")
        {
            Content = JsonContent.Create(new { content = "hacked" }),
        };
        var resp = await otherClient.SendAsync(req);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteMessage_ByAuthor_SoftDeletes()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = ownerId,
            Content = "to delete", Watermark = 1,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        var resp = await ownerClient.DeleteAsync($"/api/messages/{msg.Id}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        // Verify via REST — EF InMemory doesn't share writes across scopes
        var listResp = await ownerClient.GetAsync($"/api/rooms/{roomId}/messages");
        var listBody = await listResp.Content.ReadFromJsonAsync<JsonElement>();
        var item = listBody.GetProperty("items").EnumerateArray().First(m =>
            m.GetProperty("id").GetString() == msg.Id.ToString());
        Assert.Equal("", item.GetProperty("content").GetString());
        Assert.False(item.GetProperty("deletedAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task DeleteMessage_ByAdminOnOtherMessage_Returns200()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var (memberClient, memberId) = await RegisterAndLoginAsync();
        var (adminClient, adminId) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        await memberClient.PostAsJsonAsync($"/api/rooms/{roomId}/join", new { });
        await adminClient.PostAsJsonAsync($"/api/rooms/{roomId}/join", new { });
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/members/{adminId}/promote", new { });

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = memberId,
            Content = "member's message", Watermark = 1,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        // Admin deletes member's message
        var resp = await adminClient.DeleteAsync($"/api/messages/{msg.Id}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteMessage_ByNonMember_Returns403()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var (outsiderClient, _) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = ownerId,
            Content = "owner message", Watermark = 1,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        var resp = await outsiderClient.DeleteAsync($"/api/messages/{msg.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteMessage_AlreadyDeleted_IsIdempotent()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = ownerId,
            Content = "to delete", Watermark = 1,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        await ownerClient.DeleteAsync($"/api/messages/{msg.Id}");
        var resp2 = await ownerClient.DeleteAsync($"/api/messages/{msg.Id}");
        Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);
    }

    [Fact]
    public async Task GetMessages_SoftDeletedMessage_HasEmptyContentAndDeletedAt()
    {
        var (ownerClient, ownerId) = await RegisterAndLoginAsync();
        var db = _factory.CreateDbContext();

        var roomResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var room = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(room.GetProperty("id").GetString()!);

        var msg = new Api.Domain.Message
        {
            Id = Guid.NewGuid(), RoomId = roomId, AuthorId = ownerId,
            Content = "will be deleted", Watermark = 1, DeletedAt = DateTime.UtcNow,
        };
        db.Messages.Add(msg);
        await db.SaveChangesAsync();

        var resp = await ownerClient.GetAsync($"/api/rooms/{roomId}/messages");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items").EnumerateArray().First();
        Assert.Equal("", item.GetProperty("content").GetString());
        Assert.False(item.GetProperty("deletedAt").ValueKind == JsonValueKind.Null);
    }
}
