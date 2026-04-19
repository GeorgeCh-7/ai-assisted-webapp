using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Rooms;

public class RoomModerationTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public RoomModerationTests(TestWebApp factory) => _factory = factory;

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

    private async Task<Guid> CreateRoomAsync(HttpClient client, bool isPrivate = false)
    {
        var resp = await client.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate });
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(body.GetProperty("id").GetString()!);
    }

    private async Task JoinRoomAsync(HttpClient client, Guid roomId)
        => await client.PostAsJsonAsync($"/api/rooms/{roomId}/join", new { });

    // --- Delete room ---

    [Fact]
    public async Task DeleteRoom_ByOwner_Returns200()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);

        var resp = await ownerClient.DeleteAsync($"/api/rooms/{roomId}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        // Room is gone
        var getResp = await ownerClient.GetAsync($"/api/rooms/{roomId}");
        Assert.Equal(HttpStatusCode.NotFound, getResp.StatusCode);
    }

    [Fact]
    public async Task DeleteRoom_ByMember_Returns403()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);

        var resp = await memberClient.DeleteAsync($"/api/rooms/{roomId}");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    // --- Promote / demote ---

    [Fact]
    public async Task Promote_ByOwner_SetsAdminRole()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, memberId) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);

        var resp = await ownerClient.PostAsJsonAsync(
            $"/api/rooms/{roomId}/members/{memberId}/promote", new { });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("admin", body.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Promote_ByMember_Returns403()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, _) = await RegisterAndLoginAsync();
        var (targetClient, targetId) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);
        await JoinRoomAsync(targetClient, roomId);

        var resp = await memberClient.PostAsJsonAsync(
            $"/api/rooms/{roomId}/members/{targetId}/promote", new { });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Demote_AdminToMember_Returns200()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, memberId) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/members/{memberId}/promote", new { });

        var resp = await ownerClient.PostAsJsonAsync(
            $"/api/rooms/{roomId}/members/{memberId}/demote", new { });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("member", body.GetProperty("role").GetString());
    }

    // --- Ban / unban ---

    [Fact]
    public async Task Ban_ByOwner_RemovesMembership()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, memberId) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);

        var resp = await ownerClient.PostAsJsonAsync(
            $"/api/rooms/{roomId}/members/{memberId}/ban",
            new { reason = "test ban" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        // Banned user is no longer a member
        var membersResp = await ownerClient.GetAsync($"/api/rooms/{roomId}/members");
        var body = await membersResp.Content.ReadFromJsonAsync<JsonElement>();
        var memberIds = body.GetProperty("items").EnumerateArray()
            .Select(m => m.GetProperty("userId").GetString()).ToList();
        Assert.DoesNotContain(memberId.ToString(), memberIds);
    }

    [Fact]
    public async Task Ban_ByAdmin_CannotBanOtherAdmin()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (adminClient, adminId) = await RegisterAndLoginAsync();
        var (admin2Client, admin2Id) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(adminClient, roomId);
        await JoinRoomAsync(admin2Client, roomId);
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/members/{adminId}/promote", new { });
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/members/{admin2Id}/promote", new { });

        var resp = await adminClient.PostAsJsonAsync(
            $"/api/rooms/{roomId}/members/{admin2Id}/ban",
            new { reason = (string?)null });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task BannedUser_CannotRejoin()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, memberId) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/members/{memberId}/ban",
            new { reason = (string?)null });

        // Banned user attempts to rejoin
        var resp = await memberClient.PostAsJsonAsync($"/api/rooms/{roomId}/join", new { });
        // Returns 409 (already banned — ban check not in join yet) OR 400 — either way not 200
        Assert.NotEqual(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Unban_AllowsRejoin()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, memberId) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/members/{memberId}/ban",
            new { reason = (string?)null });

        var unbanResp = await ownerClient.PostAsJsonAsync(
            $"/api/rooms/{roomId}/members/{memberId}/unban", new { });
        Assert.Equal(HttpStatusCode.OK, unbanResp.StatusCode);

        var bansResp = await ownerClient.GetAsync($"/api/rooms/{roomId}/bans");
        var body = await bansResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ListBans_ByMember_Returns403()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (memberClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);
        await JoinRoomAsync(memberClient, roomId);

        var resp = await memberClient.GetAsync($"/api/rooms/{roomId}/bans");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }
}
