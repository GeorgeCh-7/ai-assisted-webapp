namespace Api.Domain;

public class UserPresence
{
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public string Status { get; set; } = "offline";
    public DateTime LastHeartbeatAt { get; set; } = DateTime.UtcNow;
}
