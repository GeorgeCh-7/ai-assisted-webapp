using Api.Data;
using Api.Domain;
using Api.Features.Auth;
using Api.Features.Dms;
using Api.Features.Files;
using Api.Features.Friends;
using Api.Features.Messages;
using Api.Features.Presence;
using Api.Features.Rooms;
using Api.Hubs;
using Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Serilog.Formatting.Compact;

var builder = WebApplication.CreateBuilder(args);

// --- Logging ---
builder.Host.UseSerilog((ctx, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("App", "ChatApi")
    .WriteTo.Console(new RenderedCompactJsonFormatter()));

// --- DB ---
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
           .UseSnakeCaseNamingConvention());

// --- Identity ---
builder.Services
    .AddIdentityCore<AppUser>(opts =>
    {
        opts.Password.RequireNonAlphanumeric = false;
        opts.Password.RequireUppercase = false;
        opts.Password.RequireDigit = false;
        opts.Password.RequireLowercase = false;
    })
    .AddEntityFrameworkStores<AppDbContext>();

builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddIdentityCookies();

builder.Services.ConfigureApplicationCookie(opts =>
{
    opts.Cookie.Name = ".chat.session";
    opts.Cookie.SameSite = SameSiteMode.Lax;
    opts.Cookie.HttpOnly = true;
    opts.Cookie.SecurePolicy = CookieSecurePolicy.None;
    opts.Events.OnRedirectToLogin = async ctx =>
    {
        ctx.Response.StatusCode = 401;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new { error = "Unauthenticated" });
    };
    opts.Events.OnRedirectToAccessDenied = async ctx =>
    {
        ctx.Response.StatusCode = 403;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new { error = "Forbidden" });
    };
    opts.Events.OnValidatePrincipal = SessionValidation.ValidateAsync;
});

// Argon2 hasher — registered after AddIdentityCore so it overrides Identity's BCrypt default
builder.Services.AddSingleton<IPasswordHasher<AppUser>, Argon2PasswordHasher>();

// --- Antiforgery ---
builder.Services.AddAntiforgery(opts =>
{
	opts.HeaderName = "X-XSRF-TOKEN";
	opts.Cookie.Name = ".chat.antiforgery";    // internal encrypted cookie token
	opts.Cookie.HttpOnly = true;               // internal, no JS access
	opts.Cookie.SameSite = SameSiteMode.Lax;
	opts.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;  // false in dev, true in prod
});

// --- SignalR + Presence ---
builder.Services.AddSignalR();
builder.Services.AddSingleton<PresenceService>();

// --- MemoryCache (file access checks, Phase 2) ---
builder.Services.AddMemoryCache();

// --- File storage ---
builder.Services.AddSingleton<FileStorageService>();

// --- Background services ---
builder.Services.AddHostedService<AfkSweeper>();
builder.Services.AddHostedService<OrphanFileSweeper>();

// --- Swagger ---
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// --- CORS — specific origin required when cookies are involved ---
const string DevCors = "DevCors";
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCors, policy => policy
        .WithOrigins("http://localhost:5173")
        .AllowCredentials()
        .AllowAnyMethod()
        .AllowAnyHeader());
});

var app = builder.Build();

// --- Schema ---
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

// Middleware order is significant — CORS before auth, auth before antiforgery
app.UseCors(DevCors);
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();

app.UseSwagger();
app.UseSwaggerUI();

// --- Routes ---
app.MapGet("/", () => Results.Redirect("/swagger"));
app.MapGet("/health", () => Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow }))
   .WithName("Health");

app.MapAuthEndpoints();
app.MapRoomsEndpoints();
app.MapRoomModerationEndpoints();
app.MapRoomInvitationEndpoints();
app.MapMessagesEndpoints();
app.MapMessageMutationEndpoints();
app.MapFriendsEndpoints();
app.MapDmEndpoints();
app.MapFileEndpoints();
app.MapSessionsEndpoints();
app.MapPasswordEndpoints();
app.MapAccountDeletionEndpoints();
app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization();

app.Run();

// Exposed for WebApplicationFactory in Api.Tests
public partial class Program { }
