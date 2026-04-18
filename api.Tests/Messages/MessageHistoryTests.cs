using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Domain;
using Api.Tests.Helpers;

namespace Api.Tests.Messages;

public class MessageHistoryTests : IClassFixture<TestWebApp>
{
    private readonly TestWebApp _factory;
    public MessageHistoryTests(TestWebApp factory) => _factory = factory;

    private static string UniqueEmail() => $"{Guid.NewGuid():N}@test.com";
    private static string UniqueUsername() => Guid.NewGuid().ToString("N")[..12];

    // Spec: seed 200 messages (watermarks 1–200), paginate with limit=50,
    // assert DESC/ASC ordering and nextCursor chaining.
    [Fact]
    public async Task Pagination_200Messages_CursorsTraverseAll()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        var username = UniqueUsername();

        // Register + login
        var regResp = await client.PostAsJsonAsync("/api/auth/register",
            new { username, email, password = "password123" });
        var regBody = await regResp.Content.ReadFromJsonAsync<JsonElement>();
        var userId = Guid.Parse(regBody.GetProperty("id").GetString()!);
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password123" });

        // Create room via HTTP so membership row exists
        var roomResp = await client.PostAsJsonAsync("/api/rooms",
            new { name = $"room-{Guid.NewGuid():N}", description = "" });
        Assert.Equal(HttpStatusCode.Created, roomResp.StatusCode);
        var roomBody = await roomResp.Content.ReadFromJsonAsync<JsonElement>();
        var roomId = Guid.Parse(roomBody.GetProperty("id").GetString()!);

        // Seed 200 messages directly in DB (watermarks 1–200)
        using (var db = _factory.CreateDbContext())
        {
            var msgs = Enumerable.Range(1, 200).Select(i => new Message
            {
                Id = Guid.NewGuid(),
                RoomId = roomId,
                AuthorId = userId,
                Content = $"msg {i}",
                Watermark = i,
                SentAt = DateTime.UtcNow,
            });
            db.Messages.AddRange(msgs);
            await db.SaveChangesAsync();
        }

        // Page 1: no cursor, limit=50, DESC → watermarks 200–151
        var p1 = await GetMessages(client, roomId, limit: 50);
        AssertWatermarks(p1, 200, 151, descending: true);
        Assert.NotNull(p1.NextCursor);

        // Page 2: before=151, limit=50 → watermarks 150–101
        var p2 = await GetMessages(client, roomId, before: 151, limit: 50);
        AssertWatermarks(p2, 150, 101, descending: true);
        Assert.NotNull(p2.NextCursor);

        // Page 3: before=101 → watermarks 100–51
        var p3 = await GetMessages(client, roomId, before: 101, limit: 50);
        AssertWatermarks(p3, 100, 51, descending: true);

        // Page 4: before=51 → watermarks 50–1, no more
        var p4 = await GetMessages(client, roomId, before: 51, limit: 50);
        AssertWatermarks(p4, 50, 1, descending: true);
        Assert.Null(p4.NextCursor);

        // Spot check: before=100 → watermarks 99–50
        var spot = await GetMessages(client, roomId, before: 100, limit: 50);
        AssertWatermarks(spot, 99, 50, descending: true);

        // Gap recovery: since=150 → watermarks 151–200, ASC
        var since = await GetMessages(client, roomId, since: 150, limit: 50);
        AssertWatermarks(since, 151, 200, descending: false);
        Assert.Null(since.NextCursor); // exactly 50 items — no more when 200 messages and we ask for watermarks > 150
    }

    private static async Task<MessagePage> GetMessages(
        HttpClient client, Guid roomId,
        long? before = null, long? since = null, int limit = 50)
    {
        var qs = $"limit={limit}";
        if (before.HasValue) qs += $"&before={before}";
        if (since.HasValue) qs += $"&since={since}";
        var resp = await client.GetAsync($"/api/rooms/{roomId}/messages?{qs}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(x => x.GetProperty("watermark").GetInt64())
            .ToList();
        var cursor = body.GetProperty("nextCursor").ValueKind == JsonValueKind.Null
            ? null
            : body.GetProperty("nextCursor").GetString();
        return new MessagePage(items, cursor);
    }

    private static void AssertWatermarks(MessagePage page, long first, long last, bool descending)
    {
        var expected = descending
            ? Enumerable.Range((int)last, (int)(first - last + 1)).Select(i => (long)i).Reverse().ToList()
            : Enumerable.Range((int)first, (int)(last - first + 1)).Select(i => (long)i).ToList();
        Assert.Equal(expected, page.Watermarks);
    }

    private record MessagePage(List<long> Watermarks, string? NextCursor);
}
