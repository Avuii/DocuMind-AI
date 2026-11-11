using System.Text.RegularExpressions;

namespace DocuMind.Services.Registries;

public sealed record RegistryIdentifier(string Kind, string Number)
{
    private static readonly HashSet<string> VatCountries =
        ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR",
         "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];

    public static RegistryIdentifier? Parse(string kind, string value)
    {
        var number = Regex.Replace(value.ToUpperInvariant(), @"[\s.-]+", "");
        if (kind == "nip" && number.StartsWith("PL", StringComparison.Ordinal))
            number = number[2..];
        if (kind == "vat" && number.StartsWith("GR", StringComparison.Ordinal))
            number = "EL" + number[2..];

        var valid = kind switch
        {
            "nip" => HasChecksum(number, [6, 5, 7, 2, 3, 4, 5, 6, 7], false),
            "regon" when number.Length == 9 => HasChecksum(number, [8, 9, 2, 3, 4, 5, 6, 7], true),
            "regon" when number.Length == 14 => HasChecksum(number, [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8], true),
            "krs" => Regex.IsMatch(number, @"\A[0-9]{1,10}\z") && number.Any(digit => digit != '0'),
            "vat" => Regex.IsMatch(number, @"\A[A-Z]{2}[0-9A-Z]{2,12}\z") &&
                VatCountries.Contains(number[..2]) && number[2..].Any(char.IsAsciiDigit),
            _ => false
        };
        return valid ? new(kind, kind == "krs" ? number.PadLeft(10, '0') : number) : null;
    }

    private static bool HasChecksum(string number, int[] weights, bool zeroOnTen)
    {
        if (number.Length != weights.Length + 1 || !number.All(char.IsAsciiDigit) ||
            number.All(digit => digit == '0'))
            return false;
        var remainder = weights.Select((weight, index) => weight * (number[index] - '0')).Sum() % 11;
        return number[^1] - '0' == (zeroOnTen && remainder == 10 ? 0 : remainder);
    }
}
