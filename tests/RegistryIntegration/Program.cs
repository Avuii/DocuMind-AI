using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Xml.Linq;
using DocuMind.Controllers;
using DocuMind.Services.Registries;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

const string Nip = "9999406657";
const string Regon = "123456785";
const string GusNs = "http://CIS/BIR/PUBL/2014/07";
var domestic = RegistryIdentifier.Parse("nip", "PL 999-940-66-57")!;
Check(domestic.Number == Nip, "NIP normalization");
Check(RegistryIdentifier.Parse("nip", "0000000000") is null, "zero NIP");
Check(RegistryIdentifier.Parse("regon", Regon)?.Number == Regon, "REGON checksum");
Check(RegistryIdentifier.Parse("regon", "123456786") is null, "invalid REGON");
Check(RegistryIdentifier.Parse("krs", "123")?.Number == "0000000123", "KRS padding");
Check(RegistryIdentifier.Parse("vat", "GR 123 456 789")?.Number == "EL123456789", "Greek VAT alias");
Check(RegistryIdentifier.Parse("vat", "US12345") is null, "unknown VAT country");

using (var client = Client((request, _) =>
    Reply(request.RequestUri!.Host == "wykazpodatnikowvat.mf.gov.pl" ? WhiteList() : throw new Exception("Unexpected call"))))
{
    var registry = Registry(client);
    var invalid = await new RegistriesController(registry).Lookup(new("nip", "9999406658"), default);
    Check(invalid is BadRequestObjectResult, "invalid identifier rejected");
    var results = await registry.Lookup(domestic, default);
    Check(Outcome(results, "GUS") == "notConfigured" && Outcome(results, "CEIDG") == "notConfigured",
        "optional credentials are optional");
    Check(Outcome(results, "KRS") == "notApplicable" && Outcome(results, "VAT") == "found", "VAT-only lookup");
}

var calls = new ConcurrentQueue<string>();
using (var client = Client(async (request, _) =>
{
    var uri = request.RequestUri!;
    if (uri.Host == "wyszukiwarkaregon.stat.gov.pl")
    {
        var envelope = XDocument.Parse(await request.Content!.ReadAsStringAsync());
        var operation = envelope.Descendants().Single(node =>
            node.Name.LocalName is "Zaloguj" or "DaneSzukajPodmioty" or "Wyloguj");
        calls.Enqueue(operation.Name.LocalName);
        if (operation.Name.LocalName == "Zaloguj")
        {
            Check(operation.Value == "test-gus-key", "GUS login body");
            return Soap("Zaloguj", "fake-session");
        }
        Check(request.Headers.GetValues("sid").Single() == "fake-session", "GUS session header");
        if (operation.Name.LocalName == "Wyloguj")
            return Soap("Wyloguj", "true");
        Check(operation.Descendants().Any(node => node.Name.LocalName == "Nip" && node.Value == Nip),
            "GUS search body");
        return Soap("DaneSzukajPodmioty",
            $"<root><dane><Nip>{Nip}</Nip><Regon>{Regon}</Regon><Nazwa>Example GUS</Nazwa></dane></root>", true);
    }
    if (uri.Host == "dane.biznes.gov.pl")
    {
        Check(request.Headers.Authorization?.ToString() == "Bearer test-ceidg-token", "CEIDG authorization");
        Check(uri.Query == "?nip=" + Nip, "CEIDG search");
        return Json("""{"firmy":[{"nazwa":"Example CEIDG","wlasciciel":{"nip":"9999406657"}}],"count":1}""");
    }
    if (uri.Host == "wykazpodatnikowvat.mf.gov.pl")
    {
        Check(uri.AbsolutePath == $"/api/search/nip/{Nip}" && uri.Query.StartsWith("?date="), "VAT search");
        return WhiteList("0000000123");
    }
    Check(uri.Host == "api-krs.ms.gov.pl" && uri.AbsolutePath.EndsWith("/0000000123"), "linked KRS request");
    if (uri.Query.Contains("rejestr=P"))
        return new(HttpStatusCode.NotFound);
    Check(uri.Query.Contains("rejestr=S"), "KRS fallback register");
    return Json("""{"odpis":{"dane":{"dzial1":{"danePodmiotu":{"nazwa":"Example KRS","identyfikatory":{"nip":"9999406657"}}}}}}""");
}))
{
    var results = await Registry(client, true).Lookup(domestic, default);
    Check(results.Length == 4 && results.All(result => result.Outcome == "found"), "configured domestic sources");
    Check(calls.SequenceEqual(["Zaloguj", "DaneSzukajPodmioty", "Wyloguj"]), "GUS session lifecycle");
}

using (var client = Client((request, _) => Reply(request.RequestUri!.Host switch
{
    "wykazpodatnikowvat.mf.gov.pl" => new(HttpStatusCode.TooManyRequests),
    "dane.biznes.gov.pl" => Json("""{"firmy":[],"count":2}"""),
    _ => Soap("Zaloguj", "")
})))
{
    var results = await Registry(client, true).Lookup(domestic, default);
    Check(Outcome(results, "VAT") == "unavailable" && Outcome(results, "GUS") == "unavailable" &&
        Outcome(results, "CEIDG") == "ambiguous", "independent failures and pagination ambiguity");
}

var loggedOut = false;
using (var client = Client(async (request, _) =>
{
    if (request.RequestUri!.Host != "wyszukiwarkaregon.stat.gov.pl")
        return new(HttpStatusCode.NoContent);
    var body = await request.Content!.ReadAsStringAsync();
    if (body.Contains("DaneSzukajPodmioty", StringComparison.Ordinal))
        return Soap("DaneSzukajPodmioty", "<broken");
    if (body.Contains("Wyloguj", StringComparison.Ordinal))
    {
        loggedOut = true;
        return Soap("Wyloguj", "true");
    }
    return Soap("Zaloguj", "fake-session");
}))
{
    var results = await Registry(client, true).Lookup(domestic, default);
    Check(loggedOut && Outcome(results, "GUS") == "unavailable", "GUS cleanup on invalid provider payload");
    Check(Outcome(results, "VAT") == "notFound" && Outcome(results, "CEIDG") == "notFound", "empty provider replies");
}

using (var client = Client((request, _) => Reply(request.RequestUri!.Host == "api-krs.ms.gov.pl"
    ? Json("""{"odpis":{"dane":{"dzial1":{"danePodmiotu":{"nazwa":"Unrelated entity","identyfikatory":{"regon":"123456786"}}}}}}""")
    : WhiteList("0000000123"))))
{
    var results = await Registry(client).Lookup(RegistryIdentifier.Parse("regon", Regon)!, default);
    Check(results.Single(result => result.Source == "KRS") is { Outcome: "ambiguous", Company: null },
        "KRS linked to a different REGON cannot populate fields");
}

foreach (var (body, expected) in new[]
{
    ("""{"actionSucceed":true,"valid":true,"name":"---","requestIdentifier":"id-1"}""", "found"),
    ("""{"actionSucceed":true,"valid":false}""", "notFound"),
    ("""{"actionSucceed":false,"valid":false}""", "unavailable"),
    ("invalid json", "unavailable")
})
{
    using var client = Client(async (request, _) =>
    {
        Check(request.RequestUri!.Host == "ec.europa.eu" && request.Method == HttpMethod.Post, "VIES route");
        var payload = await request.Content!.ReadAsStringAsync();
        Check(payload.Contains("\"countryCode\":\"EL\"") && payload.Contains("\"vatNumber\":\"123456789\""),
            "VIES request body");
        return Json(body);
    });
    var result = (await Registry(client).Lookup(RegistryIdentifier.Parse("vat", "GR123456789")!, default)).Single();
    Check(result.Outcome == expected, "VIES outcome " + expected);
    if (expected == "found")
        Check(result.Company is { Name: null, VatId: "EL123456789" }, "VIES placeholder names");
}

using (var client = Client(async (_, ct) =>
{
    await Task.Delay(Timeout.Infinite, ct);
    throw new Exception("The request should be cancelled");
}))
{
    using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
    try
    {
        await Registry(client).Lookup(domestic, cancel.Token);
        throw new Exception("Cancellation should propagate");
    }
    catch (OperationCanceledException) when (cancel.IsCancellationRequested) { }
}

Console.WriteLine("Registry integration checks passed.");

static void Check(bool condition, string scenario)
{
    if (!condition)
        throw new InvalidOperationException($"Failed registry scenario: {scenario}");
}

static string Outcome(RegistryResult[] results, string source) =>
    results.Single(result => result.Source == source).Outcome;

static RegistryClient Registry(HttpClient http, bool configured = false) =>
    new(http, new ConfigurationBuilder().AddInMemoryCollection(configured ? new Dictionary<string, string?>
    {
        ["Registries:GusKey"] = "test-gus-key",
        ["Registries:CeidgToken"] = "test-ceidg-token"
    } : []).Build(), NullLogger<RegistryClient>.Instance);

static HttpClient Client(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) =>
    new(new FakeTransport(send));

static Task<HttpResponseMessage> Reply(HttpResponseMessage response) => Task.FromResult(response);

static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK)
{
    Content = new StringContent(json, Encoding.UTF8, "application/json")
};

static HttpResponseMessage WhiteList(string? krs = null) => Json(System.Text.Json.JsonSerializer.Serialize(new
{
    result = new { subject = new { name = "Example VAT", nip = Nip, krs, statusVat = "Czynny" }, requestId = "vat-1" }
}));

static HttpResponseMessage Soap(string operation, string value, bool multipart = false)
{
    XNamespace ns = GusNs;
    var xml = new XElement(ns + (operation + "Result"), value).ToString();
    var part = new StringContent(xml, Encoding.UTF8, "application/xop+xml");
    return new(HttpStatusCode.OK)
    {
        Content = multipart ? new MultipartContent("related", "fake-boundary") { part } : part
    };
}

sealed class FakeTransport(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        send(request, cancellationToken);
}
