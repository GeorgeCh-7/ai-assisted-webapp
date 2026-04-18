using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Rooms;

public class RoomMembershipTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public RoomMembershipTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];
    private static string UniqueRoomName() => $"room-{Guid.NewGuid().ToString("N")[..8]}";

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
    public async Task CreateRoom_CreatorBecomesOwner()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var resp = await client.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "test" });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("owner", body.GetProperty("myRole").GetString());
        Assert.True(body.GetProperty("isMember").GetBoolean());
        Assert.Equal(1, body.GetProperty("memberCount").GetInt32());
    }

    [Fact]
    public async Task CreateRoom_DuplicateName_Returns409()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var name = UniqueRoomName();
        await client.PostAsJsonAsync("/api/rooms", new { name, description = "" });
        var resp = await client.PostAsJsonAsync("/api/rooms", new { name, description = "" });
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task JoinRoom_NonMember_BecomesMember()
    {
        var (owner, _) = await RegisterAndLoginAsync();
        var roomResp = await owner.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "" });
        var roomId = (await roomResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        var (joiner, _) = await RegisterAndLoginAsync();
        var resp = await joiner.PostAsync($"/api/rooms/{roomId}/join", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("member", body.GetProperty("myRole").GetString());
    }

    [Fact]
    public async Task JoinRoom_AlreadyMember_Returns409()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var roomResp = await client.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "" });
        var roomId = (await roomResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        var resp = await client.PostAsync($"/api/rooms/{roomId}/join", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task LeaveRoom_Owner_Returns403()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var roomResp = await client.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "" });
        var roomId = (await roomResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        var resp = await client.PostAsync($"/api/rooms/{roomId}/leave", null);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Owner cannot leave their own room", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task LeaveRoom_Member_Returns200()
    {
        var (owner, _) = await RegisterAndLoginAsync();
        var roomResp = await owner.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "" });
        var roomId = (await roomResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        var (member, _) = await RegisterAndLoginAsync();
        await member.PostAsync($"/api/rooms/{roomId}/join", null);
        var resp = await member.PostAsync($"/api/rooms/{roomId}/leave", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task LeaveRoom_NotMember_Returns400()
    {
        var (owner, _) = await RegisterAndLoginAsync();
        var roomResp = await owner.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "" });
        var roomId = (await roomResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetString()!;

        var (nonMember, _) = await RegisterAndLoginAsync();
        var resp = await nonMember.PostAsync($"/api/rooms/{roomId}/leave", null);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
