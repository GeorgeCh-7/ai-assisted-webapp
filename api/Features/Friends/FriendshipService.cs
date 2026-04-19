namespace Api.Features.Friends;

public static class FriendshipKey
{
    public static (Guid a, Guid b) Canonicalize(Guid x, Guid y)
        => x.CompareTo(y) < 0 ? (x, y) : (y, x);
}
