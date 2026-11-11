using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DocuMind.Migrations
{
    /// <inheritdoc />
    public partial class AddUploadBatch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Documents_OwnerId",
                table: "Documents");

            migrationBuilder.AddColumn<Guid>(
                name: "UploadBatchId",
                table: "Documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Documents_OwnerId_UploadBatchId",
                table: "Documents",
                columns: new[] { "OwnerId", "UploadBatchId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Documents_OwnerId_UploadBatchId",
                table: "Documents");

            migrationBuilder.DropColumn(
                name: "UploadBatchId",
                table: "Documents");

            migrationBuilder.CreateIndex(
                name: "IX_Documents_OwnerId",
                table: "Documents",
                column: "OwnerId");
        }
    }
}
