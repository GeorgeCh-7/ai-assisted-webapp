using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Files;

public class FileSizeLimitTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public FileSizeLimitTests(TestWebApp factory) => _factory = factory;

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

    private static MultipartFormDataContent BuildUpload(
        byte[] bytes, string contentType, Guid scopeId, string scope = "room")
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(fileContent, "file", "test-file");
        form.Add(new StringContent(scope), "scope");
        form.Add(new StringContent(scopeId.ToString()), "scopeId");
        return form;
    }

    [Fact]
    public async Task ImageExceeding3MB_Returns413()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(client);

        var bytes = new byte[3 * 1024 * 1024 + 1]; // 3 MB + 1 byte
        using var form = BuildUpload(bytes, "image/png", roomId);

        var resp = await client.PostAsync("/api/files", form);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Image exceeds 3 MB", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ImageUnder3MB_Uploads_Successfully()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(client);

        var bytes = new byte[1024]; // 1 KB image — well under limit
        using var form = BuildUpload(bytes, "image/jpeg", roomId);

        var resp = await client.PostAsync("/api/files", form);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }

    [Fact]
    public async Task FileExceeding20MB_Returns413()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(client);

        var bytes = new byte[20 * 1024 * 1024 + 1]; // 20 MB + 1 byte
        using var form = BuildUpload(bytes, "application/octet-stream", roomId);

        var resp = await client.PostAsync("/api/files", form);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("File exceeds 20 MB", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task FileUnder20MB_NonImage_Uploads_Successfully()
    {
        var (client, _) = await RegisterAndLoginAsync();
        var roomId = await CreateRoomAsync(client);

        var bytes = new byte[512 * 1024]; // 512 KB
        using var form = BuildUpload(bytes, "application/pdf", roomId);

        var resp = await client.PostAsync("/api/files", form);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }
}
