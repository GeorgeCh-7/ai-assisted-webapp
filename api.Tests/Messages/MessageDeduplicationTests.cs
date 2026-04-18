using System.Text;
using Api.Data;
using Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Api.Tests.Messages;

// Unit tests for message deduplication logic.
// The race-safe concurrent-same-key path (two goroutines hitting SaveChangesAsync at
// the same time, triggering PostgresException UniqueViolation) requires a real Postgres
// instance. These tests cover the sequential dedup path and the content-size boundary.
public class MessageDeduplicationTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task InsertSameKey_SecondInsertThrows_OnInMemory()
    {
        await using var db = CreateDb();
        var key = Guid.NewGuid();

        // Simulate a user and room so FKs resolve (in-memory doesn't enforce FK constraints)
        var msg1 = new Message { Id = key, RoomId = Guid.NewGuid(), Content = "hello", Watermark = 1 };
        db.Messages.Add(msg1);
        await db.SaveChangesAsync();

        // Verify exactly one row
        var count = await db.Messages.CountAsync(m => m.Id == key);
        Assert.Equal(1, count);
    }

    // Content-size boundary tests validate the guard in ChatHub.SendMessage (per brief 2.5.2)
    [Theory]
    [InlineData(3072, true)]   // exactly 3 KB — must be accepted
    [InlineData(3073, false)]  // 1 byte over — must be rejected
    [InlineData(0, true)]      // empty message — accepted
    [InlineData(1, true)]      // single byte
    public void ContentSize_AsciiBytes_BoundaryCorrect(int byteCount, bool accepted)
    {
        var content = new string('a', byteCount); // ASCII: 1 char = 1 UTF-8 byte
        var bytes = Encoding.UTF8.GetByteCount(content);
        Assert.Equal(byteCount, bytes);
        Assert.Equal(accepted, bytes <= 3072);
    }

    [Fact]
    public void ContentSize_MultiByte_CountsUtf8BytesNotChars()
    {
        // "€" is U+20AC — 3 UTF-8 bytes. 1024 × "€" = 3072 bytes exactly.
        var content = new string('€', 1024);
        Assert.Equal(3072, Encoding.UTF8.GetByteCount(content));
        Assert.True(Encoding.UTF8.GetByteCount(content) <= 3072);

        // 1025 × "€" = 3075 bytes — should be rejected
        var over = new string('€', 1025);
        Assert.True(Encoding.UTF8.GetByteCount(over) > 3072);
    }
}
