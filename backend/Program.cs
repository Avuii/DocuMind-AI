using DocuMind.Data;
using DocuMind.Services;
using DocuMind.Services.BackgroundServices;
using DocuMind.Services.Storage;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

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

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.MapControllers();
app.Run();