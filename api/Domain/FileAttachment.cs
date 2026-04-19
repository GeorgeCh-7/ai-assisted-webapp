namespace Api.Domain;

public class FileAttachment
{
    public Guid Id { get; set; }
    public Guid? UploaderId { get; set; }
    public AppUser? Uploader { get; set; }
    public string OriginalFilename { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string StoragePath { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? RoomId { get; set; }
    public Room? Room { get; set; }
    public Guid? DmThreadId { get; set; }
    public DmThread? DmThread { get; set; }
    public Guid? MessageId { get; set; }
    public Message? Message { get; set; }
    public Guid? DmMessageId { get; set; }
    public DmMessage? DmMessage { get; set; }
}
