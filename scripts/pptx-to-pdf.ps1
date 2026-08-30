<#
.SYNOPSIS
  Exports a PowerPoint file to PDF, so it can be uploaded beside the .pptx.

.DESCRIPTION
  The upload needs both files: the .pptx carries the speaker notes, and the PDF carries
  what each slide looks like. Nothing in a browser can turn a PowerPoint into a picture,
  and converting on the server would mean either running PowerPoint there or sending the
  deck to somebody else's conversion service. Neither is worth it for a step PowerPoint
  already does in one menu -- this just saves the menu.

  Uses the PowerPoint already installed on this machine. Nothing is uploaded and nothing
  leaves the computer.

.EXAMPLE
  ./scripts/pptx-to-pdf.ps1 "C:\Users\me\Downloads\Induction.pptx"
  Writes Induction.pdf beside it.

.EXAMPLE
  ./scripts/pptx-to-pdf.ps1 "C:\Users\me\Decks" -OutputDir "C:\Users\me\Exports"
  Converts every .pptx in the folder.
#>

[CmdletBinding()]
param(
  # A .pptx file, or a folder of them.
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path,

  # Where the PDFs go. Defaults to beside each source file.
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Nothing at that path: $Path"
}

$item = Get-Item -LiteralPath $Path
$decks = if ($item.PSIsContainer) {
  Get-ChildItem -LiteralPath $item.FullName -Filter *.pptx -File
} else {
  @($item)
}

# .ppt is the old binary format. PowerPoint opens it, but the upload cannot read notes
# out of it, so saying so here beats a confusing half-result later.
$decks = $decks | Where-Object { $_.Extension -match '^\.pptx?$' }
if ($decks.Count -eq 0) {
  throw "No PowerPoint files found at: $Path"
}

if ($OutputDir -and -not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

try {
  $powerpoint = New-Object -ComObject PowerPoint.Application
} catch {
  throw "PowerPoint is not available on this machine, so this cannot convert anything. Open the deck and use File, then Save As, then PDF."
}

$SAVE_AS_PDF = 32

$written = @()
try {
  # PowerPoint refuses to run fully hidden, so it is minimised rather than fought with.
  #
  # Both of these want the interop types rather than the obvious PowerShell equivalents:
  # Visible takes an Office tri-state and rejects $true, WindowState takes a named enum
  # member and rejects its own numeric value. Neither error says which.
  #
  # And both are cosmetic, so neither may be fatal. A PowerPoint showing a dialog --
  # document recovery, an activation prompt -- refuses the window state outright, and a
  # failure here used to kill the script *before* the block that quits PowerPoint,
  # leaving an invisible instance running that made the next attempt fail the same way.
  try {
    $powerpoint.Visible = -1
    $powerpoint.WindowState = 'ppWindowMinimized'
  } catch {
    Write-Verbose "Could not minimise PowerPoint: $($_.Exception.Message)"
  }

  foreach ($deck in $decks) {
    $dir = if ($OutputDir) { (Resolve-Path -LiteralPath $OutputDir).Path } else { $deck.DirectoryName }
    $pdf = Join-Path $dir ($deck.BaseName + '.pdf')

    Write-Host "  $($deck.Name)  ->  $(Split-Path $pdf -Leaf)"

    $presentation = $powerpoint.Presentations.Open($deck.FullName, $true, $false, $false)
    try {
      $presentation.SaveAs($pdf, $SAVE_AS_PDF)
      $written += $pdf
    } finally {
      $presentation.Close()
    }
  }
} finally {
  $powerpoint.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
}

Write-Host ''
Write-Host "Done. Upload each PDF together with its .pptx:"
foreach ($pdf in $written) { Write-Host "  $pdf" }
