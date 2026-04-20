using Microsoft.AspNetCore.Identity;

namespace Api.Domain;

public class AppUser : IdentityUser<Guid>
{
    public string? AvatarStoragePath { get; set; }
    public string? AvatarContentType { get; set; }
}
