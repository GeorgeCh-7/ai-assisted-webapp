namespace Api.Domain;

public class DmMessage
{
    public Guid Id { get; set; }
    public Guid DmThreadId { get; set; }
    public DmThread DmThread { get; set; } = null!;
    public Guid? AuthorId { get; set; }
    public AppUser? Author { get; set; }
    public string Content { get; set; } = "";
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public long Watermark { get; set; }
    public DateTime? EditedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public Guid? ReplyToMessageId { get; set; }
    public DmMessage? ReplyToMessage { get; set; }
}
