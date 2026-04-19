namespace Api.Features.Dms;

public record DmOtherUser(Guid UserId, string Username, string Presence);

public record DmThreadResponse(
    Guid Id,
    DmOtherUser OtherUser,
    DateTime? FrozenAt,
    DateTime? OtherPartyDeletedAt,
    long CurrentWatermark);

public record DmThreadListItem(
    Guid Id,
    DmOtherUser OtherUser,
    string? LastMessagePreview,
    DateTime LastActivityAt,
    int UnreadCount,
    DateTime? FrozenAt,
    DateTime? OtherPartyDeletedAt);

public record DmMessageResponse(
    Guid Id,
    Guid DmThreadId,
    Guid? AuthorId,
    string AuthorUsername,
    string Content,
    DateTime SentAt,
    Guid IdempotencyKey,
    long Watermark,
    DateTime? EditedAt,
    DateTime? DeletedAt,
    Guid? ReplyToMessageId);

public record OpenDmRequest(Guid UserId);
