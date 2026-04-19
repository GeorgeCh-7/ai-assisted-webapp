namespace Api.Domain;

public class DmThread
{
    public Guid Id { get; set; }
    public Guid UserAId { get; set; }
    public AppUser UserA { get; set; } = null!;
    public Guid UserBId { get; set; }
    public AppUser UserB { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long CurrentWatermark { get; set; }
    public DateTime? FrozenAt { get; set; }
    public DateTime? OtherPartyDeletedAt { get; set; }
    public ICollection<DmMessage> Messages { get; set; } = [];
}
