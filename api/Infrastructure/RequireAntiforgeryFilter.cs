using Microsoft.AspNetCore.Antiforgery;

namespace Api.Infrastructure;

public sealed class RequireAntiforgeryFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var af = ctx.HttpContext.RequestServices.GetRequiredService<IAntiforgery>();
        try { await af.ValidateRequestAsync(ctx.HttpContext); }
        catch (AntiforgeryValidationException)
        {
            return Results.BadRequest(new { error = "Invalid or missing CSRF token" });
        }
        return await next(ctx);
    }
}
