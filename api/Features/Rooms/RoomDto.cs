namespace Api.Features.Rooms;

public record CreateRoomRequest(string Name, string Description, bool IsPrivate = false);

public record RoomResponse(
    Guid Id,
    string Name,
    string Description,
    int MemberCount,
    bool IsMember,
    bool IsPrivate,
    string? MyRole);

public record PagedResponse<T>(IEnumerable<T> Items, string? NextCursor);
