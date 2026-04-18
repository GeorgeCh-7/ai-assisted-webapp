using System.Security.Cryptography;
using System.Text;
using Api.Domain;
using Konscious.Security.Cryptography;
using Microsoft.AspNetCore.Identity;

namespace Api.Infrastructure;

public sealed class Argon2PasswordHasher : IPasswordHasher<AppUser>
{
    private const int SaltBytes = 16;
    private const int HashBytes = 32;
    private const int Parallelism = 1;
    private const int MemoryKb = 65536; // 64 MB
    private const int Iterations = 3;

    public string HashPassword(AppUser user, string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Compute(password, salt);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    public PasswordVerificationResult VerifyHashedPassword(AppUser user, string hashedPassword, string providedPassword)
    {
        var parts = hashedPassword.Split(':');
        if (parts.Length != 2) return PasswordVerificationResult.Failed;
        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[0]);
            expected = Convert.FromBase64String(parts[1]);
        }
        catch { return PasswordVerificationResult.Failed; }

        var actual = Compute(providedPassword, salt);
        return CryptographicOperations.FixedTimeEquals(actual, expected)
            ? PasswordVerificationResult.Success
            : PasswordVerificationResult.Failed;
    }

    private static byte[] Compute(string password, byte[] salt)
    {
        using var argon2 = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            DegreeOfParallelism = Parallelism,
            MemorySize = MemoryKb,
            Iterations = Iterations,
        };
        return argon2.GetBytes(HashBytes);
    }
}
