using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DocuMind.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentResults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "ErrorMessage",
                table: "Documents",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateTable(
                name: "DocumentResults",
                columns: table => new
                {
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawResultJson = table.Column<string>(type: "jsonb", nullable: false),
                    CorrectedResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    ModelVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ConfidenceSummaryJson = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()"),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()"),
                    ProcessedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentResults", x => x.DocumentId);
                    table.ForeignKey(
                        name: "FK_DocumentResults_Documents_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "Documents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DocumentResults");

            migrationBuilder.AlterColumn<string>(
                name: "ErrorMessage",
                table: "Documents",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000,
                oldNullable: true);
        }
    }
}
