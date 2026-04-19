using Api.Data;
using Api.Domain;
using Api.Features.Friends;
using Microsoft.EntityFrameworkCore;

namespace Api.Features.Dms;

public static class DmService
{
    public static async Task<DmThread> EnsureThreadAsync(Guid callerId, Guid targetId, AppDbContext db)
    {
        var (aId, bId) = FriendshipKey.Canonicalize(callerId, targetId);

        var thread = await db.DmThreads
            .FirstOrDefaultAsync(dt => dt.UserAId == aId && dt.UserBId == bId);

        if (thread is null)
        {
            thread = new DmThread { Id = Guid.NewGuid(), UserAId = aId, UserBId = bId };
            db.DmThreads.Add(thread);
            await db.SaveChangesAsync();
        }

        return thread;
    }
}
