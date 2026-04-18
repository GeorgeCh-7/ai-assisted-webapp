namespace Api.Features.Messages;

public record MessageResponse(
    Guid Id,
    Guid RoomId,
    Guid? AuthorId,
    string AuthorUsername,
    string Content,
    DateTime SentAt,
    Guid IdempotencyKey,
    long Watermark,
    DateTime? EditedAt,
    DateTime? DeletedAt,
    Guid? ReplyToMessageId);
