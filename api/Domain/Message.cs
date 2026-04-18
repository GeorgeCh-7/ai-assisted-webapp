namespace Api.Domain;

public class Message
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid? AuthorId { get; set; }
    public AppUser? Author { get; set; }
    public string Content { get; set; } = "";
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public long Watermark { get; set; }
}
