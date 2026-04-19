namespace Api.Domain;

public class RoomInvitation
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid InviteeUserId { get; set; }
    public AppUser InviteeUser { get; set; } = null!;
    public Guid InvitedByUserId { get; set; }
    public AppUser InvitedByUser { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "pending";
    public DateTime? RespondedAt { get; set; }
}
