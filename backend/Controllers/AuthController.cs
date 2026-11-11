using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using DocuMind.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace DocuMind.Controllers;

[ApiController]
[Authorize]
[Route("api/auth")]
public class AuthController(UserManager<IdentityUser> users, SignInManager<IdentityUser> sessions, AppDbContext db) : ControllerBase
{
    private const string LanguageClaim = "documind.language";
    private const string RecoveryProvider = "DocuMind";
    private const string RecoveryToken = "PasswordRecoveryHash";

    [HttpPost("recovery-code")]
    public async Task<IActionResult> GenerateRecoveryCode(RecoveryCodeRequest request)
    {
        var user = await users.GetUserAsync(User);
        if (user == null)
            return Unauthorized();
        if (!(await sessions.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true)).Succeeded)
            return BadRequest(new { error = "The current password could not be verified." });

        var code = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var result = await users.SetAuthenticationTokenAsync(user, RecoveryProvider, RecoveryToken, HashCode(code));
        return result.Succeeded ? Ok(new { code })
            : Conflict(new { error = "Could not generate a recovery code. Try again." });
    }

    [AllowAnonymous]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = await users.FindByEmailAsync(request.Email.Trim());
        var savedHash = user == null ? null : await users.GetAuthenticationTokenAsync(user, RecoveryProvider, RecoveryToken);
        if (user == null || savedHash == null || !CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(savedHash), Encoding.UTF8.GetBytes(HashCode(request.Code.Trim()))))
            return BadRequest(new { error = "The email or recovery code is invalid." });

        var token = await users.GeneratePasswordResetTokenAsync(user);
        var result = await users.ResetPasswordAsync(user, token, request.NewPassword);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        var removal = await users.RemoveAuthenticationTokenAsync(user, RecoveryProvider, RecoveryToken);
        if (!removal.Succeeded)
            return Conflict(new { error = "Could not reset the password. Try again." });

        await transaction.CommitAsync(ct);
        return Ok(new { reset = true });
    }

    private static string HashCode(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<IActionResult> Register(Credentials request)
    {
        var email = request.Email.Trim();
        var user = new IdentityUser { UserName = email, Email = email };
        IdentityResult result;
        try
        {
            result = await users.CreateAsync(user, request.Password);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict(new { error = "An account already exists for this email." });
        }
        if (!result.Succeeded)
        {
            if (result.Errors.Any(error => error.Code is "DuplicateUserName" or "DuplicateEmail"))
                return Conflict(new { error = "An account already exists for this email." });

            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });
        }

        await sessions.SignInAsync(user, isPersistent: false);
        return Ok(await Profile(user));
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login(Credentials request)
    {
        var user = await users.FindByNameAsync(request.Email.Trim());
        if (user == null ||
            !(await sessions.PasswordSignInAsync(user, request.Password, isPersistent: false, lockoutOnFailure: true)).Succeeded)
            return Unauthorized(new { error = "Sign-in failed. Check your email and password, or try again in a few minutes." });

        return Ok(await Profile(user));
    }

    [HttpGet("session")]
    public async Task<IActionResult> Session()
    {
        var user = await users.GetUserAsync(User);
        return user == null ? Unauthorized() : Ok(await Profile(user));
    }

    [HttpPut("language")]
    public async Task<IActionResult> UpdateLanguage(UpdateLanguageRequest request)
    {
        if (request.Language is not ("en" or "pl"))
            return BadRequest(new { error = "Choose English or Polish." });

        var user = await users.GetUserAsync(User);
        if (user == null)
            return Unauthorized();
        var claim = (await users.GetClaimsAsync(user)).FirstOrDefault(claim => claim.Type == LanguageClaim);
        var preference = new Claim(LanguageClaim, request.Language);
        var result = claim == null
            ? await users.AddClaimAsync(user, preference)
            : await users.ReplaceClaimAsync(user, claim, preference);
        if (!result.Succeeded)
            return Conflict(new { error = "Could not save the account language. Try again." });

        return Ok(new { email = user.Email, language = request.Language });
    }

    [HttpPost("revoke-other-sessions")]
    public async Task<IActionResult> RevokeOtherSessions()
    {
        var user = await users.GetUserAsync(User);
        if (user == null)
            return Unauthorized();
        var result = await users.UpdateSecurityStampAsync(user);
        if (!result.Succeeded)
            return Conflict(new { error = "Could not revoke other sessions. Try again." });
        await sessions.RefreshSignInAsync(user);
        return Ok(new { revoked = true });
    }

    private async Task<object> Profile(IdentityUser user) => new
    {
        email = user.Email,
        language = (await users.GetClaimsAsync(user)).FirstOrDefault(claim => claim.Type == LanguageClaim)?.Value
    };

    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        var user = await users.GetUserAsync(User);
        if (user == null)
            return Unauthorized();

        var result = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
            return BadRequest(new { error = string.Join(" ", result.Errors.Select(error => error.Description)) });

        await sessions.RefreshSignInAsync(user);
        return Ok(new { changed = true });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await sessions.SignOutAsync();
        return Ok(new { signedOut = true });
    }
}

public record Credentials(
    [Required, EmailAddress, StringLength(254)] string Email,
    [Required, StringLength(256)] string Password);

public record ChangePasswordRequest(
    [Required, StringLength(256)] string CurrentPassword,
    [Required, StringLength(256)] string NewPassword);

public record UpdateLanguageRequest(string Language);

public record RecoveryCodeRequest([Required, StringLength(256)] string Password);

public record ResetPasswordRequest(
    [Required, EmailAddress, StringLength(254)] string Email,
    [Required, StringLength(80)] string Code,
    [Required, StringLength(256)] string NewPassword);
