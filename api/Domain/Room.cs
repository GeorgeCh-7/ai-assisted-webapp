namespace Api.Domain;

public class Room
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid CreatedById { get; set; }
    public AppUser CreatedBy { get; set; } = null!;
    public long CurrentWatermark { get; set; }
    public bool IsPrivate { get; set; }
    public ICollection<RoomMembership> Memberships { get; set; } = [];
    public ICollection<Message> Messages { get; set; } = [];
}
