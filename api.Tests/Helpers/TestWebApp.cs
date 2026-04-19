using System.Net.Http.Json;
using Api.Data;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Helpers;

public sealed class TestWebApp : WebApplicationFactory<Program>
{
    // Each fixture gets its own isolated in-memory database
    public string DbName { get; } = Guid.NewGuid().ToString();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            // EF Core 9 registers options via IDbContextOptionsConfiguration<T> — must remove
            // both that AND the legacy DbContextOptions<T> descriptor to avoid dual-provider error.
            var toRemove = services
                .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>)
                         || d.ServiceType == typeof(IDbContextOptionsConfiguration<AppDbContext>))
                .ToList();
            foreach (var d in toRemove) services.Remove(d);

            services.AddDbContext<AppDbContext>(opts =>
                opts.UseInMemoryDatabase(DbName));

            // No-op antiforgery — CSRF flow is verified in browser integration, not here
            services.AddSingleton<IAntiforgery, NoOpAntiforgery>();
        });
    }

    public AppDbContext CreateDbContext()
    {
        var scope = Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<AppDbContext>();
    }
}

public static class HttpClientExtensions
{
    public static Task<HttpResponseMessage> DeleteWithJsonAsync<T>(
        this HttpClient client, string requestUri, T value)
    {
        var request = new HttpRequestMessage(HttpMethod.Delete, requestUri)
        {
            Content = JsonContent.Create(value)
        };
        return client.SendAsync(request);
    }
}

public sealed class NoOpAntiforgery : IAntiforgery
{
    private static readonly AntiforgeryTokenSet _token =
        new("test-request", "test-cookie", "__RequestVerificationToken", "X-XSRF-TOKEN");

    public AntiforgeryTokenSet GetAndStoreTokens(HttpContext context) => _token;
    public AntiforgeryTokenSet GetTokens(HttpContext context) => _token;
    public Task<bool> IsRequestValidAsync(HttpContext context) => Task.FromResult(true);
    public void SetCookieTokenAndHeader(HttpContext context) { }
    public Task ValidateRequestAsync(HttpContext context) => Task.CompletedTask;
}
