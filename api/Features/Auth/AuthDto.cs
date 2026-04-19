namespace Api.Features.Auth;

public record RegisterRequest(string Username, string Email, string Password);
public record LoginRequest(string Email, string Password, bool KeepMeSignedIn = false);
public record UserResponse(Guid Id, string Username, string Email);
