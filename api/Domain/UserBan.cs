namespace Api.Domain;

public class UserBan
{
    public Guid BannerUserId { get; set; }
    public AppUser BannerUser { get; set; } = null!;
    public Guid BannedUserId { get; set; }
    public AppUser BannedUser { get; set; } = null!;
    public DateTime BannedAt { get; set; } = DateTime.UtcNow;
}
