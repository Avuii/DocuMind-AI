using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace DocuMind.Services.Search;

internal static class DocumentSearch
{
    private static readonly HashSet<string> StopWords =
    [
        "what", "when", "which", "the", "from", "does", "this", "was", "are", "is", "of", "in",
        "jaka", "jaki", "jakie", "jest", "ile", "czy", "kiedy", "fakturze", "dokumencie"
    ];
    private static readonly (string Field, string Pattern)[] Intents =
    [
        ("purchase_order_number", @"\b(?:po number|purchase order|numer zamówienia)\b"),
        ("due_date", @"\b(?:due date|termin płatności|kiedy zapłacić)\b"),
        ("payment_terms", @"\b(?:payment terms|when is payment due|uwagi|warunki płatności|ile dni)\b"),
        ("sale_date", @"\b(?:sale date|transaction date|dat[ayę] sprzedaży)\b"),
        ("net_amount", @"\b(?:netto|subtotal|sub total|net amount|net total)\b"),
        ("nip", @"\b(?:nip|tax id)\b"),
        ("seller_gst_id", @"\b(?:gst (?:id|number|registration)|numer gst)\b"),
        ("vat_rate", @"\b(?:vat rate|gst rate|tax rate|stawka (?:vat|gst)|procent vat)\b"),
        ("tax_amount", @"\b(?:vat|gst|tax|podatek|podatku|ptu)\b"),
        ("total_amount", @"\b(?:brutto|do zapłaty|total|amount due|gross amount|suma)\b"),
        ("invoice_number", @"\b(?:invoice number|invoice no|numer(?:u)? faktury|nr faktury)\b"),
        ("receipt_number", @"\b(?:receipt number|numer paragonu|nr paragonu)\b"),
        ("buyer_address", @"\b(?:buyer address|billing address|adres nabywcy)\b"),
        ("seller_address", @"\b(?:seller address|vendor address|adres sprzedawcy)\b"),
        ("buyer_name", @"\b(?:buyer|customer|bill to|nabywc\w*|odbiorc\w*)\b"),
        ("vendor_name", @"\b(?:seller|vendor|supplier|sprzedawc\w*|wystawc\w*)\b"),
        ("invoice_date", @"\b(?:date|issued|data|datę|wystawiono|wystawienia)\b"),
        ("currency", @"\b(?:currency|walut\w*)\b"),
        ("phone", @"\b(?:phone|telefon\w*)\b"),
        ("email", @"\b(?:email|e-mail)\b"),
        ("website", @"\b(?:website|strona www)\b"),
        ("bank_account", @"\b(?:iban|bank account|numer konta|rachunek bankowy)\b")
    ];

    internal static DocumentAnswer Ask(string rawResult, string question)
    {
        var normalized = question.ToLowerInvariant();
        var root = JsonNode.Parse(rawResult);
        var debug = root?["debug"];
        if (Regex.IsMatch(normalized, @"\b(?:line items|items|products|pozycj\w*|produkt\w*|towar\w*)\b") &&
            root?["line_items"] is JsonArray items && items.Count > 0)
        {
            var rows = items.OfType<JsonObject>().Take(25)
                .Select(item => new DocumentCitation(
                    string.Join(" · ", new[] { "description", "quantity", "unit_price", "amount" }
                        .Select(key => item[key]?.ToString()).Where(value => !string.IsNullOrEmpty(value))),
                    item["page"]?.GetValue<int>(), item["line"]?.GetValue<int>() ?? 1))
                .ToArray();
            return new DocumentAnswer(string.Join("\n", rows.Select(row => row.Text)), rows);
        }
        var intent = Intents.FirstOrDefault(candidate => Regex.IsMatch(normalized, candidate.Pattern));
        if (intent.Field != null && root?["fields"]?[intent.Field] is JsonObject field &&
            field["value"] is JsonValue value && value.ToString().Length > 0 &&
            field["evidence"] is JsonObject source)
        {
            var quote = new DocumentCitation(source["text"]!.GetValue<string>(),
                source["page"]?.GetValue<int>(), source["line"]!.GetValue<int>());
            return new DocumentAnswer(value.ToString(), [quote]);
        }

        var terms = Words(normalized).Where(term => !StopWords.Contains(term)).ToHashSet();
        var lines = debug?["raw_lines"] is JsonArray rawLines
            ? rawLines.OfType<JsonObject>()
                .Select(line => (Text: line["text"]?.GetValue<string>() ?? "",
                    Page: line["page"]?.GetValue<int>()))
            : (debug?["full_text"]?.GetValue<string>() ?? "").Split('\n')
                .Select(text => (Text: text, Page: (int?)null));

        var citations = lines
            .Select((line, index) => new
            {
                Quote = new DocumentCitation(line.Text, line.Page, index + 1),
                Score = Words(line.Text).Distinct().Count(terms.Contains)
            })
            .Where(hit => hit.Score > 0)
            .OrderByDescending(hit => hit.Score)
            .Take(3)
            .Select(hit => hit.Quote)
            .ToArray();

        return new DocumentAnswer(citations.FirstOrDefault()?.Text, citations);
    }

    private static IEnumerable<string> Words(string text) =>
        Regex.Matches(text.ToLowerInvariant(), @"[\p{L}\p{N}]{2,}")
            .Select(match => match.Value);
}

internal record DocumentAnswer(string? Answer, DocumentCitation[] Citations);
internal record DocumentCitation(string Text, int? Page, int Line);
