using Api.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public class AppDbContext : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<AppSession> Sessions => Set<AppSession>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<RoomMembership> RoomMemberships => Set<RoomMembership>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<UserPresence> UserPresences => Set<UserPresence>();
    public DbSet<RoomUnread> RoomUnreads => Set<RoomUnread>();

    // Phase 2
    public DbSet<RoomInvitation> RoomInvitations => Set<RoomInvitation>();
    public DbSet<RoomBan> RoomBans => Set<RoomBan>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<UserBan> UserBans => Set<UserBan>();
    public DbSet<DmThread> DmThreads => Set<DmThread>();
    public DbSet<DmMessage> DmMessages => Set<DmMessage>();
    public DbSet<DmUnread> DmUnreads => Set<DmUnread>();
    public DbSet<FileAttachment> FileAttachments => Set<FileAttachment>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Identity table renames — must come after base call
        builder.Entity<AppUser>().ToTable("users");
        builder.Entity<IdentityRole<Guid>>().ToTable("roles");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("user_roles");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("role_claims");

        // Composite PKs — Phase 1
        builder.Entity<RoomMembership>().HasKey(rm => new { rm.RoomId, rm.UserId });
        builder.Entity<RoomUnread>().HasKey(ru => new { ru.UserId, ru.RoomId });

        // UserPresence: UserId is both PK and FK to users
        builder.Entity<UserPresence>()
            .HasKey(up => up.UserId);
        builder.Entity<UserPresence>()
            .HasOne(up => up.User)
            .WithOne()
            .HasForeignKey<UserPresence>(up => up.UserId);

        // Message FK cascades
        builder.Entity<Message>()
            .HasOne(m => m.Room)
            .WithMany(r => r.Messages)
            .HasForeignKey(m => m.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<Message>()
            .HasOne(m => m.Author)
            .WithMany()
            .HasForeignKey(m => m.AuthorId)
            .OnDelete(DeleteBehavior.SetNull);

        // Phase 2: self-referencing reply FK
        builder.Entity<Message>()
            .HasOne(m => m.ReplyToMessage)
            .WithMany()
            .HasForeignKey(m => m.ReplyToMessageId)
            .OnDelete(DeleteBehavior.SetNull);

        // Pagination index — required for efficient cursor queries
        builder.Entity<Message>()
            .HasIndex(m => new { m.RoomId, m.Watermark })
            .HasDatabaseName("ix_messages_room_watermark")
            .IsDescending(false, true);

        // Room name must be globally unique
        builder.Entity<Room>()
            .HasIndex(r => r.Name)
            .IsUnique();

        // rooms.created_by_id CASCADE — owner deletion nukes their rooms
        builder.Entity<Room>()
            .HasOne(r => r.CreatedBy)
            .WithMany()
            .HasForeignKey(r => r.CreatedById)
            .OnDelete(DeleteBehavior.Cascade);

        // Constrain presence status to known values
        builder.Entity<UserPresence>()
            .ToTable(tb => tb.HasCheckConstraint("ck_user_presence_status",
                "status IN ('online', 'afk', 'offline')"));

        // Sessions: user_id CASCADE
        builder.Entity<AppSession>()
            .HasOne(s => s.User)
            .WithMany()
            .HasForeignKey(s => s.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // room_memberships: user_id CASCADE (memberships in others' rooms dissolve on delete)
        builder.Entity<RoomMembership>()
            .HasOne(rm => rm.User)
            .WithMany()
            .HasForeignKey(rm => rm.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<RoomMembership>()
            .HasOne(rm => rm.Room)
            .WithMany(r => r.Memberships)
            .HasForeignKey(rm => rm.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        // ---- Phase 2 entities ----

        // room_invitations
        builder.Entity<RoomInvitation>()
            .ToTable(tb => tb.HasCheckConstraint("ck_room_invitation_status",
                "status IN ('pending', 'accepted', 'declined', 'revoked')"));

        builder.Entity<RoomInvitation>()
            .HasOne(ri => ri.Room)
            .WithMany()
            .HasForeignKey(ri => ri.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<RoomInvitation>()
            .HasOne(ri => ri.InviteeUser)
            .WithMany()
            .HasForeignKey(ri => ri.InviteeUserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<RoomInvitation>()
            .HasOne(ri => ri.InvitedByUser)
            .WithMany()
            .HasForeignKey(ri => ri.InvitedByUserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Partial unique: only one pending invite per (room, invitee)
        builder.Entity<RoomInvitation>()
            .HasIndex(ri => new { ri.RoomId, ri.InviteeUserId })
            .HasDatabaseName("ix_room_invitations_pending_unique")
            .HasFilter("status = 'pending'")
            .IsUnique();

        // room_bans — composite PK
        builder.Entity<RoomBan>()
            .HasKey(rb => new { rb.RoomId, rb.BannedUserId });

        builder.Entity<RoomBan>()
            .HasOne(rb => rb.Room)
            .WithMany()
            .HasForeignKey(rb => rb.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<RoomBan>()
            .HasOne(rb => rb.BannedUser)
            .WithMany()
            .HasForeignKey(rb => rb.BannedUserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<RoomBan>()
            .HasOne(rb => rb.BannedByUser)
            .WithMany()
            .HasForeignKey(rb => rb.BannedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        // friendships — composite PK + DB-level canonicalization guard
        builder.Entity<Friendship>()
            .HasKey(f => new { f.UserAId, f.UserBId });

        builder.Entity<Friendship>()
            .ToTable(tb => tb.HasCheckConstraint("ck_friendships_order",
                "user_a_id < user_b_id"));

        builder.Entity<Friendship>()
            .ToTable(tb => tb.HasCheckConstraint("ck_friendships_status",
                "status IN ('pending', 'accepted')"));

        builder.Entity<Friendship>()
            .HasOne(f => f.UserA)
            .WithMany()
            .HasForeignKey(f => f.UserAId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<Friendship>()
            .HasOne(f => f.UserB)
            .WithMany()
            .HasForeignKey(f => f.UserBId)
            .OnDelete(DeleteBehavior.Cascade);

        // user_bans — composite PK, asymmetric
        builder.Entity<UserBan>()
            .HasKey(ub => new { ub.BannerUserId, ub.BannedUserId });

        builder.Entity<UserBan>()
            .HasOne(ub => ub.BannerUser)
            .WithMany()
            .HasForeignKey(ub => ub.BannerUserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<UserBan>()
            .HasOne(ub => ub.BannedUser)
            .WithMany()
            .HasForeignKey(ub => ub.BannedUserId)
            .OnDelete(DeleteBehavior.Cascade);

        // dm_threads — RESTRICT on both user FKs (account delete handler must flip other_party_deleted_at first)
        builder.Entity<DmThread>()
            .ToTable(tb => tb.HasCheckConstraint("ck_dm_threads_order",
                "user_a_id < user_b_id"));

        builder.Entity<DmThread>()
            .HasIndex(dt => new { dt.UserAId, dt.UserBId })
            .HasDatabaseName("ix_dm_threads_users_unique")
            .IsUnique();

        // SET NULL on user delete: DM thread survives with null party FK + OtherPartyDeletedAt marker
        builder.Entity<DmThread>()
            .HasOne(dt => dt.UserA)
            .WithMany()
            .HasForeignKey(dt => dt.UserAId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<DmThread>()
            .HasOne(dt => dt.UserB)
            .WithMany()
            .HasForeignKey(dt => dt.UserBId)
            .OnDelete(DeleteBehavior.SetNull);

        // dm_messages
        builder.Entity<DmMessage>()
            .HasOne(dm => dm.DmThread)
            .WithMany(dt => dt.Messages)
            .HasForeignKey(dm => dm.DmThreadId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<DmMessage>()
            .HasOne(dm => dm.Author)
            .WithMany()
            .HasForeignKey(dm => dm.AuthorId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<DmMessage>()
            .HasOne(dm => dm.ReplyToMessage)
            .WithMany()
            .HasForeignKey(dm => dm.ReplyToMessageId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<DmMessage>()
            .HasIndex(dm => new { dm.DmThreadId, dm.Watermark })
            .HasDatabaseName("ix_dm_messages_thread_watermark")
            .IsDescending(false, true);

        // dm_unreads — composite PK
        builder.Entity<DmUnread>()
            .HasKey(du => new { du.UserId, du.DmThreadId });

        builder.Entity<DmUnread>()
            .HasOne(du => du.User)
            .WithMany()
            .HasForeignKey(du => du.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<DmUnread>()
            .HasOne(du => du.DmThread)
            .WithMany()
            .HasForeignKey(du => du.DmThreadId)
            .OnDelete(DeleteBehavior.Cascade);

        // file_attachments — three-state constraint
        builder.Entity<FileAttachment>()
            .ToTable(tb => tb.HasCheckConstraint("ck_file_attachments_scope",
                "(room_id IS NOT NULL) OR (dm_thread_id IS NOT NULL) OR (message_id IS NULL AND dm_message_id IS NULL)"));

        builder.Entity<FileAttachment>()
            .HasOne(fa => fa.Uploader)
            .WithMany()
            .HasForeignKey(fa => fa.UploaderId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<FileAttachment>()
            .HasOne(fa => fa.Room)
            .WithMany()
            .HasForeignKey(fa => fa.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<FileAttachment>()
            .HasOne(fa => fa.DmThread)
            .WithMany()
            .HasForeignKey(fa => fa.DmThreadId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<FileAttachment>()
            .HasOne(fa => fa.Message)
            .WithMany()
            .HasForeignKey(fa => fa.MessageId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<FileAttachment>()
            .HasOne(fa => fa.DmMessage)
            .WithMany()
            .HasForeignKey(fa => fa.DmMessageId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<FileAttachment>()
            .HasIndex(fa => fa.RoomId)
            .HasDatabaseName("ix_file_attachments_room_id");

        builder.Entity<FileAttachment>()
            .HasIndex(fa => fa.DmThreadId)
            .HasDatabaseName("ix_file_attachments_dm_thread_id");

        builder.Entity<FileAttachment>()
            .HasIndex(fa => fa.UploaderId)
            .HasDatabaseName("ix_file_attachments_uploader_id");

        // password_reset_tokens
        builder.Entity<PasswordResetToken>()
            .HasKey(prt => prt.Token);

        builder.Entity<PasswordResetToken>()
            .HasOne(prt => prt.User)
            .WithMany()
            .HasForeignKey(prt => prt.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
