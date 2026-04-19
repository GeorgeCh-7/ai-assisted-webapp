namespace Api.Domain;

public class RoomBan
{
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid BannedUserId { get; set; }
    public AppUser BannedUser { get; set; } = null!;
    public Guid? BannedByUserId { get; set; }
    public AppUser? BannedByUser { get; set; }
    public DateTime BannedAt { get; set; } = DateTime.UtcNow;
    public string? Reason { get; set; }
}
