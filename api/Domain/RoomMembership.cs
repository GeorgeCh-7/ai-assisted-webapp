namespace Api.Domain;

public class RoomMembership
{
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public string Role { get; set; } = "member";
}
