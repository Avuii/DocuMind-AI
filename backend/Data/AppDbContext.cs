using DocuMind.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;

namespace DocuMind.Data;

public class AppDbContext : IdentityDbContext<IdentityUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentGroup> DocumentGroups => Set<DocumentGroup>();
    public DbSet<DocumentResult> DocumentResults => Set<DocumentResult>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<DocumentGroup>(entity =>
        {
            entity.HasIndex(x => new { x.OwnerId, x.NormalizedName }).IsUnique();
            entity.HasOne<IdentityUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Document>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.OwnerId, x.UploadBatchId });
            entity.Property(x => x.Status).HasConversion<int>();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("NOW()");
            entity.Property(x => x.UpdatedAt).HasDefaultValueSql("NOW()");
            entity.Property(x => x.ErrorMessage).HasMaxLength(2000);
            entity.Property(x => x.Tags).HasDefaultValueSql("ARRAY[]::text[]");
            entity.Property(x => x.Reviewed).HasDefaultValue(false);
            entity.HasOne<IdentityUser>()
                  .WithMany()
                  .HasForeignKey(x => x.OwnerId)
                  .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<DocumentGroup>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.SetNull);

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
