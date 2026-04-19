using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Files;

public class FileAccessControlTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public FileAccessControlTests(TestWebApp factory) => _factory = factory;

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

    private async Task<Guid> CreateRoomAsync(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/rooms",
            new { name = $"r{Guid.NewGuid():N}"[..16], description = "" });
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(body.GetProperty("id").GetString()!);
    }

    private static MultipartFormDataContent BuildUpload(Guid scopeId, string scope = "room")
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[] { 0x50, 0x44, 0x46 });
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        form.Add(fileContent, "file", "test.pdf");
        form.Add(new StringContent(scope), "scope");
        form.Add(new StringContent(scopeId.ToString()), "scopeId");
        return form;
    }

    [Fact]
    public async Task Upload_ByRoomMember_Succeeds_And_CanDownload()
    {
        var (memberClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(memberClient);

        using var form = BuildUpload(roomId);
        var uploadResp = await memberClient.PostAsync("/api/files", form);
        Assert.Equal(HttpStatusCode.Created, uploadResp.StatusCode);

        var uploadBody = await uploadResp.Content.ReadFromJsonAsync<JsonElement>();
        var fileId = uploadBody.GetProperty("id").GetString();

        var downloadResp = await memberClient.GetAsync($"/api/files/{fileId}");
        Assert.Equal(HttpStatusCode.OK, downloadResp.StatusCode);
    }

    [Fact]
    public async Task Download_ByNonMember_Returns403()
    {
        var (memberClient, _) = await RegisterAndLoginAsync();
        var (outsiderClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(memberClient);

        using var form = BuildUpload(roomId);
        var uploadResp = await memberClient.PostAsync("/api/files", form);
        var uploadBody = await uploadResp.Content.ReadFromJsonAsync<JsonElement>();
        var fileId = uploadBody.GetProperty("id").GetString();

        var downloadResp = await outsiderClient.GetAsync($"/api/files/{fileId}");
        Assert.Equal(HttpStatusCode.Forbidden, downloadResp.StatusCode);
    }

    [Fact]
    public async Task Upload_ByNonMember_Returns403()
    {
        var (ownerClient, _) = await RegisterAndLoginAsync();
        var (outsiderClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(ownerClient);

        using var form = BuildUpload(roomId);
        var resp = await outsiderClient.PostAsync("/api/files", form);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Download_FileNotFound_Returns404()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var resp = await client.GetAsync($"/api/files/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Uploader_CanDownload_BeforeAttachedToMessage()
    {
        var (uploaderClient, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(uploaderClient);

        // Upload creates row with message_id = NULL (pre-commit orphan)
        using var form = BuildUpload(roomId);
        var uploadResp = await uploaderClient.PostAsync("/api/files", form);
        var uploadBody = await uploadResp.Content.ReadFromJsonAsync<JsonElement>();
        var fileId = uploadBody.GetProperty("id").GetString();

        // Uploader should be able to download their own file
        var downloadResp = await uploaderClient.GetAsync($"/api/files/{fileId}");
        Assert.Equal(HttpStatusCode.OK, downloadResp.StatusCode);
    }
}
