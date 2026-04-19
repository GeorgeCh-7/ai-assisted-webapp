namespace Api.Domain;

public class Friendship
{
    public Guid UserAId { get; set; }
    public AppUser UserA { get; set; } = null!;
    public Guid UserBId { get; set; }
    public AppUser UserB { get; set; } = null!;
    public string Status { get; set; } = "pending";
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? AcceptedAt { get; set; }
    public string? RequestMessage { get; set; }
}
