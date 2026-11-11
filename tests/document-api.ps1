param(
    [string]$BaseUrl = 'http://127.0.0.1:5000',
    [switch]$IncludeOcr
)

$ErrorActionPreference = 'Stop'
$documents = "$BaseUrl/api/documents"
$auth = "$BaseUrl/api/auth"
$headers = @{ 'X-DocuMind-Request' = '1' }
$curl = (Get-Command curl -CommandType Application | Select-Object -First 1).Source

function Send-Document([string]$Path, [string]$ContentType, [string]$BatchId = [guid]::NewGuid().ToString()) {
    $cookie = $accountSession.Cookies.GetCookieHeader([uri]$documents)
    $response = & $curl --fail-with-body --silent --show-error --max-time 20 --header 'X-DocuMind-Request: 1' --cookie $cookie --form "file=@$Path;type=$ContentType" --form "batchId=$BatchId" $documents
    if ($LASTEXITCODE -ne 0) { throw "Upload failed. $response" }
    return $response | ConvertFrom-Json
}

function Assert-Condition($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Wait-ForDocument([string]$Url) {
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        $document = Invoke-RestMethod $Url -TimeoutSec 10
        if ($document.status -eq 'Done') { return $document }
        if ($document.status -eq 'Failed') { throw $document.errorMessage }
        Start-Sleep -Seconds 2
    }
    throw "Extraction timed out for $Url"
}

function New-DocumentPdf([string]$Path, [switch]$Receipt) {
    $stream = if ($Receipt) {
        @'
BT /F1 16 Tf 50 760 Td (Sklep Przykladowy) Tj
0 -28 Td (PARAGON FISKALNY) Tj
0 -28 Td (Jablka 5.50 A) Tj
0 -28 Td (SUMA PLN: 5.50) Tj
0 -28 Td (GOTOWKA: 5.50) Tj ET
'@
    } else {
        @'
BT /F1 16 Tf 50 760 Td (Example Company Ltd) Tj
0 -28 Td (Invoice No. FV/2026/123) Tj
0 -28 Td (Issue date: 15-Mar-2026) Tj
0 -28 Td (NIP: 5260250274) Tj
0 -28 Td (SUB_TOTAL: 100.00 PLN) Tj
0 -28 Td (TAX:VAT \(23.00%\): 23.00 PLN) Tj
0 -28 Td (TOTAL: 123.00 PLN) Tj ET
'@
    }
    $objects = @(
        '<< /Type /Catalog /Pages 2 0 R >>'
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
        "<< /Length $($stream.Length) >>" + "`nstream`n$stream`nendstream"
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    )
    $pdf = "%PDF-1.4`n"
    $offsets = foreach ($index in 0..($objects.Count - 1)) {
        $pdf.Length
        $pdf += "$($index + 1) 0 obj`n$($objects[$index])`nendobj`n"
    }
    $xref = $pdf.Length
    $pdf += "xref`n0 6`n0000000000 65535 f `n"
    foreach ($offset in $offsets) { $pdf += "{0:D10} 00000 n `n" -f $offset }
    $pdf += "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
    [IO.File]::WriteAllText($Path, $pdf, [Text.Encoding]::ASCII)
}

$tempPath = Join-Path ([IO.Path]::GetTempPath()) ("documind-" + [guid]::NewGuid() + ".pdf")
try {
    $anonymous = Invoke-WebRequest $documents -SkipHttpErrorCheck
    Assert-Condition ($anonymous.StatusCode -eq 401) 'Anonymous users can access document history.'
    $credentials = @{
        email = "smoke-$([guid]::NewGuid().ToString('N'))@example.test"
        password = 'Local-Smoke-Password!42'
    }
    $body = $credentials | ConvertTo-Json
    $missingHeader = Invoke-WebRequest "$auth/register" -Method Post -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
    Assert-Condition ($missingHeader.StatusCode -eq 400) 'Registration accepted a cross-site-compatible request.'
    $weakBody = @{ email = $credentials.email; password = 'lowercaseonlypassword' } | ConvertTo-Json
    $weak = Invoke-WebRequest "$auth/register" -Method Post -ContentType 'application/json' -Headers $headers -Body $weakBody -SkipHttpErrorCheck
    Assert-Condition ($weak.StatusCode -eq 400) 'Registration accepted a weak password.'
    $registered = Invoke-RestMethod "$auth/register" -Method Post -ContentType 'application/json' -Headers $headers -Body $body -SessionVariable accountSession
    Assert-Condition ($registered.email -eq $credentials.email) 'The account was not registered.'
    $duplicate = Invoke-WebRequest "$auth/register" -Method Post -ContentType 'application/json' -Headers $headers -Body $body -SkipHttpErrorCheck
    Assert-Condition ($duplicate.StatusCode -eq 409) 'Duplicate registration did not return a conflict.'
    $PSDefaultParameterValues = @{
        'Invoke-RestMethod:WebSession' = $accountSession
        'Invoke-WebRequest:WebSession' = $accountSession
        'Invoke-RestMethod:Headers' = $headers
        'Invoke-WebRequest:Headers' = $headers
    }

    New-DocumentPdf $tempPath
    $initialBatch = [guid]::NewGuid().ToString()
    $upload = Send-Document $tempPath 'application/pdf' $initialBatch
    Assert-Condition ($upload.status -eq 'Queued') 'Upload did not return Queued.'
    $url = "$documents/$($upload.id)"
    $document = Wait-ForDocument $url
    $fields = $document.result.finalResult.fields
    Assert-Condition ($fields.invoice_number.value -eq 'FV/2026/123') 'Wrong invoice number.'
    Assert-Condition ($fields.nip.value -eq '5260250274') 'Wrong NIP.'
    Assert-Condition ($fields.invoice_date.value -eq '2026-03-15') 'Wrong invoice date.'
    Assert-Condition ($fields.total_amount.value -eq 123) 'Wrong gross amount.'
    Assert-Condition ($fields.net_amount.value -eq 100) 'Wrong net amount.'
    Assert-Condition ($fields.tax_amount.value -eq 23 -and $fields.vat_rate.value -eq '23.00%') 'VAT rate and amount were not separated.'
    Assert-Condition ($fields.document_type.value -eq 'invoice' -and $fields.document_language.value -eq 'en') 'The invoice was not classified.'

    $preview = Invoke-WebRequest "$url/content" -Headers @{ Range = 'bytes=0-7' } -TimeoutSec 10
    Assert-Condition ($preview.StatusCode -eq 206) 'PDF preview did not support byte ranges.'
    Assert-Condition ($preview.Headers['Content-Type'] -contains 'application/pdf') 'Wrong PDF content type.'

    $answer = Invoke-RestMethod "$url/questions" -Method Post -ContentType 'application/json' -Body '{"question":"What is the NIP?"}'
    Assert-Condition ($answer.answer -match '5260250274' -and $answer.citations[0].page -eq 1) 'The answer lacks a page citation.'
    $gross = Invoke-RestMethod "$url/questions" -Method Post -ContentType 'application/json' -Body '{"question":"Jaka jest kwota brutto?"}'
    Assert-Condition ([decimal]$gross.answer -eq 123 -and $gross.citations[0].text -match '^TOTAL') 'Polish Q&A chose the wrong total.'
    $miss = Invoke-RestMethod "$url/questions" -Method Post -ContentType 'application/json' -Body '{"question":"astronomy"}'
    Assert-Condition ($null -eq $miss.answer -and $miss.citations.Count -eq 0) 'An unrelated question returned an answer.'

    $tag = $upload.id
    $reviewUrl = "$url/review"
    $withoutPreview = Invoke-WebRequest $reviewUrl -Method Put -ContentType 'application/json' -Body '{"tags":[],"reviewed":true}' -SkipHttpErrorCheck
    Assert-Condition ($withoutPreview.StatusCode -eq 422) 'Approval accepted without checking the preview.'
    $missingField = Invoke-WebRequest $reviewUrl -Method Put -ContentType 'application/json' -Body '{"tags":[],"reviewed":true,"previewChecked":true,"fields":{"invoice_number":null}}' -SkipHttpErrorCheck
    Assert-Condition ($missingField.StatusCode -eq 422 -and $missingField.Content -match 'invoice_number') 'Approval accepted a missing invoice number.'
    $null = Invoke-RestMethod "$url/review" -Method Put -ContentType 'application/json' -Body (@{
        tags = @($tag)
        reviewed = $true
        previewChecked = $true
    } | ConvertTo-Json)
    $history = Invoke-RestMethod ($documents + "?search=$tag&reviewed=true&page=1")
    Assert-Condition ($history.items.Count -eq 1 -and $history.items[0].id -eq $upload.id) 'Review or tag search did not persist.'

    $null = Invoke-RestMethod "$url/corrections" -Method Put -ContentType 'application/json' -Body '{"fields":{"invoice_number":"FV/2026/456"}}'
    $document = Invoke-RestMethod $url
    Assert-Condition ($document.result.rawResult.fields.invoice_number.value -eq 'FV/2026/123') 'The correction changed the original result.'
    Assert-Condition (-not $document.reviewed) 'Editing an approved value did not reopen review.'
    $export = Invoke-RestMethod "$url/export/json"
    Assert-Condition ($export.fields.invoice_number.value -eq 'FV/2026/456') 'The JSON export omitted the correction.'
    $csv = (Invoke-WebRequest "$url/export/csv").Content
    Assert-Condition ($csv -match 'invoice_number,nip' -and $csv -match 'FV/2026/456') 'The CSV export omitted the invoice fields.'
    $noApproved = Invoke-WebRequest "$documents/export/approved/json" -SkipHttpErrorCheck
    Assert-Condition ($noApproved.StatusCode -eq 400) 'The batch included an unapproved document.'
    $null = Invoke-RestMethod $reviewUrl -Method Put -ContentType 'application/json' -Body (@{
        tags = @($tag); reviewed = $true; previewChecked = $true; fields = @{buyer_name = 'Manually entered buyer'}
    } | ConvertTo-Json)
    $approved = Invoke-RestMethod "$documents/export/approved/json"
    Assert-Condition ($approved.Count -eq 1 -and $approved[0].result.fields.buyer_name.value -eq 'Manually entered buyer') 'The approved JSON did not contain the manual value.'
    $approvedCsv = (Invoke-WebRequest "$documents/export/approved/csv").Content
    Assert-Condition ($approvedCsv -match 'Manually entered buyer') 'The approved CSV did not contain the manual value.'

    $groupUrl = "$BaseUrl/api/document-groups"
    $group = Invoke-RestMethod $groupUrl -Method Post -ContentType 'application/json' -Body (@{
        name = 'Office'; color = 'blue'; documentId = $upload.id
    } | ConvertTo-Json)
    $colored = Invoke-RestMethod "$groupUrl/$($group.id)" -Method Put -ContentType 'application/json' -Body '{"name":"Accounting","color":"#7E35AC"}'
    Assert-Condition ($colored.color -ceq '#7e35ac' -and $colored.name -eq 'Accounting') 'Custom group color was not saved.'
    $filtered = Invoke-RestMethod ($documents + "?groupId=$($group.id)")
    Assert-Condition ($filtered.items.Count -eq 1 -and $filtered.items[0].id -eq $upload.id) 'Group assignment or filtering failed.'
    $null = Invoke-RestMethod "$auth/language" -Method Put -ContentType 'application/json' -Body '{"language":"pl"}'
    $newPassword = 'New-Local-Password!2026'
    $passwordBody = @{ currentPassword = $credentials.password; newPassword = $newPassword } | ConvertTo-Json
    $null = Invoke-RestMethod "$auth/change-password" -Method Post -ContentType 'application/json' -Body $passwordBody
    $session = Invoke-RestMethod "$auth/session"
    Assert-Condition ($session.language -eq 'pl') 'Changing the password lost the language preference or session.'

    $null = Invoke-RestMethod "$auth/logout" -Method Post
    $loggedOut = Invoke-WebRequest "$auth/session" -SkipHttpErrorCheck
    Assert-Condition ($loggedOut.StatusCode -eq 401) 'The session survived logout.'
    $badPassword = $body
    $badLogin = Invoke-WebRequest "$auth/login" -Method Post -ContentType 'application/json' -Body $badPassword -SkipHttpErrorCheck
    Assert-Condition ($badLogin.StatusCode -eq 401) 'The API accepted an incorrect password.'
    $newCredentials = @{ email = $credentials.email; password = $newPassword } | ConvertTo-Json
    $null = Invoke-RestMethod "$auth/login" -Method Post -ContentType 'application/json' -Body $newCredentials
    $session = Invoke-RestMethod "$auth/session"
    Assert-Condition ($session.email -eq $credentials.email) 'The account could not sign in after logout.'
    $saved = Invoke-RestMethod $url
    Assert-Condition ($saved.reviewed -and $saved.tags -contains $tag) 'The document was not available after signing in again.'
    $recovery = Invoke-RestMethod "$auth/recovery-code" -Method Post -ContentType 'application/json' -Body (
        @{ password = $newPassword } | ConvertTo-Json)
    $null = Invoke-RestMethod "$auth/logout" -Method Post
    $recoveredPassword = 'Recovered-Local-Password!2026'
    $resetBody = @{ email = $credentials.email; code = $recovery.code; newPassword = $recoveredPassword } | ConvertTo-Json
    $null = Invoke-RestMethod "$auth/reset-password" -Method Post -ContentType 'application/json' -Body $resetBody
    $reused = Invoke-WebRequest "$auth/reset-password" -Method Post -ContentType 'application/json' -Body $resetBody -SkipHttpErrorCheck
    Assert-Condition ($reused.StatusCode -eq 400) 'The recovery code could be reused.'
    $null = Invoke-RestMethod "$auth/login" -Method Post -ContentType 'application/json' -Body (
        @{ email = $credentials.email; password = $recoveredPassword } | ConvertTo-Json)

    $other = @{ email = "other-$($credentials.email)"; password = $credentials.password } | ConvertTo-Json
    $otherSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $null = Invoke-RestMethod "$auth/register" -Method Post -ContentType 'application/json' -Body $other -WebSession $otherSession
    $otherList = Invoke-RestMethod $documents -WebSession $otherSession
    Assert-Condition ($otherList.items.Count -eq 0) 'Another account can see document history.'
    $otherCounts = Invoke-RestMethod "$documents/status-counts?batchId=$initialBatch" -WebSession $otherSession
    Assert-Condition ($otherCounts.done -eq 0) 'Another account can see batch counts.'
    $otherGroups = Invoke-RestMethod $groupUrl -WebSession $otherSession
    Assert-Condition ($otherGroups.Count -eq 0) 'Another account can see private groups.'
    foreach ($suffix in @('', '/content', '/export/json', '/export/csv')) {
        $response = Invoke-WebRequest "$url$suffix" -WebSession $otherSession -SkipHttpErrorCheck
        Assert-Condition ($response.StatusCode -eq 404) "Another account can read $suffix."
    }
    $otherReview = Invoke-WebRequest "$url/review" -Method Put -ContentType 'application/json' -Body '{"tags":[],"reviewed":false}' -WebSession $otherSession -SkipHttpErrorCheck
    Assert-Condition ($otherReview.StatusCode -eq 404) 'Another account can edit a document.'
    $otherDelete = Invoke-WebRequest $url -Method Delete -WebSession $otherSession -SkipHttpErrorCheck
    Assert-Condition ($otherDelete.StatusCode -eq 404) 'Another account can delete a document.'

    $null = Invoke-RestMethod "$url/analyze" -Method Post
    $reanalyzed = Wait-ForDocument $url
    Assert-Condition ($reanalyzed.result.finalResult.fields.invoice_number.value -eq 'FV/2026/456') 'Reanalysis dropped a correction.'

    $archivePath = [IO.Path]::ChangeExtension($tempPath, '.zip')
    $receiptPath = [IO.Path]::ChangeExtension($tempPath, '.receipt.pdf')
    New-DocumentPdf $receiptPath -Receipt
    $zip = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $tempPath, 'nested/invoice.pdf')
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $receiptPath, 'receipt.pdf')
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $tempPath, 'unsupported.txt')
    } finally { $zip.Dispose() }
    try {
        $zipBatch = [guid]::NewGuid().ToString()
        $cookie = $accountSession.Cookies.GetCookieHeader([uri]$documents)
        $response = & $curl --fail-with-body --silent --show-error --max-time 20 --header 'X-DocuMind-Request: 1' --cookie $cookie --form "file=@$archivePath;type=application/zip" --form "batchId=$zipBatch" "$documents/archive"
        Assert-Condition ($LASTEXITCODE -eq 0) "ZIP upload failed. $response"
        $batch = $response | ConvertFrom-Json
        Assert-Condition ($batch.ids.Count -eq 2 -and $batch.skipped -contains 'unsupported.txt') 'ZIP did not queue both PDFs and report the skipped file.'
        $first = Wait-ForDocument "$documents/$($batch.ids[0])"
        Assert-Condition ($first.originalFileName -eq 'invoice.pdf') 'Nested file did not keep its base name.'
        $receipt = Wait-ForDocument "$documents/$($batch.ids[1])"
        $receiptFields = $receipt.result.finalResult.fields
        Assert-Condition ($receiptFields.document_type.value -eq 'receipt' -and $receiptFields.document_language.value -eq 'pl') 'The Polish receipt was not classified.'
        Assert-Condition ($receiptFields.total_amount.value -eq 5.5) 'Wrong receipt total.'
        $zipCounts = Invoke-RestMethod "$documents/status-counts?batchId=$zipBatch"
        $originalCounts = Invoke-RestMethod "$documents/status-counts?batchId=$initialBatch"
        $filteredBatch = Invoke-RestMethod ($documents + "?status=Done&batchId=$zipBatch")
        Assert-Condition ($zipCounts.done -eq 2 -and $originalCounts.done -eq 1 -and $filteredBatch.items.Count -eq 2) 'Batch counters or status navigation mixed uploads.'
    } finally { Remove-Item -LiteralPath $archivePath, $receiptPath }

    $cancelArchive = [IO.Path]::ChangeExtension($tempPath, '.cancel.zip')
    $cancelBatch = [guid]::NewGuid().ToString()
    $cancelIds = @()
    try {
        $zip = [IO.Compression.ZipFile]::Open($cancelArchive, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($i in 1..12) {
                $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $tempPath, "cancel-$i.pdf")
            }
        } finally { $zip.Dispose() }
        $response = & $curl --fail-with-body --silent --show-error --max-time 20 --header 'X-DocuMind-Request: 1' --cookie $cookie --form "file=@$cancelArchive;type=application/zip" --form "batchId=$cancelBatch" "$documents/archive"
        Assert-Condition ($LASTEXITCODE -eq 0) "Cancellation fixture upload failed. $response"
        $cancelIds = ($response | ConvertFrom-Json).ids
        $cancelUrl = "$documents/batches/$cancelBatch/cancel"
        $otherCancel = Invoke-RestMethod $cancelUrl -Method Post -WebSession $otherSession
        Assert-Condition ($otherCancel.cancelled -eq 0) 'Another account can cancel a private batch.'
        $cancelled = Invoke-RestMethod $cancelUrl -Method Post
        Assert-Condition ($cancelled.cancelled -gt 0) 'The batch had no cancelled documents.'
        $repeat = Invoke-RestMethod $cancelUrl -Method Post
        Assert-Condition ($repeat.cancelled -eq 0) 'Cancelling twice changed more documents.'
        $cancelList = Invoke-RestMethod ($documents + "?status=Cancelled&batchId=$cancelBatch")
        $cancelCounts = Invoke-RestMethod "$documents/status-counts?batchId=$cancelBatch"
        Assert-Condition ($cancelCounts.queued -eq 0 -and $cancelCounts.processing -eq 0 -and
            $cancelCounts.cancelled -eq $cancelList.items.Count -and $cancelCounts.cancelled + $cancelCounts.done -eq 12) 'The batch did not settle with only completed and cancelled documents.'
        $stillDone = Invoke-RestMethod $url
        Assert-Condition ($stillDone.status -eq 'Done') 'Cancelling changed a completed document from a different batch.'
        $cancelledDoc = "$documents/$($cancelList.items[0].id)"
        $original = Invoke-WebRequest "$cancelledDoc/content"
        Assert-Condition ($original.StatusCode -in @(200, 206) -and
            $original.Headers['Content-Type'] -contains 'application/pdf') 'Cancelling removed the original.'
        $null = Invoke-RestMethod "$cancelledDoc/analyze" -Method Post
        $null = Wait-ForDocument $cancelledDoc
        $null = Invoke-RestMethod $cancelledDoc -Method Delete
        foreach ($suffix in @('', '/content', '/export/json')) {
            $deleted = Invoke-WebRequest "$cancelledDoc$suffix" -SkipHttpErrorCheck
            Assert-Condition ($deleted.StatusCode -eq 404) "Deleted document is still accessible at $suffix."
        }
    } finally {
        foreach ($id in $cancelIds) { $null = Invoke-WebRequest "$documents/$id" -Method Delete -SkipHttpErrorCheck }
        if (Test-Path -LiteralPath $cancelArchive) { Remove-Item -LiteralPath $cancelArchive }
    }

    $brokenPath = [IO.Path]::ChangeExtension($tempPath, '.broken.pdf')
    try {
        [IO.File]::WriteAllText($brokenPath, 'Unreadable PDF test')
        $broken = Send-Document $brokenPath 'application/pdf'
        $brokenUrl = "$documents/$($broken.id)"
        for ($attempt = 0; $attempt -lt 25; $attempt++) {
            $brokenDoc = Invoke-RestMethod $brokenUrl
            if ($brokenDoc.status -eq 'Failed') { break }
            Start-Sleep -Seconds 1
        }
        Assert-Condition ($brokenDoc.status -eq 'Failed') 'The fixture did not fail extraction.'
        $draft = @{
            tags = @(); reviewed = $false
            fields = @{
                document_type = 'invoice'; invoice_number = 'MANUAL/1'; vendor_name = 'Manual seller'
                invoice_date = '2026-01-31'; total_amount = 0; currency = 'PLN'
            }
        }
        $null = Invoke-RestMethod "$brokenUrl/review" -Method Put -ContentType 'application/json' -Body ($draft | ConvertTo-Json)
        $savedDraft = Invoke-RestMethod $brokenUrl
        Assert-Condition (-not $savedDraft.reviewed -and $savedDraft.result.finalResult.fields.invoice_number.value -eq 'MANUAL/1') 'Manual draft was not saved after extraction failed.'
        $null = Invoke-RestMethod "$brokenUrl/review" -Method Put -ContentType 'application/json' -Body '{"tags":[],"reviewed":true,"previewChecked":true}'
        $manual = Invoke-RestMethod $brokenUrl
        Assert-Condition ($manual.reviewed -and $manual.status -eq 'Done') 'Manual approval did not finish the document.'
    } finally { Remove-Item -LiteralPath $brokenPath }

    if ($IncludeOcr) {
        $imagePath = Join-Path $PSScriptRoot '../frontend/src/app/demo/fixtures/receipt-pl.jpg'
        $scan = Send-Document $imagePath 'image/jpeg'
        $imageUrl = "$documents/$($scan.id)"
        $scanResult = Wait-ForDocument $imageUrl
        Assert-Condition ($scanResult.result.rawResult.debug.raw_lines.Count -gt 0) 'Image OCR did not return text.'
        $image = Invoke-WebRequest "$imageUrl/content" -TimeoutSec 10
        Assert-Condition ($image.Headers['Content-Type'] -contains 'image/jpeg') 'Wrong image preview content type.'
    }
    Write-Host 'Document API smoke test passed.'
} finally {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath }
}
