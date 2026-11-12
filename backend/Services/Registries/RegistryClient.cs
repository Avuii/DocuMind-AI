using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml;

namespace DocuMind.Services.Registries;

public sealed partial class RegistryClient(HttpClient http, IConfiguration config, ILogger<RegistryClient> logger)
{
    public async Task<RegistryResult[]> Lookup(RegistryIdentifier id, CancellationToken ct)
    {
        if (id.Kind == "vat")
            return [await Run("VIES", () => Vies(id, ct), ct)];

        RegistryResult? krs = id.Kind == "krs" ? await Run("KRS", () => Krs(id.Number, ct), ct) : null;
        var domesticId = id.Kind != "krs" ? id
            : krs?.Company?.Nip is { } nip ? RegistryIdentifier.Parse("nip", nip) : null;

        var results = await Task.WhenAll(
            Run("GUS", () => Gus(id, ct), ct),
            domesticId == null ? Task.FromResult(new RegistryResult("VAT", "notApplicable"))
                : Run("VAT", () => WhiteList(domesticId, ct), ct),
            domesticId == null ? Task.FromResult(new RegistryResult("CEIDG", "notApplicable"))
                : Run("CEIDG", () => Ceidg(domesticId, ct), ct));

        if (krs == null)
        {
            var linkedNumbers = results.Select(result => result.Company?.Krs)
                .OfType<string>()
                .Select(number => RegistryIdentifier.Parse("krs", number)?.Number)
                .OfType<string>().Distinct().ToArray();
            krs = linkedNumbers.Length switch
            {
                1 => await Run("KRS", () => Krs(linkedNumbers[0], ct), ct),
                > 1 => new("KRS", "ambiguous"),
                _ => new("KRS", "notApplicable")
            };
            if (krs.Company is { } company &&
                ((id.Kind == "nip" && company.Nip != id.Number) ||
                 (id.Kind == "regon" && company.Regon != id.Number)))
                krs = new("KRS", "ambiguous");
        }
        return [.. results, krs];
    }

    private async Task<RegistryResult> Run(string source, Func<Task<RegistryResult>> lookup, CancellationToken ct)
    {
        try
        {
            return await lookup();
        }
        catch (Exception error) when (!ct.IsCancellationRequested &&
            error is HttpRequestException or OperationCanceledException or JsonException or XmlException or
                InvalidDataException or InvalidOperationException or IOException)
        {
            logger.LogWarning("Registry {Source} lookup failed ({ErrorType})", source, error.GetType().Name);
            return new(source, "unavailable");
        }
    }

    private async Task<RegistryResult> WhiteList(RegistryIdentifier id, CancellationToken ct)
    {
        var today = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Europe/Warsaw");
        var date = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://wykazpodatnikowvat.mf.gov.pl/api/search/{id.Kind}/{id.Number}?date={date}");
        var response = await GetJson(request, ct);
        if (response == null)
            return new("VAT", "notFound", Date: date);
        var result = response["result"] as JsonObject ?? throw new InvalidDataException();
        var subject = result["subject"];
        return subject == null ? new("VAT", "notFound", Date: date)
            : new("VAT", "found", new(Value(subject, "name"),
                Value(subject, "workingAddress") ?? Value(subject, "residenceAddress"),
                Value(subject, "nip"), Value(subject, "regon"), Value(subject, "krs")),
                Value(subject, "statusVat"), date, Value(result, "requestId"));
    }

    private async Task<RegistryResult> Krs(string number, CancellationToken ct)
    {
        foreach (var register in new[] { "P", "S" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get,
                $"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{number}?rejestr={register}&format=json");
            var response = await GetJson(request, ct);
            if (response == null)
                continue;
            var section = response["odpis"]?["dane"]?["dzial1"] ?? throw new InvalidDataException();
            var entity = section["danePodmiotu"] ?? throw new InvalidDataException();
            var ids = entity["identyfikatory"];
            var address = section["siedzibaIAdres"]?["adres"];
            return new("KRS", "found", new(Value(entity, "nazwa"),
                Address(Value(address, "ulica"), Value(address, "nrDomu"), Value(address, "nrLokalu"),
                    Value(address, "kodPocztowy"), Value(address, "miejscowosc")),
                Value(ids, "nip"), Value(ids, "regon"), number));
        }
        return new("KRS", "notFound");
    }

    private async Task<RegistryResult> Ceidg(RegistryIdentifier id, CancellationToken ct)
    {
        var token = config["Registries:CeidgToken"];
        if (string.IsNullOrWhiteSpace(token))
            return new("CEIDG", "notConfigured");
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://dane.biznes.gov.pl/api/ceidg/v3/firmy?{id.Kind}={id.Number}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await GetJson(request, ct);
        if (response == null)
            return new("CEIDG", "notFound");
        var firms = response["firmy"] as JsonArray ?? throw new InvalidDataException();
        if (firms.Count > 1 || (int?)response["count"] > 1)
            return new("CEIDG", "ambiguous");
        if (firms.Count == 0)
            return new("CEIDG", "notFound");
        var entity = firms[0];
        var owner = entity?["wlasciciel"];
        var address = entity?["adresDzialalnosci"];
        return new("CEIDG", "found", new(Value(entity, "nazwa"),
            Address(Value(address, "ulica"), Value(address, "budynek"), Value(address, "lokal"),
                Value(address, "kod"), Value(address, "miasto")),
            Value(owner, "nip"), Value(owner, "regon")), Value(entity, "status"));
    }

    private async Task<RegistryResult> Vies(RegistryIdentifier id, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number");
        request.Content = JsonContent.Create(new { countryCode = id.Number[..2], vatNumber = id.Number[2..] });
        var response = await GetJson(request, ct) as JsonObject ?? throw new InvalidDataException();
        if (response["actionSucceed"]?.GetValue<bool>() == false ||
            response["valid"] is not JsonValue valid || !valid.TryGetValue<bool>(out var active))
            throw new InvalidDataException();

        var date = Value(response, "requestDate");
        if (!active)
            return new("VIES", "notFound", Status: "invalid", Date: date);
        return new("VIES", "found", new(Value(response, "name"), Value(response, "address"), VatId: id.Number),
            "valid", date, Value(response, "requestIdentifier"));
    }

    private async Task<JsonNode?> GetJson(HttpRequestMessage request, CancellationToken ct)
    {
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.NoContent)
            return null;
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ?? throw new InvalidDataException();
    }

    private static string? Value(JsonNode? root, string key) => Clean((root as JsonObject)?[key]?.ToString());

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim().All(character => character == '-') ? null : value.Trim();

    private static string? Address(string? street, string? house, string? unit, string? postalCode, string? city)
    {
        var building = unit == null ? house : $"{house}/{unit}";
        return Clean(string.Join(", ", new[] { Join(street, building), Join(postalCode, city) }
            .Where(part => part.Length > 0)));
    }

    private static string Join(params string?[] parts) => string.Join(" ", parts.Where(part => part != null));
}

public sealed record RegistryResult(string Source, string Outcome, RegistryCompany? Company = null,
    string? Status = null, string? Date = null, string? Reference = null);

public sealed record RegistryCompany(string? Name = null, string? Address = null, string? Nip = null,
    string? Regon = null, string? Krs = null, string? VatId = null);
