using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Tests.Helpers;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.Auth;

public class AuthEndpointsTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public AuthEndpointsTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    [Fact]
    public async Task Register_NewUser_Returns200WithUserShape()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/register", new
        {
            username = UniqueUsername(),
            email = UniqueEmail(),
            password = "password123"
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("id", out _));
        Assert.True(body.TryGetProperty("username", out _));
        Assert.True(body.TryGetProperty("email", out _));
    }

    [Fact]
    public async Task Register_DuplicateEmail_Returns400()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username = UniqueUsername(), email, password = "password123" });
        var resp = await client.PostAsJsonAsync("/api/auth/register",
            new { username = UniqueUsername(), email, password = "password123" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Email already registered", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Register_DuplicateUsername_Returns400()
    {
        var client = _factory.CreateClient();
        var username = UniqueUsername();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username, email = UniqueEmail(), password = "password123" });
        var resp = await client.PostAsJsonAsync("/api/auth/register",
            new { username, email = UniqueEmail(), password = "password123" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Username already taken", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Register_ShortPassword_Returns400()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/register",
            new { username = UniqueUsername(), email = UniqueEmail(), password = "abc" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Password must be at least 6 characters", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Login_ValidCredentials_SetsCookieAndReturnsUser()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });

        var resp = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "password123" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(username, body.GetProperty("username").GetString());
    }

    [Fact]
    public async Task Login_WrongPassword_Returns401()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username = UniqueUsername(), email, password = "password123" });

        var resp = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "wrongpassword" });
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid credentials", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Login_UnknownEmail_Returns401()
    {
        var client = _factory.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/login",
            new { email = UniqueEmail(), password = "password123" });
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task GetMe_Unauthenticated_Returns401WithErrorEnvelope()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });
        var resp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Unauthenticated", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetMe_AfterLogin_ReturnsUser()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });

        var resp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(username, body.GetProperty("username").GetString());
    }

    [Fact]
    public async Task Logout_ClearsSession()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.PostAsJsonAsync("/api/auth/register",
            new { username = UniqueUsername(), email, password = "password123" });
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });

        var logoutResp = await client.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.OK, logoutResp.StatusCode);

        var meResp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, meResp.StatusCode);
    }
}
