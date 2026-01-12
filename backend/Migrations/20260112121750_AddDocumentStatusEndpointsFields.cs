using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DocuMind.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentStatusEndpointsFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "OriginalFilename",
                table: "Documents",
                newName: "OriginalFileName");

            migrationBuilder.AddColumn<long>(
                name: "SizeBytes",
                table: "Documents",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SizeBytes",
                table: "Documents");

            migrationBuilder.RenameColumn(
                name: "OriginalFileName",
                table: "Documents",
                newName: "OriginalFilename");
        }
    }
}
