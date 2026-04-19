namespace Api.Features.Files;

public record FileUploadResponse(
    Guid Id,
    string OriginalFilename,
    string ContentType,
    long SizeBytes,
    string Scope,
    Guid ScopeId);
