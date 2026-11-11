using System.Text;
using System.Xml.Linq;
using Microsoft.AspNetCore.WebUtilities;

namespace DocuMind.Services.Registries;

public sealed partial class RegistryClient
{
    private const string GusUrl = "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc";
    private static readonly XNamespace GusNs = "http://CIS/BIR/PUBL/2014/07";
    private static readonly XNamespace GusData = "http://CIS/BIR/PUBL/2014/07/DataContract";
    private static readonly XNamespace Soap12 = "http://www.w3.org/2003/05/soap-envelope";
    private static readonly XNamespace Addressing = "http://www.w3.org/2005/08/addressing";

    private async Task<RegistryResult> Gus(RegistryIdentifier id, CancellationToken ct)
    {
        var key = config["Registries:GusKey"];
        if (string.IsNullOrWhiteSpace(key))
            return new("GUS", "notConfigured");
        var sid = (await SendGus("Zaloguj", new XElement(GusNs + "pKluczUzytkownika", key), null, ct))
            .Descendants(GusNs + "ZalogujResult").FirstOrDefault()?.Value;
        if (string.IsNullOrWhiteSpace(sid))
            throw new InvalidDataException();
        try
        {
            var parameter = id.Kind switch { "nip" => "Nip", "regon" => "Regon", _ => "Krs" };
            var response = await SendGus("DaneSzukajPodmioty",
                new XElement(GusNs + "pParametryWyszukiwania", new XElement(GusData + parameter, id.Number)), sid, ct);
            var data = response.Descendants(GusNs + "DaneSzukajPodmiotyResult").FirstOrDefault()?.Value
                ?? throw new InvalidDataException();
            if (string.IsNullOrWhiteSpace(data))
                return new("GUS", "notFound");
            var rows = XDocument.Parse(data).Descendants("dane").ToArray();
            if (rows.Any(row => XmlValue(row, "ErrorCode") is { } code && code != "4"))
                throw new InvalidDataException();
            var matches = rows.Where(row => XmlValue(row, "Regon") != null).ToArray();
            if (matches.Length != 1)
                return new("GUS", matches.Length == 0 ? "notFound" : "ambiguous");
            var match = matches[0];
            return new("GUS", "found", new(XmlValue(match, "Nazwa"),
                Address(XmlValue(match, "Ulica"), XmlValue(match, "NrNieruchomosci"), XmlValue(match, "NrLokalu"),
                    XmlValue(match, "KodPocztowy"), XmlValue(match, "Miejscowosc")),
                XmlValue(match, "Nip"), XmlValue(match, "Regon"), XmlValue(match, "Krs")), XmlValue(match, "StatusNip"));
        }
        finally
        {
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await SendGus("Wyloguj", new XElement(GusNs + "pIdentyfikatorSesji", sid), sid, cleanup.Token); }
            catch (Exception error) when (error is HttpRequestException or OperationCanceledException or
                InvalidDataException or System.Xml.XmlException or IOException)
            {
                logger.LogDebug("Could not close GUS session ({ErrorType})", error.GetType().Name);
            }
        }
    }

    private Task<XDocument> SendGus(string operation, XElement parameter, string? sid, CancellationToken ct)
    {
        var action = $"{GusNs}/IUslugaBIRzewnPubl/{operation}";
        var envelope = new XElement(Soap12 + "Envelope",
            new XElement(Soap12 + "Header",
                new XElement(Addressing + "Action", new XAttribute(Soap12 + "mustUnderstand", "1"), action),
                new XElement(Addressing + "To", new XAttribute(Soap12 + "mustUnderstand", "1"), GusUrl)),
            new XElement(Soap12 + "Body", new XElement(GusNs + operation, parameter)));
        return SendSoap(envelope, sid, ct);
    }

    private async Task<XDocument> SendSoap(XElement envelope, string? sid, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, GusUrl);
        request.Content = new StringContent(envelope.ToString(SaveOptions.DisableFormatting), Encoding.UTF8, "application/soap+xml");
        if (sid != null)
            request.Headers.Add("sid", sid);
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var contentType = response.Content.Headers.ContentType;
        var body = stream;
        if (contentType?.MediaType == "multipart/related")
        {
            var boundary = contentType.Parameters.FirstOrDefault(part => part.Name == "boundary")?.Value?.Trim('"')
                ?? throw new InvalidDataException();
            var reader = new MultipartReader(boundary, stream);
            var section = await reader.ReadNextSectionAsync(ct) ?? throw new InvalidDataException();
            body = section.Body;
        }
        return await XDocument.LoadAsync(body, LoadOptions.None, ct);
    }

    private static string? XmlValue(XElement row, string name) =>
        Clean(row.Elements().FirstOrDefault(element => element.Name.LocalName == name)?.Value);
}
