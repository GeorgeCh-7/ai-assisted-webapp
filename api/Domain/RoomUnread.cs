namespace Api.Domain;

public class RoomUnread
{
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public int Count { get; set; }
    public Guid? LastReadMessageId { get; set; }
}
