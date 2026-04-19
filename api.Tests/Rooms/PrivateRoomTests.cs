using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Rooms;

public class PrivateRoomTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public PrivateRoomTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];
    private static string UniqueRoomName() => $"room-{Guid.NewGuid().ToString("N")[..8]}";

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
    public async Task PrivateRoom_NotInCatalog_ForNonMember()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (otherClient, _, _) = await RegisterAndLoginAsync();

        var name = UniqueRoomName();
        await ownerClient.PostAsJsonAsync("/api/rooms", new { name, description = "", isPrivate = true });

        var resp = await otherClient.GetAsync($"/api/rooms?q={name}");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task PrivateRoom_InCatalog_ForOwner()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();

        var name = UniqueRoomName();
        await ownerClient.PostAsJsonAsync("/api/rooms", new { name, description = "", isPrivate = true });

        var resp = await ownerClient.GetAsync($"/api/rooms?q={name}");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task JoinRoom_PrivateRoom_Returns403()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (otherClient, _, _) = await RegisterAndLoginAsync();

        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate = true });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        var resp = await otherClient.PostAsJsonAsync($"/api/rooms/{roomId}/join", new { });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task SendInvitation_PublicRoom_Returns400()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (_, otherUsername, _) = await RegisterAndLoginAsync();

        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate = false });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        var resp = await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = otherUsername });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Public rooms do not use invitations", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task InvitationFlow_AcceptJoinsRoom()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (inviteeClient, inviteeUsername, inviteeId) = await RegisterAndLoginAsync();

        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate = true });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        // Send invitation
        var invResp = await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });
        Assert.Equal(HttpStatusCode.Created, invResp.StatusCode);
        var inv = await invResp.Content.ReadFromJsonAsync<JsonElement>();
        var invitationId = inv.GetProperty("id").GetString();

        // Invitee sees it
        var listResp = await inviteeClient.GetAsync("/api/invitations");
        var listBody = await listResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, listBody.GetProperty("items").GetArrayLength());

        // Accept
        var acceptResp = await inviteeClient.PostAsJsonAsync($"/api/invitations/{invitationId}/accept", new { });
        Assert.Equal(HttpStatusCode.OK, acceptResp.StatusCode);

        // Invitee is now a member
        var roomResp = await inviteeClient.GetAsync($"/api/rooms/{roomId}");
        var roomBody = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(roomBody.GetProperty("isMember").GetBoolean());
    }

    [Fact]
    public async Task InvitationFlow_Decline_DoesNotJoin()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (inviteeClient, inviteeUsername, _) = await RegisterAndLoginAsync();

        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate = true });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        var invResp = await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });
        var inv = await invResp.Content.ReadFromJsonAsync<JsonElement>();
        var invitationId = inv.GetProperty("id").GetString();

        var declineResp = await inviteeClient.PostAsJsonAsync($"/api/invitations/{invitationId}/decline", new { });
        Assert.Equal(HttpStatusCode.OK, declineResp.StatusCode);

        var roomResp = await inviteeClient.GetAsync($"/api/rooms/{roomId}");
        var roomBody = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(roomBody.GetProperty("isMember").GetBoolean());
    }

    [Fact]
    public async Task SendInvitation_DuplicatePending_Returns400()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (_, inviteeUsername, _) = await RegisterAndLoginAsync();

        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate = true });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });
        var resp = await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invitation already pending", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SendInvitation_AlreadyMember_Returns400()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (inviteeClient, inviteeUsername, _) = await RegisterAndLoginAsync();

        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name = UniqueRoomName(), description = "", isPrivate = true });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        // Invite and accept
        var invResp = await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });
        var inv = await invResp.Content.ReadFromJsonAsync<JsonElement>();
        await inviteeClient.PostAsJsonAsync($"/api/invitations/{inv.GetProperty("id").GetString()}/accept", new { });

        // Invite again
        var resp = await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("User is already a member", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task PrivateRoom_InCatalog_ForInvitee_WithPendingInvitation()
    {
        var (ownerClient, _, _) = await RegisterAndLoginAsync();
        var (inviteeClient, inviteeUsername, _) = await RegisterAndLoginAsync();

        var name = UniqueRoomName();
        var createResp = await ownerClient.PostAsJsonAsync("/api/rooms",
            new { name, description = "", isPrivate = true });
        var room = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = room.GetProperty("id").GetString();

        // Before invitation — not visible
        var before = await inviteeClient.GetAsync($"/api/rooms?q={name}");
        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, beforeBody.GetProperty("items").GetArrayLength());

        // Send invitation
        await ownerClient.PostAsJsonAsync($"/api/rooms/{roomId}/invitations",
            new { username = inviteeUsername });

        // After invitation — now visible
        var after = await inviteeClient.GetAsync($"/api/rooms?q={name}");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, afterBody.GetProperty("items").GetArrayLength());
    }
}
