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

        // Composite PKs
        builder.Entity<RoomMembership>().HasKey(rm => new { rm.RoomId, rm.UserId });
        builder.Entity<RoomUnread>().HasKey(ru => new { ru.UserId, ru.RoomId });

        // UserPresence: UserId is both PK and FK to users
        builder.Entity<UserPresence>()
            .HasKey(up => up.UserId);
        builder.Entity<UserPresence>()
            .HasOne(up => up.User)
            .WithOne()
            .HasForeignKey<UserPresence>(up => up.UserId);

        // Message FK cascades — required by Phase 2 deletion flows per contracts.md
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

        // Pagination index — required for efficient cursor queries at 100K+ rows
        builder.Entity<Message>()
            .HasIndex(m => new { m.RoomId, m.Watermark })
            .HasDatabaseName("ix_messages_room_watermark")
            .IsDescending(false, true);

        // Room name must be globally unique
        builder.Entity<Room>()
            .HasIndex(r => r.Name)
            .IsUnique();

        // Constrain presence status to known values (afk reserved for Phase 2)
        builder.Entity<UserPresence>()
            .ToTable(tb => tb.HasCheckConstraint("ck_user_presence_status",
                "status IN ('online', 'afk', 'offline')"));
    }
}
