$baseUrl = "http://localhost:8001/infer"

function Invoke-OcrBatch {
    param(
        [string]$InputDir,
        [string]$OutputDir
    )

    $files = Get-ChildItem $InputDir -File |
        Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|pdf)$' } |
        Sort-Object Name

    foreach ($file in $files) {
        $nameWithoutExt = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        $outputPath = Join-Path $OutputDir ($nameWithoutExt + ".json")

        Write-Host "Processing $($file.FullName)..."

        curl.exe -s -X POST `
          -F "file=@$($file.FullName)" `
          $baseUrl `
          -o $outputPath

        Write-Host "Saved -> $outputPath"
    }
}

Invoke-OcrBatch -InputDir ".\datasets\samples\invoices" -OutputDir ".\datasets\results\invoices"
Invoke-OcrBatch -InputDir ".\datasets\samples\receipts" -OutputDir ".\datasets\results\receipts"