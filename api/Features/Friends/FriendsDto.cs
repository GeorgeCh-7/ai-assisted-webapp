namespace Api.Features.Friends;

public record FriendListItem(
    Guid UserId,
    string Username,
    DateTime AcceptedAt,
    string Presence,
    bool IsBanned,
    bool IsBannedBy,
    Guid? DmThreadId);

public record SendFriendRequestRequest(string Username, string? Message);

public record SendFriendRequestResponse(string Username, string Status);

public record FriendRequestsResponse(
    IEnumerable<IncomingFriendRequest> Incoming,
    IEnumerable<OutgoingFriendRequest> Outgoing);

public record IncomingFriendRequest(
    Guid UserId,
    string Username,
    string? Message,
    DateTime RequestedAt);

public record OutgoingFriendRequest(
    Guid UserId,
    string Username,
    DateTime RequestedAt);

public record AcceptFriendResponse(Guid UserId, string Username);
