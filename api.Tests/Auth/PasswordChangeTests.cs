using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;

namespace Api.Tests.Auth;

public class PasswordChangeTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public PasswordChangeTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    private async Task<(HttpClient client, string email, string password)> RegisterAndLoginAsync()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var password = "password123";
        var username = UniqueUsername();
        await client.PostAsJsonAsync("/api/auth/register", new { username, email, password });
        await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        return (client, email, password);
    }

    [Fact]
    public async Task ChangePassword_CorrectCurrent_Returns200()
    {
        var (client, _, _) = await RegisterAndLoginAsync();
        var resp = await client.PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "password123", newPassword = "newpass456" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WrongCurrent_Returns400()
    {
        var (client, _, _) = await RegisterAndLoginAsync();
        var resp = await client.PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "wrongpassword", newPassword = "newpass456" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Current password incorrect", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ChangePassword_TooShortNew_Returns400()
    {
        var (client, _, _) = await RegisterAndLoginAsync();
        var resp = await client.PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "password123", newPassword = "ab" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Password must be at least 6 characters", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ChangePassword_OldPasswordNoLongerWorks()
    {
        var (client, email, _) = await RegisterAndLoginAsync();
        await client.PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "password123", newPassword = "newpass456" });

        // Try logging in with old password
        var freshClient = _factory.CreateClient();
        var loginResp = await freshClient.PostAsJsonAsync("/api/auth/login",
            new { email, password = "password123" });
        Assert.Equal(HttpStatusCode.Unauthorized, loginResp.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_NewPasswordWorks()
    {
        var (client, email, _) = await RegisterAndLoginAsync();
        await client.PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = "password123", newPassword = "newpass456" });

        // Try logging in with new password
        var freshClient = _factory.CreateClient();
        var loginResp = await freshClient.PostAsJsonAsync("/api/auth/login",
            new { email, password = "newpass456" });
        Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
    }

    [Fact]
    public async Task ForgotPassword_Returns200WithToken()
    {
        var (_, email, _) = await RegisterAndLoginAsync();
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("resetToken", out _));
        Assert.True(body.TryGetProperty("expiresAt", out _));
    }

    [Fact]
    public async Task ForgotPassword_UnknownEmail_Returns200WithFakeToken()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/forgot-password",
            new { email = "nonexistent@example.com" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("resetToken", out _));
    }

    [Fact]
    public async Task ResetPassword_ValidToken_SetsNewPassword()
    {
        var (_, email, _) = await RegisterAndLoginAsync();
        var client = _factory.CreateClient();

        var forgotResp = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email });
        var forgotBody = await forgotResp.Content.ReadFromJsonAsync<JsonElement>();
        var token = forgotBody.GetProperty("resetToken").GetString();

        var resetResp = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "resetpass789" });
        Assert.Equal(HttpStatusCode.OK, resetResp.StatusCode);

        // New password should work
        var loginResp = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "resetpass789" });
        Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_TokenConsumedOnce_SecondUseReturns400()
    {
        var (_, email, _) = await RegisterAndLoginAsync();
        var client = _factory.CreateClient();

        var forgotResp = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email });
        var forgotBody = await forgotResp.Content.ReadFromJsonAsync<JsonElement>();
        var token = forgotBody.GetProperty("resetToken").GetString();

        await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "resetpass789" });

        var resp2 = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "anotherpass" });
        Assert.Equal(HttpStatusCode.BadRequest, resp2.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_InvalidToken_Returns400()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token = Guid.NewGuid(), newPassword = "newpass456" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Token invalid or expired", body.GetProperty("error").GetString());
    }
}
