namespace Api.Domain;

public class AppSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
    public bool IsRevoked { get; set; }
    public string? UserAgent { get; set; }
    public string? IpAddress { get; set; }
}
