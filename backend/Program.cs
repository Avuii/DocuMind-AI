using DocuMind.Data;
using DocuMind.Services;
using DocuMind.Services.BackgroundServices;
using DocuMind.Services.Storage;
using DocuMind.Services.Registries;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;

var builder = WebApplication.CreateBuilder(args);

var trustedProxy = builder.Configuration["ReverseProxy:KnownProxy"];
if (!string.IsNullOrWhiteSpace(trustedProxy))
{
    if (!IPAddress.TryParse(trustedProxy, out var address))
        throw new InvalidOperationException("ReverseProxy:KnownProxy must be an IP address.");

    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
        options.KnownProxies.Add(address);
    });
}

builder.Services.AddHttpClient<RegistryClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(10);
    client.MaxResponseContentBufferSize = 4 * 1024 * 1024;
})
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddScoped<IDocumentProcessingService, DocumentProcessingService>();
builder.Services.AddHostedService<DocumentProcessingWorker>();
builder.Services.AddSingleton<IFileStorage, LocalFileStorage>();

var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Missing ConnectionStrings:Default in appsettings.json/appsettings.Development.json");
}

builder.Services.AddDbContext<AppDbContext>(opt => opt.UseNpgsql(connectionString));
builder.Services.AddIdentity<IdentityUser, IdentityRole>(options =>
{
    options.User.RequireUniqueEmail = true;
    options.User.AllowedUserNameCharacters = string.Empty;
    options.Password.RequiredLength = 12;
    options.Password.RequireDigit = true;
    options.Password.RequireLowercase = true;
    options.Password.RequireUppercase = true;
    options.Password.RequireNonAlphanumeric = true;
})
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "DocuMind.Session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    options.Events.OnRedirectToLogin = context =>
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});
builder.Services.Configure<SecurityStampValidatorOptions>(options =>
    options.ValidationInterval = TimeSpan.FromMinutes(1));
var keyPath = builder.Configuration["DataProtection:KeyPath"];
if (!string.IsNullOrWhiteSpace(keyPath))
{
    builder.Services.AddDataProtection()
        .SetApplicationName("DocuMind")
        .PersistKeysToFileSystem(Directory.CreateDirectory(keyPath));
}

var mlBaseUrl = builder.Configuration["MlService:BaseUrl"];
if (string.IsNullOrWhiteSpace(mlBaseUrl))
{
    throw new InvalidOperationException("Missing MlService:BaseUrl in configuration.");
}

builder.Services.AddHttpClient<IMlInferenceClient, MlInferenceClient>(client =>
{
    client.BaseAddress = new Uri(mlBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(120);
});
builder.Services.AddHttpClient("ocr-health", client =>
{
    client.BaseAddress = new Uri(mlBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(3);
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

var app = builder.Build();

if (!string.IsNullOrWhiteSpace(trustedProxy))
    app.UseForwardedHeaders();

var migrateOnly = app.Configuration.GetValue<bool>("Database:MigrateOnly");
if (migrateOnly || app.Configuration.GetValue<bool>("Database:ApplyMigrations"))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

if (migrateOnly)
    return;

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseWhen(context => !context.Request.Path.StartsWithSegments("/health"),
    pipeline => pipeline.UseHttpsRedirection());
app.Use(async (context, next) =>
{
    var request = context.Request;
    if (request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "private, no-store";
        // Cross-site forms cannot send this header, and the API does not allow CORS.
        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method) &&
            request.Headers["X-DocuMind-Request"] != "1")
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new { error = "Missing request header." });
            return;
        }
    }
    await next();
});
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/health", async (AppDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok() : Results.StatusCode(503));
app.MapGet("/health/live", () => Results.Ok());
app.MapGet("/health/ready", async (AppDbContext db, IHttpClientFactory clients, CancellationToken ct) =>
{
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(TimeSpan.FromSeconds(4));
    try
    {
        if (!await db.Database.CanConnectAsync(timeout.Token))
            return Results.StatusCode(503);
        using var client = clients.CreateClient("ocr-health");
        using var response = await client.GetAsync("health", timeout.Token);
        return response.IsSuccessStatusCode ? Results.Ok() : Results.StatusCode(503);
    }
    catch (HttpRequestException)
    {
        return Results.StatusCode(503);
    }
    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
    {
        return Results.StatusCode(503);
    }
});
app.MapControllers();
app.Run();
