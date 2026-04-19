namespace Api.Domain;

public class DmUnread
{
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public Guid DmThreadId { get; set; }
    public DmThread DmThread { get; set; } = null!;
    public int Count { get; set; }
    public Guid? LastReadMessageId { get; set; }
}
