using DocuMind.Models;
using Microsoft.EntityFrameworkCore;

namespace DocuMind.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentResult> DocumentResults => Set<DocumentResult>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Document>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Status).HasConversion<int>();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("NOW()");
            entity.Property(x => x.UpdatedAt).HasDefaultValueSql("NOW()");
            entity.Property(x => x.ErrorMessage).HasMaxLength(2000);

            entity.HasOne(x => x.Result)
                  .WithOne(x => x.Document)
                  .HasForeignKey<DocumentResult>(x => x.DocumentId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DocumentResult>(entity =>
        {
            entity.HasKey(x => x.DocumentId);

            entity.Property(x => x.RawResultJson)
                  .HasColumnType("jsonb")
                  .IsRequired();

            entity.Property(x => x.CorrectedResultJson)
                  .HasColumnType("jsonb");

            entity.Property(x => x.ConfidenceSummaryJson)
                  .HasColumnType("jsonb");

            entity.Property(x => x.ModelVersion)
                  .HasMaxLength(100)
                  .IsRequired();

            entity.Property(x => x.CreatedAt).HasDefaultValueSql("NOW()");
            entity.Property(x => x.UpdatedAt).HasDefaultValueSql("NOW()");
            entity.Property(x => x.ProcessedAt).HasDefaultValueSql("NOW()");
        });
    }
}